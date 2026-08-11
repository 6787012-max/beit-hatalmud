-- ═══════════════════════════════════════════════════════════════
-- מיגרציית תיקונים ושדרוגים (2026-07-21). הרץ ב-SQL Editor. בטוח להריץ שוב.
-- ═══════════════════════════════════════════════════════════════

-- 1) מבחנים: עמודת "שם הבוחן" (בקשת עמנואל)
alter table public.tests add column if not exists examiner text;

-- 2) טפסים גמישים: הגדרת שדות (JSON) + תשובות + חתימה ידנית (data-URL)
alter table public.forms          add column if not exists fields jsonb;      -- מערך שדות: [{key,label,type,options,required}]
alter table public.form_responses add column if not exists answers jsonb;     -- {key: value}
alter table public.form_responses add column if not exists signature text;    -- ציור חתימה (data:image/png;base64,...)

-- 3) פונקציות החתימה הציבוריות — לעדכן שיחזירו/יקבלו גם fields/answers/signature
-- חובה למחוק קודם: שינינו את סוג-ההחזרה/החתימה, ו-Postgres לא מרשה CREATE OR REPLACE על שינוי כזה
drop function if exists public.get_signing(text);
drop function if exists public.get_form(bigint);
drop function if exists public.submit_signature(text, text);
drop function if exists public.submit_signature(text, text, jsonb, text);

create or replace function public.get_signing(p_token text)
  returns table(form_id bigint, title text, body text, fields jsonb, status text, signer_name text, signed_at date, answers jsonb, signature text)
  language sql stable security definer set search_path = public as
$$ select f.id, f.title, f.body, f.fields, r.status, r.signer_name, r.signed_at, r.answers, r.signature
     from public.form_responses r join public.forms f on f.id = r.form_id
    where r.token = p_token $$;

create or replace function public.get_form(p_form_id bigint)
  returns table(form_id bigint, title text, body text, fields jsonb)
  language sql stable security definer set search_path = public as
$$ select id, title, body, fields from public.forms where id = p_form_id $$;

create or replace function public.submit_signature(p_token text, p_name text, p_answers jsonb default null, p_signature text default null)
  returns boolean language plpgsql security definer set search_path = public as
$$ declare n int;
begin
  if length(coalesce(p_name,'')) < 2 then return false; end if;
  update public.form_responses
     set status='signed', signer_name=p_name, signed_at=current_date,
         answers=coalesce(p_answers, answers), signature=coalesce(p_signature, signature)
   where token = p_token and status <> 'signed';
  get diagnostics n = row_count; return n > 0;
end $$;

grant execute on function public.get_signing(text)                                         to anon, authenticated;
grant execute on function public.get_form(bigint)                                          to anon, authenticated;
grant execute on function public.submit_signature(text, text, jsonb, text)                 to anon, authenticated;

-- 4) אינדקסים שימושיים לתצוגות "לפי"
create index if not exists idx_students_status on public.students(status);
create index if not exists idx_tuition_student on public.tuition(student_id);

