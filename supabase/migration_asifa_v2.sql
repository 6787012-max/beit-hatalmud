-- migration_asifa_v2.sql — שדרוג רישום אסיפת הורים (09/11/2026)
--   1. שם מלא של התלמיד (full_name) ב-asifa_lookup
--   2. רישום לפי שם למי שאין טלפון רשום: asifa_roster + asifa_book_by_name
--   3. asifa_public מחזיר גם שמות השיעורים של כל רב (class_names), כדי שהדף ידע איזה רב מלמד את הבן שנבחר
-- רק אובייקטים עם קידומת asifa_. אידמפוטנטי.

alter table public.asifa_bookings add column if not exists parent_name text;

-- created_by מקבל ערך נוסף: parent_name (נרשם לפי שם, לא מאומת)
alter table public.asifa_bookings drop constraint if exists asifa_bookings_created_by_check;
alter table public.asifa_bookings add constraint asifa_bookings_created_by_check
  check (created_by in ('parent', 'admin', 'parent_name'));

-- שם מלא: name אם הוא כבר מסתיים בשם המשפחה, אחרת name + ' ' + family
create or replace function public.asifa_full_name(p_name text, p_family text) returns text
  language sql immutable as
$$ select case
     when coalesce(btrim(p_family), '') = '' then btrim(coalesce(p_name, ''))
     when right(btrim(coalesce(p_name, '')), length(btrim(p_family))) = btrim(p_family) then btrim(p_name)
     else btrim(coalesce(p_name, '') || ' ' || btrim(p_family)) end $$;

-- ===== ציבורי: פרטי האסיפה + שעות תפוסות (בלי שמות) + שמות השיעורים של כל רב =====
create or replace function public.asifa_public(p_token text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare m public.asifa_meetings; occ jsonb;
begin
  select * into m from public.asifa_meetings where public_token = p_token limit 1;
  if not found then return null; end if;
  select coalesce(jsonb_object_agg(rav, slots), '{}'::jsonb) into occ
    from (select rav, jsonb_agg(slot_time order by slot_time) slots
            from public.asifa_bookings where meeting_id = m.id group by rav) x;
  return jsonb_build_object(
    'title', m.title, 'date', m.date, 'slot_minutes', m.slot_minutes,
    'contact_text', m.contact_text, 'open', m.reg_open,
    'rabbis', (select coalesce(jsonb_agg(jsonb_build_object(
                  'name', r->>'name', 'start', r->>'start', 'end', r->>'end',
                  'optional', coalesce((r->>'optional')::boolean, false),
                  'class_names', (select coalesce(jsonb_agg(distinct split_part(c.name, ' - ', 1)), '[]'::jsonb)
                                    from public.classes c where r->'classes' @> to_jsonb(c.id)))), '[]'::jsonb)
                 from jsonb_array_elements(m.rabbis) r),
    'occupied', occ);
end $$;

-- ===== ציבורי: זיהוי לפי טלפון (כולל full_name) =====
create or replace function public.asifa_lookup(p_token text, p_phone text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare m public.asifa_meetings; p9 text;
begin
  select * into m from public.asifa_meetings where public_token = p_token limit 1;
  if not found then return '[]'::jsonb; end if;
  p9 := public.norm_phone(p_phone);
  if p9 is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'student_id', s.id,
      'first_name', public.asifa_first_name(s.name, s.family),
      'full_name', public.asifa_full_name(s.name, s.family),
      'class_name', split_part(coalesce(c.name, ''), ' - ', 1),
      'rabbis', (select coalesce(jsonb_agg(jsonb_build_object(
                    'name', r->>'name', 'optional', coalesce((r->>'optional')::boolean, false))), '[]'::jsonb)
                   from jsonb_array_elements(m.rabbis) r
                  where r->'classes' @> to_jsonb(s.class_id)),
      'bookings', (select coalesce(jsonb_agg(jsonb_build_object('rav', b.rav, 'slot', b.slot_time)
                                             order by b.slot_time), '[]'::jsonb)
                     from public.asifa_bookings b
                    where b.meeting_id = m.id and b.student_id = s.id)
    ) order by s.id)
    from public.students s left join public.classes c on c.id = s.class_id
    where s.status = 'פעיל' and public.asifa_phone_matches(s, p9)
  ), '[]'::jsonb);
end $$;

