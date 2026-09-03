-- migration_behavior_followup.sql — דגל "מעקב" על דיווחי התנהגות + תגובות מתוארכות (2026-09-03, בקשת יוסף)
--
-- כל רב/מלמד יכול לסמן דיווח בודד כ"במעקב" (מקרה שדורש טיפול המשך —
-- למשל "הפריע, צריך לדבר עם אמא"). על דיווח שסומן כך אפשר לצבור עדכונים
-- מתוארכים לאורך זמן ("דיברתי עם ההורים, הם יודעים" / "צריך להפנות לאבחון"),
-- בלי לפתוח בכל פעם דיווח חדש נפרד. הלשונית "מעקב דחוף" (js/app.js) מרכזת
-- את כל הדיווחים המסומנים כך בכל הכיתות, כל אחת עם ציר-הזמן שלה.
--
-- הרשאות: זהות לחלוטין ל-behavior_events עצמה (can_see_student דרך העמודה
-- student_id של הדיווח שאליו שייכת התגובה) — אין הרחבת חשיפה.
--
-- אידמפוטנטי.

alter table public.behavior_events add column if not exists followup boolean not null default false;

create table if not exists public.behavior_comments (
  id           bigint generated always as identity primary key,
  event_id     bigint not null references public.behavior_events(id) on delete cascade,
  comment_date date not null default current_date,
  note         text not null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_behavior_comments_event on public.behavior_comments(event_id);

alter table public.behavior_comments enable row level security;
drop policy if exists bc_all on public.behavior_comments;
create policy bc_all on public.behavior_comments for all
  using (exists (
    select 1 from public.behavior_events e
    where e.id = behavior_comments.event_id and public.can_see_student(e.student_id)
  ))
  with check (exists (
    select 1 from public.behavior_events e
    where e.id = behavior_comments.event_id and public.can_see_student(e.student_id)
  ));

grant select, insert, update, delete on public.behavior_comments to authenticated;