-- ═══════════════════════════════════════════════════════════════
-- v2 (2026-07-21): משימות, פרויקטים, לוח שנה — טבלאות + RLS מאובטח
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.projects (
  id          bigint generated always as identity primary key,
  name        text not null,
  description text,
  status      text not null default 'active',   -- active / done / archived
  color       text,
  due_date    date,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id          bigint generated always as identity primary key,
  title       text not null,
  description text,
  project_id  bigint references public.projects(id) on delete set null,
  assignee    uuid   references public.profiles(id) on delete set null,
  student_id  bigint references public.students(id) on delete set null,
  due_date    date,
  priority    text default 'רגיל',              -- נמוך / רגיל / גבוה
  status      text not null default 'open',      -- open / in_progress / done
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_tasks_status on public.tasks(status);
create index if not exists idx_tasks_due    on public.tasks(due_date);

create table if not exists public.calendar_events (
  id          bigint generated always as identity primary key,
  title       text not null,
  date        date not null,
  end_date    date,
  time        text,
  kind        text default 'event',              -- event / holiday / meeting / reminder
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_calevents_date on public.calendar_events(date);

alter table public.projects        enable row level security;
alter table public.tasks           enable row level security;
alter table public.calendar_events enable row level security;

-- אבטחה: רק צוות מאומת רואה/יוצר; עדכון/מחיקה — היוצר או מנהל (deny-by-default).
drop policy if exists proj_read on public.projects;
create policy proj_read on public.projects for select using (auth.uid() is not null);
drop policy if exists proj_ins on public.projects;
create policy proj_ins  on public.projects for insert with check (auth.uid() is not null);
drop policy if exists proj_mod on public.projects;
create policy proj_mod  on public.projects for update using (public.is_admin() or created_by = auth.uid()) with check (public.is_admin() or created_by = auth.uid());
drop policy if exists proj_del on public.projects;
create policy proj_del  on public.projects for delete using (public.is_admin() or created_by = auth.uid());

drop policy if exists task_read on public.tasks;
create policy task_read on public.tasks for select using (auth.uid() is not null);
drop policy if exists task_ins on public.tasks;
create policy task_ins  on public.tasks for insert with check (auth.uid() is not null);
drop policy if exists task_mod on public.tasks;
create policy task_mod  on public.tasks for update using (public.is_admin() or created_by = auth.uid() or assignee = auth.uid()) with check (public.is_admin() or created_by = auth.uid() or assignee = auth.uid());
drop policy if exists task_del on public.tasks;
create policy task_del  on public.tasks for delete using (public.is_admin() or created_by = auth.uid());

drop policy if exists cal_read on public.calendar_events;
create policy cal_read on public.calendar_events for select using (auth.uid() is not null);
drop policy if exists cal_ins on public.calendar_events;
create policy cal_ins  on public.calendar_events for insert with check (auth.uid() is not null);
drop policy if exists cal_mod on public.calendar_events;
create policy cal_mod  on public.calendar_events for update using (public.is_admin() or created_by = auth.uid()) with check (public.is_admin() or created_by = auth.uid());
drop policy if exists cal_del on public.calendar_events;
create policy cal_del  on public.calendar_events for delete using (public.is_admin() or created_by = auth.uid());

-- v3 (2026-07-21): כניסה לפי שם — המרת שם → כתובת מייל סינתטית
create or replace function public.email_by_name(p_name text)
  returns text language sql stable security definer set search_path = public as
$$ select email from public.profiles where name = p_name and coalesce(active, true) order by created_at limit 1 $$;
grant execute on function public.email_by_name(text) to anon, authenticated;

-- v4 (2026-07-21): גם הקישור הכללי (בלי טוקן) ישמור תשובות+חתימה
drop function if exists public.submit_general(bigint, text);
drop function if exists public.submit_general(bigint, text, jsonb, text);
create or replace function public.submit_general(p_form_id bigint, p_name text, p_answers jsonb default null, p_signature text default null)
  returns boolean language plpgsql security definer set search_path = public as
$$ begin
  if length(coalesce(p_name,'')) < 2 then return false; end if;
  if not exists (select 1 from public.forms where id = p_form_id) then return false; end if;
  insert into public.form_responses(form_id, status, signer_name, signed_at, token, answers, signature)
    values (p_form_id, 'signed', p_name, current_date, 'web-'||md5(random()::text||clock_timestamp()::text), p_answers, p_signature);
  return true;
end $$;
grant execute on function public.submit_general(bigint, text, jsonb, text) to anon, authenticated;

-- v5 (2026-07-21): רמת גישה פר-משתמש (override על ברירת המחדל של התפקיד)
alter table public.profiles add column if not exists access_mode text;   -- null / full / readonly / writeonly
