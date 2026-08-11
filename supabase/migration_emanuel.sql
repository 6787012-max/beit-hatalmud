-- מיגרציה — דרישות עמנואל (הרץ על מאגר Supabase קיים; בטוח להרצה חוזרת)
alter table public.behavior_events add column if not exists event_time text;
alter table public.tuition add column if not exists pay_date date;
alter table public.tuition add column if not exists method text;
alter table public.tuition add column if not exists note text;
create table if not exists public.subjects (id bigint generated always as identity primary key, name text not null);
create table if not exists public.income (id bigint generated always as identity primary key, date date not null default current_date, source text, amount numeric, method text, note text, created_by uuid references public.profiles(id) on delete set null);
create table if not exists public.expenses (id bigint generated always as identity primary key, date date not null default current_date, name text not null, tz text, kind text, method text, payslip text, amount numeric, note text, created_by uuid references public.profiles(id) on delete set null);
alter table public.tuition enable row level security;
alter table public.income enable row level security;
alter table public.expenses enable row level security;
alter table public.subjects enable row level security;
drop policy if exists tui_money on public.tuition;
create policy tui_money on public.tuition for all using (public.is_admin() or public.my_role() in ('מזכירה','מפקח')) with check (public.is_admin() or public.my_role() = 'מזכירה');
drop policy if exists inc_money on public.income;
create policy inc_money on public.income for all using (public.is_admin() or public.my_role() in ('מזכירה','מפקח')) with check (public.is_admin() or public.my_role() = 'מזכירה');
drop policy if exists exp_money on public.expenses;
create policy exp_money on public.expenses for all using (public.is_admin() or public.my_role() in ('מזכירה','מפקח')) with check (public.is_admin() or public.my_role() = 'מזכירה');
drop policy if exists subj_read on public.subjects;
create policy subj_read on public.subjects for select using (auth.uid() is not null);
drop policy if exists subj_admin on public.subjects;
create policy subj_admin on public.subjects for all using (public.is_admin()) with check (public.is_admin());

-- 21-07: created_by נשאר ריק בכל הרישומים — העמודה קיימת בסכימה אך הלקוח
-- מעולם לא מילא אותה, ולכן ההנהלה לא יכלה לדעת מי דיווח. ברירת מחדל בצד-שרת
-- ממלאת את זהות המשתמש המחובר, ללא תלות בלקוח. בטוח להרצה חוזרת.
alter table public.behavior_events alter column created_by set default auth.uid();
alter table public.attendance alter column created_by set default auth.uid();
alter table public.tests alter column created_by set default auth.uid();
alter table public.functioning alter column created_by set default auth.uid();
alter table public.medications alter column created_by set default auth.uid();
alter table public.conversations alter column created_by set default auth.uid();
alter table public.meetings alter column created_by set default auth.uid();
alter table public.reading alter column created_by set default auth.uid();
alter table public.writing alter column created_by set default auth.uid();
alter table public.income alter column created_by set default auth.uid();
alter table public.expenses alter column created_by set default auth.uid();
alter table public.forms alter column created_by set default auth.uid();
