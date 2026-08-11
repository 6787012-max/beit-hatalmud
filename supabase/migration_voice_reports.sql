-- migration_voice_reports.sql — דיווחים קוליים ממורים.
-- מורה משאיר הודעה קולית בקו ימות → תמלול AI → טיוטת דיווח → אישור מנהל.
-- הרץ ב-Supabase SQL Editor אחרי schema.sql + policies.sql. בטוח להרצה חוזרת.

create table if not exists public.voice_reports (
  id           bigint generated always as identity primary key,
  audio_path   text,                                   -- נתיב ההקלטה בימות (ivr2:/...)
  audio_name   text,                                   -- שם הקובץ
  teacher_name text,                                   -- שם המורה כפי שזוהה מהקול
  student_id   bigint references public.students(id) on delete set null,  -- קישור אופציונלי
  transcript   text,                                   -- תמלול מלא של ההקלטה
  report_text  text,                                   -- טיוטת הדיווח (ניתנת לעריכה)
  report_type  text default 'general',                 -- behavior / functioning / general
  severity     text,                                   -- חיובי / שלילי / ניטרלי
  status       text not null default 'draft',          -- draft / approved / rejected
  created_by   uuid references public.profiles(id) on delete set null,
  approved_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  approved_at  timestamptz
);

create index if not exists idx_voice_reports_status on public.voice_reports(status);
create index if not exists idx_voice_reports_student on public.voice_reports(student_id);

alter table public.voice_reports enable row level security;

-- מנהל: גישה מלאה. מורה: רואה ויוצר טיוטות משלו, אך אישור סופי שמור למנהל.
drop policy if exists vr_admin_all on public.voice_reports;
create policy vr_admin_all on public.voice_reports for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists vr_own_read on public.voice_reports;
create policy vr_own_read on public.voice_reports for select
  using (created_by = auth.uid() or public.is_admin());

drop policy if exists vr_own_insert on public.voice_reports;
create policy vr_own_insert on public.voice_reports for insert
  with check (auth.uid() is not null);
