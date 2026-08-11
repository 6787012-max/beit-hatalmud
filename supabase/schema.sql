-- cheder-v3 · סכמת Supabase (Postgres) — הרץ פעם אחת ב-SQL Editor של פרויקט Supabase חדש.
-- הנתונים פרטיים ומוגנים ע"י RLS (שומר אבטחה בצד-שרת). ראה policies.sql.

-- ===== פרופילים (מקושר ל-Supabase Auth) =====
create table if not exists public.profiles (
  id      uuid primary key references auth.users(id) on delete cascade,
  email   text unique,
  tz      text unique,           -- ת״ז (כניסה: ת״ז ממופה למייל סינתטי {tz}@bht.co.il)
  name    text not null default '',
  role    text not null default 'צוות',   -- מנהל / מורה / צוות
  perms   text[],                -- מסכים מורשים (null = כל הלא-ניהוליים; אכיפה ב-RLS/צד-שרת)
  active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id       bigint generated always as identity primary key,
  name     text not null,
  melamed  uuid references public.profiles(id) on delete set null,
  year     text,
  active   boolean not null default true
);

-- לאיזה כיתות מורה מורשה (מנהל = הכל)
create table if not exists public.user_class_access (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  class_id bigint not null references public.classes(id) on delete cascade,
  primary key (user_id, class_id)
);

create table if not exists public.students (
  id           bigint generated always as identity primary key,
  name         text not null,
  class_id     bigint references public.classes(id) on delete set null,
  birthdate    date,
  parent_name  text,
  parent_phone text,
  address      text,
  status       text not null default 'פעיל',
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_students_class on public.students(class_id);

create table if not exists public.categories (
  id       bigint generated always as identity primary key,
  name     text not null,
  kind     text not null default 'behavior',  -- behavior / reading / writing
  severity text,
  color    text
);

create table if not exists public.behavior_events (
  id          bigint generated always as identity primary key,
  student_id  bigint not null references public.students(id) on delete cascade,
  category_id bigint references public.categories(id) on delete set null,
  severity    text,
  event_date  date not null default current_date,
  event_time  text,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_behavior_student on public.behavior_events(student_id);

create table if not exists public.subjects (
  id   bigint generated always as identity primary key,
  name text not null
);

create table if not exists public.attendance (
  id         bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  class_id   bigint references public.classes(id) on delete set null,
  date       date not null default current_date,
  status     text not null,   -- present / absent / late
  note       text,
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists idx_att_student_date on public.attendance(student_id, date);

create table if not exists public.tests (
  id         bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  subject    text,
  grade      numeric,
  test_date  date not null default current_date,
  note       text,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.functioning (
  id          bigint generated always as identity primary key,
  student_id  bigint not null references public.students(id) on delete cascade,
  area        text,
  score       numeric,
  report_date date not null default current_date,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null
);

-- רגיש: RLS מגביל לתפקידים מורשים בלבד
create table if not exists public.medications (
  id         bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  kind       text not null,   -- allergy / medication
  name       text not null,
  details    text,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.conversations (
  id         bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  date       date not null default current_date,
  summary    text,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.meetings (
  id         bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  date       date not null default current_date,
  attendees  text,
  summary    text,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.reading (
  id         bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  level      text,
  date       date not null default current_date,
  note       text,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.writing (
  id         bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  level      text,
  date       date not null default current_date,
  note       text,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.tuition (
  id         bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  month      text not null,       -- YYYY-MM
  pay_date   date,                -- תאריך תשלום מלא (יום בחודש)
  amount     numeric,
  method     text,                -- מזומן / העברה / בית ספר / נדרים פלוס
  status     text not null default 'due',  -- paid / due
  note       text
);

-- קופה כללית: הכנסות נוספות (מעבר לגבייה) והוצאות (עובדים/כלליות)
create table if not exists public.income (
  id     bigint generated always as identity primary key,
  date   date not null default current_date,
  source text,
  amount numeric,
  method text,
  note   text,
  created_by uuid references public.profiles(id) on delete set null
);
create table if not exists public.expenses (
  id      bigint generated always as identity primary key,
  date    date not null default current_date,
  name    text not null,
  tz      text,
  kind    text,      -- עובד / כללית
  method  text,
  payslip text,      -- עם תלוש / ללא תלוש
  amount  numeric,
  note    text,
  created_by uuid references public.profiles(id) on delete set null
);

-- ===== טפסים וחתימות הורים =====
create table if not exists public.forms (
  id         bigint generated always as identity primary key,
  title      text not null,
  body       text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.form_responses (
  id          bigint generated always as identity primary key,
  form_id     bigint not null references public.forms(id) on delete cascade,
  student_id  bigint references public.students(id) on delete set null,
  status      text not null default 'pending',   -- pending / signed
  signer_name text,
  signed_at   date,
  token       text unique,                        -- קישור אישי לחתימת הורה (sign.html?f=..&t=..)
  created_at  timestamptz not null default now()
);
create index if not exists idx_formresp_form on public.form_responses(form_id);
create index if not exists idx_formresp_token on public.form_responses(token);

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  kind       text,     -- bug / idea
  body       text not null,
  status     text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  bigint,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_time on public.audit_log(created_at);

-- ===== יצירת פרופיל אוטומטית בהרשמה (Supabase Auth) =====
create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as
$$
begin
  insert into public.profiles (id, email, tz, name)
  values (new.id, new.email, split_part(new.email, '@', 1), coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();