-- ===== ציבורי: רשימת תלמידים לרישום לפי שם (בלי טלפונים ובלי שום פרט נוסף) =====
-- רק תלמידים פעילים בשיעורים שיש להם רב באסיפה הזו.
create or replace function public.asifa_roster(p_token text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare m public.asifa_meetings;
begin
  select * into m from public.asifa_meetings where public_token = p_token limit 1;
  if not found then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'student_id', s.id,
             'full_name', public.asifa_full_name(s.name, s.family),
             'class_name', split_part(coalesce(c.name, ''), ' - ', 1))
           order by s.class_id, public.asifa_full_name(s.name, s.family))
      from public.students s left join public.classes c on c.id = s.class_id
     where s.status = 'פעיל'
       and exists (select 1 from jsonb_array_elements(m.rabbis) r where r->'classes' @> to_jsonb(s.class_id))
  ), '[]'::jsonb);
end $$;

-- ===== ציבורי: הזמנה לפי שם =====
-- בלי אימות טלפון, ולכן: אסור להחליף/לדרוס תור קיים של הבן אצל אותו רב, ואין ביטול לפי שם.
create or replace function public.asifa_book_by_name(
  p_token text, p_student_id bigint, p_rav text, p_slot text, p_contact_phone text, p_parent_name text)
  returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  m public.asifa_meetings; s public.students; c9 text; r jsonb;
  st int; en int; sl int; pname text;
begin
  select * into m from public.asifa_meetings where public_token = p_token limit 1;
  if not found then raise exception 'הקישור אינו תקין'; end if;
  if not m.reg_open then raise exception 'ההרשמה סגורה כרגע'; end if;
  select * into s from public.students where id = p_student_id and status = 'פעיל';
  if not found then raise exception 'התלמיד לא נמצא'; end if;
  -- טלפון קשר חובה: לפחות 9 ספרות
  c9 := public.norm_phone(p_contact_phone);
  if c9 is null then raise exception 'נא להזין טלפון ליצירת קשר (לפחות 9 ספרות)'; end if;
  -- הטלפון תואם לטלפון רשום של התלמיד: כמו רישום רגיל (כולל החלפת שעה)
  if public.asifa_phone_matches(s, c9) then
    return public.asifa_book(p_token, p_contact_phone, p_student_id, p_rav, p_slot);
  end if;
  select t.x into r from jsonb_array_elements(m.rabbis) as t(x)
    where t.x->>'name' = p_rav and t.x->'classes' @> to_jsonb(s.class_id) limit 1;
  if r is null then raise exception 'הרב שנבחר אינו מלמד את השיעור של התלמיד'; end if;
  if p_slot is null or p_slot !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception 'שעה לא תקינה'; end if;
  st := public.asifa_hhmm_to_min(r->>'start'); en := public.asifa_hhmm_to_min(r->>'end');
  sl := public.asifa_hhmm_to_min(p_slot);
  if sl < st or sl + m.slot_minutes > en or (sl - st) % m.slot_minutes <> 0 then
    raise exception 'השעה שנבחרה אינה זמינה אצל הרב';
  end if;
  if exists (select 1 from public.asifa_bookings b
              where b.meeting_id = m.id and b.student_id = s.id and b.rav = p_rav) then
    raise exception 'לבנכם כבר נקבעה פגישה. לשינוי פנו למזכירות המכינה';
  end if;
  if exists (select 1 from public.asifa_bookings b
              where b.meeting_id = m.id and b.student_id = s.id and b.rav <> p_rav
                and abs(public.asifa_hhmm_to_min(b.slot_time) - sl) < m.slot_minutes) then
    raise exception 'כבר נקבעה לבנכם פגישה אחרת באותה שעה, בחרו שעה אחרת';
  end if;
  pname := nullif(left(btrim(coalesce(p_parent_name, '')), 80), '');
  begin
    insert into public.asifa_bookings(meeting_id, rav, slot_time, student_id, parent_phone, parent_name, created_by)
      values (m.id, p_rav, p_slot, s.id, regexp_replace(p_contact_phone, '[^0-9]', '', 'g'), pname, 'parent_name');
  exception when unique_violation then
    raise exception 'השעה נתפסה הרגע, בחרו שעה אחרת';
  end;
  return jsonb_build_object('ok', true, 'rav', p_rav, 'slot', p_slot, 'date', m.date,
                            'full_name', public.asifa_full_name(s.name, s.family));
end $$;

grant execute on function public.asifa_public(text) to anon, authenticated;
grant execute on function public.asifa_lookup(text, text) to anon, authenticated;
grant execute on function public.asifa_roster(text) to anon, authenticated;
grant execute on function public.asifa_book_by_name(text, bigint, text, text, text, text) to anon, authenticated;
