-- migration_trips.sql — פאנל טיולים (2026-08-26, בקשת יוסף)
--
-- טיול הוא ישות בפני עצמה: תאריך, יעד, מי משתתף, אילו קבצים מצורפים
-- (אישור טיול, אישור רכב, תוכנית), ואיזה טופס אישור הורים שייך לו.
--
-- **למה זה לא עוד "אירוע בלוח שנה":** מה שבאמת צריך מטיול הוא **דף מרוכז
-- להדפסה** — לכל תלמיד: פרטים, טלפוני הורים, המידע הרפואי מהמערכת, ומה
-- שההורה מילא בטופס אישור הטיול. זה חיתוך רוחבי של ארבע טבלאות, ואין לו
-- מקום טבעי בשום מסך קיים.
--
-- `form_id` מקשר את הטיול לטופס אישור ההורים שנשלח עבורו, וממנו נשלפות
-- התשובות (אלרגיות, תרופות, איש קשר לחירום) לדף ההדפסה.
--
-- **הרשאות:** קריאה לכל הצוות **חוץ ממלמד** (עקבי עם can_see_deep — מלמד
-- הוא "הזנה בלבד" ואין לו את המסך). כתיבה: מנהל ומזכירה.
-- הנתונים הרגישים בדף ההדפסה (רפואי, תשובות הורים) נשלפים מהטבלאות שלהם
-- ולכן נאכפים ב-RLS שלהן ממילא — הגנה בשתי שכבות.
--
-- אידמפוטנטי.

create table if not exists public.trips (
  id           bigserial primary key,
  name         text not null,
  trip_date    date,
  end_date     date,                 -- לטיול רב-יומי
  destination  text,
  departure    text,                 -- שעת יציאה / מקום איסוף
  notes        text,
  form_id      bigint references public.forms(id) on delete set null,
  drive_folder text,                 -- תיקיית הקבצים של הטיול
  status       text not null default 'מתוכנן',
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint trips_status check (status in ('מתוכנן', 'יצא', 'הסתיים', 'בוטל'))
);

-- מי משתתף. אין שורות = כל התלמידים (ברירת המחדל הנפוצה בטיול מוסדי).
create table if not exists public.trip_participants (
  trip_id    bigint not null references public.trips(id) on delete cascade,
  student_id bigint not null references public.students(id) on delete cascade,
  primary key (trip_id, student_id)
);
create index if not exists trip_part_student_idx on public.trip_participants(student_id);

alter table public.trips             enable row level security;
alter table public.trip_participants enable row level security;

-- מי רשאי לנהל טיולים
create or replace function public.can_manage_trips() returns boolean
  language sql stable security definer set search_path = public as
$$ select public.is_admin() or public.my_role() = 'מזכירה' $$;

-- מי רשאי לראות. מלמד מוחרג — כמו בשאר נתוני העומק (can_see_deep).
create or replace function public.can_view_trips() returns boolean
  language sql stable security definer set search_path = public as
$$ select public.is_staff() and public.my_role() is distinct from 'מלמד' $$;

drop policy if exists trip_read on public.trips;
create policy trip_read on public.trips for select using (public.can_view_trips());
drop policy if exists trip_write on public.trips;
create policy trip_write on public.trips for all
  using (public.can_manage_trips()) with check (public.can_manage_trips());

drop policy if exists tpart_read on public.trip_participants;
create policy tpart_read on public.trip_participants for select using (public.can_view_trips());
drop policy if exists tpart_write on public.trip_participants;
create policy tpart_write on public.trip_participants for all
  using (public.can_manage_trips()) with check (public.can_manage_trips());

grant select, insert, update, delete on public.trips, public.trip_participants to authenticated;
grant usage, select on sequence public.trips_id_seq to authenticated;

drop trigger if exists trips_touch_trg on public.trips;
create or replace function public.trips_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger trips_touch_trg before update on public.trips
  for each row execute function public.trips_touch();
