-- migration_asifa_staff_login.sql — אסיפת הורים בתוך האזור האישי של הצוות (15/11/2026)
-- איש צוות מחובר (profiles.active) רואה את הפגישות שלו ואת לוח כל הצוות. מי שלא מחובר: null.
-- תוספת בלבד: עמודת user_id בטבלת asifa_staff_keys (קישור רב ← משתמש) + שתי פונקציות.
-- לא נוגע ב-RLS של asifa_meetings / asifa_bookings. אידמפוטנטי.

alter table public.asifa_staff_keys add column if not exists user_id uuid references public.profiles(id) on delete set null;

-- קישור לפי שם המשפחה: "הרב X" ← משתמש פעיל ששמו מסתיים ב-X (רק כשיש התאמה יחידה)
update public.asifa_staff_keys k
   set user_id = (select p.id from public.profiles p
                   where p.active is not false
                     and p.name like '%' || split_part(k.rav, ' ', array_length(string_to_array(k.rav, ' '), 1)))
 where k.user_id is null
   and (select count(*) from public.profiles p
         where p.active is not false
           and p.name like '%' || split_part(k.rav, ' ', array_length(string_to_array(k.rav, ' '), 1))) = 1;

-- פנימי: הלוח של אסיפה, כשהרב p_me ראשון. אין הרשאת הרצה לאף תפקיד חיצוני.
create or replace function public.asifa_staff_board(p_meeting bigint, p_me text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare m public.asifa_meetings;
begin
  select * into m from public.asifa_meetings where id = p_meeting;
  if not found then return null; end if;
  return jsonb_build_object(
    'title', m.title, 'date', m.date, 'slot_minutes', m.slot_minutes, 'me', p_me,
    'rabbis', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', r->>'name', 'start', r->>'start', 'end', r->>'end',
        'bookings', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'time', b.slot_time,
            'student', public.asifa_full_name(s.name, s.family),
            'class_name', split_part(coalesce(c.name, ''), ' - ', 1),
            'parent_name', b.parent_name,
            'phone', coalesce(nullif(b.parent_phone, ''), nullif(s.parent_phone, ''), nullif(s.mother_phone, ''))
          ) order by b.slot_time), '[]'::jsonb)
          from public.asifa_bookings b
          join public.students s on s.id = b.student_id
          left join public.classes c on c.id = s.class_id
          where b.meeting_id = m.id and b.rav = r->>'name')
      ) order by (r->>'name' is distinct from p_me), r->>'name'), '[]'::jsonb)
      from jsonb_array_elements(m.rabbis) r));
end $$;
revoke all on function public.asifa_staff_board(bigint, text) from public, anon, authenticated;

-- לאזור האישי: לפי המשתמש המחובר. האסיפה = הקרובה/האחרונה שאינה בדיקה ושלא עברה ביותר מיומיים.
create or replace function public.asifa_staff_my() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare uid uuid := auth.uid(); mid bigint; me text;
begin
  if uid is null then return null; end if;
  if not exists (select 1 from public.profiles p where p.id = uid and p.active is not false) then return null; end if;
  select id into mid from public.asifa_meetings
   where is_test = false and date >= current_date - 2 order by date, id limit 1;
  if mid is null then return null; end if;
  select rav into me from public.asifa_staff_keys where meeting_id = mid and user_id = uid limit 1;
  return public.asifa_staff_board(mid, me);
end $$;
revoke all on function public.asifa_staff_my() from public, anon;
grant execute on function public.asifa_staff_my() to authenticated;
