-- ═══════════════════════════════════════════════════════════════
-- cheder-v3 · הקמה מלאה בהרצה אחת (ניתן להריץ שוב בבטחה). SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════

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


-- cheder-v3 · RLS — שומר האבטחה. הרץ אחרי schema.sql.
-- עיקרון: deny-by-default. מנהל רואה הכל; מורה רק את הכיתות שהוקצו לו; רפואי מוגבל.

-- ===== פונקציות עזר (SECURITY DEFINER — עוקפות RLS כדי למנוע רקורסיה) =====
create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() and active $$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce(public.my_role() = 'מנהל', false) $$;

create or replace function public.has_class_access(cid bigint) returns boolean
  language sql stable security definer set search_path = public as
$$ select public.is_admin()
     or exists (select 1 from public.user_class_access u where u.user_id = auth.uid() and u.class_id = cid)
     or exists (select 1 from public.classes c where c.id = cid and c.melamed = auth.uid()) $$;

create or replace function public.can_see_student(sid bigint) returns boolean
  language sql stable security definer set search_path = public as
$$ select public.is_admin()
     or exists (select 1 from public.students s where s.id = sid and public.has_class_access(s.class_id)) $$;

-- ===== הפעלת RLS על כל הטבלאות =====
alter table public.profiles          enable row level security;
alter table public.classes           enable row level security;
alter table public.user_class_access enable row level security;
alter table public.students          enable row level security;
alter table public.categories        enable row level security;
alter table public.behavior_events   enable row level security;
alter table public.attendance        enable row level security;
alter table public.tests             enable row level security;
alter table public.functioning       enable row level security;
alter table public.medications       enable row level security;
alter table public.conversations     enable row level security;
alter table public.meetings          enable row level security;
alter table public.reading           enable row level security;
alter table public.writing           enable row level security;
alter table public.tuition           enable row level security;
alter table public.feedback          enable row level security;
alter table public.audit_log         enable row level security;

-- ===== profiles =====
drop policy if exists prof_self_read on public.profiles;
create policy prof_self_read  on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists prof_admin_all on public.profiles;
create policy prof_admin_all  on public.profiles for all    using (public.is_admin()) with check (public.is_admin());

-- ===== classes / access =====
drop policy if exists cls_read on public.classes;
create policy cls_read  on public.classes for select using (public.has_class_access(id));
drop policy if exists cls_admin on public.classes;
create policy cls_admin on public.classes for all    using (public.is_admin()) with check (public.is_admin());
drop policy if exists uca_admin on public.user_class_access;
create policy uca_admin on public.user_class_access for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists uca_self on public.user_class_access;
create policy uca_self  on public.user_class_access for select using (user_id = auth.uid() or public.is_admin());

-- ===== categories (משותף לכולם לקריאה; שינוי למנהל) =====
drop policy if exists cat_read on public.categories;
create policy cat_read  on public.categories for select using (auth.uid() is not null);
drop policy if exists cat_admin on public.categories;
create policy cat_admin on public.categories for all    using (public.is_admin()) with check (public.is_admin());

-- ===== students =====
drop policy if exists stu_read on public.students;
create policy stu_read on public.students for select using (public.has_class_access(class_id));
drop policy if exists stu_ins on public.students;
create policy stu_ins  on public.students for insert with check (public.has_class_access(class_id));
drop policy if exists stu_upd on public.students;
create policy stu_upd  on public.students for update using (public.has_class_access(class_id)) with check (public.has_class_access(class_id));
drop policy if exists stu_del on public.students;
create policy stu_del  on public.students for delete using (public.is_admin());

-- ===== מקרו לוגי לטבלאות תלויות-תלמיד (מיושם פרטנית לכל טבלה) =====
-- behavior_events
drop policy if exists beh_read on public.behavior_events;
create policy beh_read on public.behavior_events for select using (public.can_see_student(student_id));
drop policy if exists beh_ins on public.behavior_events;
create policy beh_ins  on public.behavior_events for insert with check (public.can_see_student(student_id));
drop policy if exists beh_upd on public.behavior_events;
create policy beh_upd  on public.behavior_events for update using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
drop policy if exists beh_del on public.behavior_events;
create policy beh_del  on public.behavior_events for delete using (public.can_see_student(student_id));
-- attendance
drop policy if exists att_read on public.attendance;
create policy att_read on public.attendance for select using (public.can_see_student(student_id));
drop policy if exists att_ins on public.attendance;
create policy att_ins  on public.attendance for insert with check (public.can_see_student(student_id));
drop policy if exists att_upd on public.attendance;
create policy att_upd  on public.attendance for update using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
drop policy if exists att_del on public.attendance;
create policy att_del  on public.attendance for delete using (public.can_see_student(student_id));
-- tests
drop policy if exists tst_read on public.tests;
create policy tst_read on public.tests for select using (public.can_see_student(student_id));
drop policy if exists tst_ins on public.tests;
create policy tst_ins  on public.tests for insert with check (public.can_see_student(student_id));
drop policy if exists tst_upd on public.tests;
create policy tst_upd  on public.tests for update using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
drop policy if exists tst_del on public.tests;
create policy tst_del  on public.tests for delete using (public.can_see_student(student_id));
-- functioning
drop policy if exists fnc_read on public.functioning;
create policy fnc_read on public.functioning for select using (public.can_see_student(student_id));
drop policy if exists fnc_all on public.functioning;
create policy fnc_all  on public.functioning for all using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
-- conversations
drop policy if exists cnv_all on public.conversations;
create policy cnv_all  on public.conversations for all using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
-- meetings
drop policy if exists mtg_all on public.meetings;
create policy mtg_all  on public.meetings for all using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
-- reading
drop policy if exists rdg_all on public.reading;
create policy rdg_all  on public.reading for all using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
-- writing
drop policy if exists wrt_all on public.writing;
create policy wrt_all  on public.writing for all using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));

