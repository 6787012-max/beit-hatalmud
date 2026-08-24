-- migration_tla_drafts.sql — טיוטות דף הכנה שנוצרו אוטומטית (2026-08-24)
--
-- למה טבלה נפרדת ולא כתיבה ישירה ל-tla_plans.profile:
--   1. ל-33 מתוך 37 תלמידים **אין עדיין תכנית תל"א**, ולכן אין לאן לכתוב.
--   2. גם כשיש — טיוטה שנוצרה ע"י מודל לא נכנסת לתיק בלי אישור אדם.
-- הטיוטה יושבת כאן עד שמישהו פותח, בודק, ומאשר.
create table if not exists public.tla_profile_drafts (
  id          bigserial primary key,
  student_id  bigint not null references public.students(id) on delete cascade,
  data        jsonb not null,               -- ארבעת השדות + מנת משכל + התראות
  scanned     jsonb default '[]'::jsonb,    -- שמות הקבצים שנסרקו
  failed      jsonb default '[]'::jsonb,    -- מה נכשל ולמה
  skipped     jsonb default '[]'::jsonb,    -- קבצים שדולגו (לא הרלוונטיים ביותר)
  status      text not null default 'draft' check (status in ('draft','applied','rejected')),
  created_at  timestamptz not null default now(),
  applied_at  timestamptz,
  applied_by  uuid references public.profiles(id),
  -- טיוטה אחת לתלמיד. הרצה חוזרת מחליפה, ולא מייצרת ערימה.
  constraint tla_draft_uniq unique (student_id)
);

alter table public.tla_profile_drafts enable row level security;
drop policy if exists tla_draft_all on public.tla_profile_drafts;
create policy tla_draft_all on public.tla_profile_drafts for all to authenticated
  using (public.can_see_student(student_id))
  with check (public.can_see_student(student_id));
grant select, insert, update, delete on public.tla_profile_drafts to authenticated;
grant usage, select on sequence public.tla_profile_drafts_id_seq to authenticated;
