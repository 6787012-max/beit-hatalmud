-- migration_edu_sources.sql — מקורות טקסט חינוכיים שמנהל מעלה, ומוזנים ל-AI (2026-09-08, בקשת יוסף).
-- בנוסף ל-METHOD_PROMPT הקבוע (שיטת "לא ניתן החינוך למלאכי השרת") — מנהל יכול להדביק
-- קטעי טקסט (מכתבים, שיעורים, ספרים) שה-AI ילמד מהם וישלב בניתוחים.

create table if not exists public.edu_sources (
  id bigint generated always as identity primary key,
  title text not null default '',
  content text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table public.edu_sources enable row level security;

drop policy if exists edu_src_read on public.edu_sources;
create policy edu_src_read on public.edu_sources for select
  using (auth.uid() is not null);

drop policy if exists edu_src_write on public.edu_sources;
create policy edu_src_write on public.edu_sources for all
  using (public.is_admin())
  with check (public.is_admin());
