-- migration_tla.sql — תל"א: תכנית לימודים אישית (2026-08-19)
-- מבוסס על התבנית הרשמית של המכינה (7 עמודים): שער · מערכת שעות אישית ·
-- ישיבות צוות · שיחות הורים · דף הכנה (פרופיל) · התל"א עצמו.
-- הרשאות: כמו שאר מודולי התלמיד — can_see_student (צוות לפי כיתות, מנהל=הכל).

-- ===== 1) תכנית (ראש) =====
create table if not exists public.tla_plans (
  id           bigserial primary key,
  student_id   bigint not null references public.students(id) on delete cascade,
  year_label   text,                       -- שנה"ל, למשל תשפ"ו
  class_label  text,                       -- כיתה (טקסט חופשי, עצמאי מ-class_id)
  mentor       text,                       -- מחנך
  status       text default 'טיוטה',        -- טיוטה | פעילה | הסתיימה
  profile      jsonb default '{}'::jsonb,  -- {background,env,strengths,focus} — דף ההכנה
  slots        jsonb default '[]'::jsonb,  -- משבצות זמן למערכת: [{from,to}] — ניתן לשינוי
  signed_by    text,                       -- חתימת הורים (שם)
  signed_at    date,
  created_by   uuid default auth.uid(),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists tla_plans_student on public.tla_plans(student_id);

-- ===== 2) יעדים (עמוד התל"א) =====
create table if not exists public.tla_goals (
  id           bigserial primary key,
  plan_id      bigint not null references public.tla_plans(id) on delete cascade,
  domain       text,      -- תחום: לימודי | רגשי | חברתי | התנהגותי (חופשי)
  baseline     text,      -- קו בסיס / מצב קיים
  top_goal     text,      -- מטרת על
  goal_sum     text,      -- מטרה מסכמת
  goal_exec    text,      -- מטרה מבצעת
  roles        jsonb default '{}'::jsonb,  -- {"מנהל חינוכי":"…","מורה פרטי":"…","מחנך":"…"} — ניתן להוסיף תפקידים
  means        text,      -- אמצעים והתאמות / יעדים
  achievements text,      -- הישגים
  notes        text,      -- הערות ושינויים משמעותיים במהלך השנה
  sort_order   int default 0,
  created_by   uuid default auth.uid(),
  created_at   timestamptz default now()
);
create index if not exists tla_goals_plan on public.tla_goals(plan_id);

-- ===== 3) ישיבות צוות ושיחות הורים =====
create table if not exists public.tla_meetings (
  id           bigserial primary key,
  plan_id      bigint not null references public.tla_plans(id) on delete cascade,
  kind         text not null default 'צוות',  -- צוות | הורים
  heb_month    text,        -- אלול / חשון / כסלו …
  meeting_date date,
  summary      text,        -- סיכום והמלצות
  participants text,        -- משתתפים (בישיבת צוות)
  follow_up    text,        -- הובא לידיעת… / המשך טיפול
  sort_order   int default 0,
  created_by   uuid default auth.uid(),
  created_at   timestamptz default now()
);
create index if not exists tla_meetings_plan on public.tla_meetings(plan_id);

-- ===== 4) מערכת שעות אישית =====
create table if not exists public.tla_schedule (
  id         bigserial primary key,
  plan_id    bigint not null references public.tla_plans(id) on delete cascade,
  day_num    int not null,          -- 1=ראשון … 6=שישי
  slot_idx   int not null,          -- אינדקס משבצת מתוך plans.slots
  subject    text,
  highlight  text,                  -- '' | green | pink | orange | blue — סוג התאמה
  note       text,
  created_by uuid default auth.uid()
);
create unique index if not exists tla_schedule_cell on public.tla_schedule(plan_id, day_num, slot_idx);

-- ===== 5) תבנית מערכת כיתתית (מעתיקים ממנה ומשנים רק את ההתאמות) =====
create table if not exists public.tla_class_templates (
  id         bigserial primary key,
  class_id   bigint references public.classes(id) on delete cascade,
  name       text,
  slots      jsonb default '[]'::jsonb,
  cells      jsonb default '[]'::jsonb,   -- [{day_num,slot_idx,subject}]
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);

-- ===== RLS =====
alter table public.tla_plans           enable row level security;
alter table public.tla_goals           enable row level security;
alter table public.tla_meetings        enable row level security;
alter table public.tla_schedule        enable row level security;
alter table public.tla_class_templates enable row level security;

-- עוזר: האם מותר לי לגעת בתכנית הזו (לפי התלמיד שלה)
create or replace function public.can_see_tla(pid bigint) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.tla_plans p
                  where p.id = pid and public.can_see_student(p.student_id)) $$;

drop policy if exists tla_plan_all  on public.tla_plans;
create policy tla_plan_all  on public.tla_plans  for all
  using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));

drop policy if exists tla_goal_all  on public.tla_goals;
create policy tla_goal_all  on public.tla_goals  for all
  using (public.can_see_tla(plan_id)) with check (public.can_see_tla(plan_id));

drop policy if exists tla_meet_all  on public.tla_meetings;
create policy tla_meet_all  on public.tla_meetings for all
  using (public.can_see_tla(plan_id)) with check (public.can_see_tla(plan_id));

drop policy if exists tla_sched_all on public.tla_schedule;
create policy tla_sched_all on public.tla_schedule for all
  using (public.can_see_tla(plan_id)) with check (public.can_see_tla(plan_id));

drop policy if exists tla_tmpl_all  on public.tla_class_templates;
create policy tla_tmpl_all  on public.tla_class_templates for all
  using (public.is_admin() or public.has_class_access(class_id))
  with check (public.is_admin() or public.has_class_access(class_id));
