-- migration_asifa.sql — רישום הורים לתורים של רבע שעה באסיפת הורים (09/11/2026)
--
-- רק אובייקטים חדשים עם קידומת asifa_. לא נוגע בשום טבלה/פוליסי קיימים.
-- הורה (בלי כניסה) ניגש רק דרך ארבע פונקציות SECURITY DEFINER שנקראות עם טוקן האסיפה:
--   asifa_public / asifa_lookup / asifa_book / asifa_cancel
-- מנהל/מזכירה: כתיבה וקריאה ישירה לפי RLS. anon: כלום ישירות (אין פוליסי ל-anon).
-- אידמפוטנטי.

create table if not exists public.asifa_meetings (
  id            bigint generated always as identity primary key,
  title         text not null,
  date          date not null,
  slot_minutes  integer not null default 15 check (slot_minutes between 5 and 120),
  contact_text  text,
  reg_open      boolean not null default true,
  public_token  text not null unique default replace(gen_random_uuid()::text, '-', ''),
  -- [{name, classes:[class_id...], start:'20:30', end:'22:45', optional:bool}]
  rabbis        jsonb not null default '[]'::jsonb,
  is_test       boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.asifa_bookings (
  id            bigint generated always as identity primary key,
  meeting_id    bigint not null references public.asifa_meetings(id) on delete cascade,
  rav           text not null,
  slot_time     text not null check (slot_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  student_id    bigint not null references public.students(id) on delete cascade,
  parent_phone  text,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    text not null default 'parent' check (created_by in ('parent', 'admin')),
  constraint asifa_bookings_slot_uq unique (meeting_id, rav, slot_time),
  constraint asifa_bookings_student_uq unique (meeting_id, rav, student_id)
);
create index if not exists idx_asifa_bookings_meeting on public.asifa_bookings(meeting_id);

alter table public.asifa_meetings enable row level security;
alter table public.asifa_bookings enable row level security;

drop policy if exists asifa_meetings_admin on public.asifa_meetings;
create policy asifa_meetings_admin on public.asifa_meetings for all
  using (coalesce(public.is_admin(), false) or coalesce(public.my_role() = 'מזכירה', false))
  with check (coalesce(public.is_admin(), false) or coalesce(public.my_role() = 'מזכירה', false));

drop policy if exists asifa_bookings_admin on public.asifa_bookings;
create policy asifa_bookings_admin on public.asifa_bookings for all
  using (coalesce(public.is_admin(), false) or coalesce(public.my_role() = 'מזכירה', false))
  with check (coalesce(public.is_admin(), false) or coalesce(public.my_role() = 'מזכירה', false));

-- ===== עזרים פנימיים =====
create or replace function public.asifa_hhmm_to_min(t text) returns integer
  language sql immutable as
$$ select split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int $$;

-- שם פרטי: השם המלא בלי שם המשפחה שבסופו
create or replace function public.asifa_first_name(p_name text, p_family text) returns text
  language sql immutable as
$$ select case
     when coalesce(btrim(p_family), '') <> '' and right(btrim(p_name), length(btrim(p_family))) = btrim(p_family)
          and length(btrim(p_name)) > length(btrim(p_family))
       then btrim(left(btrim(p_name), length(btrim(p_name)) - length(btrim(p_family))))
     else split_part(btrim(p_name), ' ', 1) end $$;

-- האם הטלפון (מנורמל, 9 ספרות אחרונות) שייך להורה של התלמיד
create or replace function public.asifa_phone_matches(s public.students, p9 text) returns boolean
  language sql stable as
$$ select p9 is not null and p9 in (
     coalesce(public.norm_phone(s.parent_phone), ''),
     coalesce(public.norm_phone(s.mother_phone), ''),
     coalesce(public.norm_phone(s.reg->>'נייד אב'), ''),
     coalesce(public.norm_phone(s.reg->>'נייד אם'), ''),
     coalesce(public.norm_phone(s.reg->>'טלפון בבית'), '')) $$;

-- ===== ציבורי: פרטי האסיפה + שעות תפוסות (בלי שמות) =====
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
                  'optional', coalesce((r->>'optional')::boolean, false))), '[]'::jsonb)
                 from jsonb_array_elements(m.rabbis) r),
    'occupied', occ);
end $$;

-- ===== ציבורי: זיהוי לפי טלפון =====
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

-- ===== ציבורי: הזמנה (או החלפה) =====
create or replace function public.asifa_book(p_token text, p_phone text, p_student_id bigint, p_rav text, p_slot text)
  returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  m public.asifa_meetings; s public.students; p9 text; r jsonb;
  st int; en int; sl int;
begin
  select * into m from public.asifa_meetings where public_token = p_token limit 1;
  if not found then raise exception 'הקישור אינו תקין'; end if;
  if not m.reg_open then raise exception 'ההרשמה סגורה כרגע'; end if;
  p9 := public.norm_phone(p_phone);
  select * into s from public.students where id = p_student_id and status = 'פעיל';
  if not found or p9 is null or not public.asifa_phone_matches(s, p9) then
    raise exception 'מספר הטלפון אינו משויך לתלמיד זה';
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
  -- אותו תלמיד לא יכול להיות בשני מקומות במקביל
  if exists (select 1 from public.asifa_bookings b
              where b.meeting_id = m.id and b.student_id = s.id and b.rav <> p_rav
                and abs(public.asifa_hhmm_to_min(b.slot_time) - sl) < m.slot_minutes) then
    raise exception 'כבר נקבעה לבנכם פגישה אחרת באותה שעה, בחרו שעה אחרת';
  end if;
  delete from public.asifa_bookings where meeting_id = m.id and rav = p_rav and student_id = s.id;
  begin
    insert into public.asifa_bookings(meeting_id, rav, slot_time, student_id, parent_phone, created_by)
      values (m.id, p_rav, p_slot, s.id, p9, 'parent');
  exception when unique_violation then
    raise exception 'השעה נתפסה הרגע, בחרו שעה אחרת';
  end;
  return jsonb_build_object('ok', true, 'rav', p_rav, 'slot', p_slot, 'date', m.date);
end $$;

-- ===== ציבורי: ביטול =====
create or replace function public.asifa_cancel(p_token text, p_phone text, p_student_id bigint, p_rav text)
  returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare m public.asifa_meetings; s public.students; p9 text; n int;
begin
  select * into m from public.asifa_meetings where public_token = p_token limit 1;
  if not found then raise exception 'הקישור אינו תקין'; end if;
  if not m.reg_open then raise exception 'ההרשמה סגורה כרגע'; end if;
  p9 := public.norm_phone(p_phone);
  select * into s from public.students where id = p_student_id;
  if not found or p9 is null or not public.asifa_phone_matches(s, p9) then
    raise exception 'מספר הטלפון אינו משויך לתלמיד זה';
  end if;
  delete from public.asifa_bookings where meeting_id = m.id and rav = p_rav and student_id = s.id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n);
end $$;

grant execute on function public.asifa_public(text) to anon, authenticated;
grant execute on function public.asifa_lookup(text, text) to anon, authenticated;
grant execute on function public.asifa_book(text, text, bigint, text, text) to anon, authenticated;
grant execute on function public.asifa_cancel(text, text, bigint, text) to anon, authenticated;
