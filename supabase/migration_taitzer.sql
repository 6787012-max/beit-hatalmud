-- migration_taitzer.sql — יצוא שבועי להטענת כרטיס נטען ("טייצר").
-- החליף מנגנון קודם שהיה בגיליון Google Sheets נפרד (של הרב וינברג) — יוסף
-- ביקש (09/09/2026) שזה יעבור לגמרי לתוך התוכנה, לא קשור ל-Sheets בכלל.
-- הרץ ב-Supabase SQL Editor אחרי schema.sql + policies.sql. בטוח להרצה חוזרת.

-- ── רשימת כרטיסים: המקור-האמת לנתוני הכרטיס הקבועים (כמעט לא משתנה) ──
create table if not exists public.taitzer_cards (
  id            bigint generated always as identity primary key,
  tz            text not null unique,                    -- תעודת זהות — מפתח ההצלבה
  card_number   text,                                     -- מס כרטיס
  stripe        text,                                     -- סטריפ (נתוני מגנט)
  mobile        text,
  mobile2       text,
  phone         text,
  email         text,
  birthdate     date,
  title         text,                                     -- תואר (התלמיד/הרב)
  family        text,
  first_name    text,
  honorific     text,                                     -- סיומת כבוד (ני"ו/שליט"א)
  holder_name   text,                                     -- שם מחזיק הכרטיס
  community     text,                                     -- קהילה (תלמידים/צוות)
  neighborhood  text,
  city_field    text,                                     -- "עיר" בפורמט טייצר — בפועל שם השיעור, לא עיר אמיתית
  address       text,
  house_no      text,
  apartment     text,
  notes         text,
  status        text not null default 'פעיל',
  card_group    text,                                     -- קבוצת כרטיסים
  prev_card     numeric default 0,
  extra_tz      text,                                     -- תעודת זהות נוספת
  internal_id   text,
  created_at    timestamptz not null default now()
);

-- ── מצב שבועי נוכחי: אישור + סכום להטענה, מוחלף כל שבוע (לא היסטוריה) ──
create table if not exists public.taitzer_weekly (
  id            bigint generated always as identity primary key,
  tz            text not null unique,
  name          text,                                     -- לתצוגה נוחה בלי join
  approved      boolean not null default false,
  amount        numeric not null default 0,
  exported_at   timestamptz,                               -- מתי יוצא לאחרונה (null = טרם יוצא)
  updated_at    timestamptz not null default now()
);

create index if not exists idx_taitzer_weekly_tz on public.taitzer_weekly(tz);

alter table public.taitzer_cards enable row level security;
alter table public.taitzer_weekly enable row level security;

-- מידע כספי/כרטיסים — מנהל/מזכירה/מפקח בלבד, כמו tuition/income/expenses
-- (migration_emanuel.sql).
drop policy if exists taitzer_cards_office on public.taitzer_cards;
create policy taitzer_cards_office on public.taitzer_cards for all
  using (public.is_admin() or public.my_role() in ('מזכירה', 'מפקח'))
  with check (public.is_admin() or public.my_role() in ('מזכירה', 'מפקח'));

drop policy if exists taitzer_weekly_office on public.taitzer_weekly;
create policy taitzer_weekly_office on public.taitzer_weekly for all
  using (public.is_admin() or public.my_role() in ('מזכירה', 'מפקח'))
  with check (public.is_admin() or public.my_role() in ('מזכירה', 'מפקח'));