-- ===== רפואי — מוגבל: קריאה לפי כיתה, שינוי למנהל בלבד =====
drop policy if exists med_read on public.medications;
create policy med_read on public.medications for select using (public.can_see_student(student_id));
drop policy if exists med_write on public.medications;
create policy med_write on public.medications for all using (public.is_admin()) with check (public.is_admin());

-- ===== כספים — מנהל + מזכירה (מזכירה = כספים בלבד); מפקח קורא =====
alter table public.tuition   enable row level security;
alter table public.income    enable row level security;
alter table public.expenses  enable row level security;
alter table public.subjects  enable row level security;
drop policy if exists tui_money on public.tuition;
create policy tui_money on public.tuition for all
  using (public.is_admin() or public.my_role() in ('מזכירה','מפקח'))
  with check (public.is_admin() or public.my_role() = 'מזכירה');
drop policy if exists inc_money on public.income;
create policy inc_money on public.income for all
  using (public.is_admin() or public.my_role() in ('מזכירה','מפקח'))
  with check (public.is_admin() or public.my_role() = 'מזכירה');
drop policy if exists exp_money on public.expenses;
create policy exp_money on public.expenses for all
  using (public.is_admin() or public.my_role() in ('מזכירה','מפקח'))
  with check (public.is_admin() or public.my_role() = 'מזכירה');
drop policy if exists subj_read on public.subjects;
create policy subj_read on public.subjects for select using (auth.uid() is not null);
drop policy if exists subj_admin on public.subjects;
create policy subj_admin on public.subjects for all using (public.is_admin()) with check (public.is_admin());

-- ===== feedback =====
drop policy if exists fb_ins on public.feedback;
create policy fb_ins  on public.feedback for insert with check (auth.uid() is not null);
drop policy if exists fb_read on public.feedback;
create policy fb_read on public.feedback for select using (public.is_admin() or user_id = auth.uid());

-- ===== audit_log — קריאה למנהל; כתיבה לכל מאומת (רישום פעולות) =====
drop policy if exists aud_read on public.audit_log;
create policy aud_read on public.audit_log for select using (public.is_admin());
drop policy if exists aud_ins on public.audit_log;
create policy aud_ins  on public.audit_log for insert with check (auth.uid() is not null);

-- ===== טפסים וחתימות הורים =====
alter table public.forms          enable row level security;
alter table public.form_responses enable row level security;

-- צוות מאומת מנהל את הטפסים (מוסדיים). הורים אינם ניגשים ישירות — רק דרך פונקציות RPC למטה.
drop policy if exists forms_staff on public.forms;
create policy forms_staff on public.forms for all using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists fr_staff on public.form_responses;
create policy fr_staff on public.form_responses for all
  using (public.is_admin() or student_id is null or public.can_see_student(student_id))
  with check (public.is_admin() or student_id is null or public.can_see_student(student_id));

-- חתימת הורה ללא התחברות: גישה מוגבלת לפונקציות SECURITY DEFINER לפי טוקן/מזהה בלבד.
-- ההורה לא יכול למנות/לקרוא טפסים אחרים — רק את הטופס שהקישור שלו בידיו.
create or replace function public.get_signing(p_token text)
  returns table(form_id bigint, title text, body text, status text, signer_name text, signed_at date)
  language sql stable security definer set search_path = public as
$$ select f.id, f.title, f.body, r.status, r.signer_name, r.signed_at
     from public.form_responses r join public.forms f on f.id = r.form_id
    where r.token = p_token $$;

create or replace function public.get_form(p_form_id bigint)
  returns table(form_id bigint, title text, body text)
  language sql stable security definer set search_path = public as
$$ select id, title, body from public.forms where id = p_form_id $$;

create or replace function public.submit_signature(p_token text, p_name text)
  returns boolean language plpgsql security definer set search_path = public as
$$ declare n int;
begin
  if length(coalesce(p_name,'')) < 2 then return false; end if;
  update public.form_responses set status='signed', signer_name=p_name, signed_at=current_date
    where token = p_token and status <> 'signed';
  get diagnostics n = row_count; return n > 0;
end $$;

create or replace function public.submit_general(p_form_id bigint, p_name text)
  returns boolean language plpgsql security definer set search_path = public as
$$ begin
  if length(coalesce(p_name,'')) < 2 then return false; end if;
  if not exists (select 1 from public.forms where id = p_form_id) then return false; end if;
  insert into public.form_responses(form_id, status, signer_name, signed_at, token)
    values (p_form_id, 'signed', p_name, current_date, 'web-'||md5(random()::text||clock_timestamp()::text));
  return true;
end $$;

revoke all on function public.get_signing(text), public.get_form(bigint),
  public.submit_signature(text, text), public.submit_general(bigint, text) from public;
grant execute on function public.get_signing(text)              to anon, authenticated;
grant execute on function public.get_form(bigint)               to anon, authenticated;
grant execute on function public.submit_signature(text, text)   to anon, authenticated;
grant execute on function public.submit_general(bigint, text)   to anon, authenticated;
