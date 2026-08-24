-- הזמנת ספרים — קטלוג ספרים לפי שיעור + מצב לכל תלמיד לכל ספר.
-- מקור הנתונים: מיילי "רשימת ספרים" שנשלחו להורים ב-10/07/2026 (תשפ"ז).

create table if not exists public.books (
  id        bigserial primary key,
  year      text    not null default 'תשפ"ז',
  class_id  bigint  references public.classes(id) on delete cascade,
  name      text    not null,
  detail    text,
  supplier  text,
  sort      int     not null default 0,
  active    boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists books_year_class on public.books(year, class_id);

-- מחיר החבילה לשיעור (המייל נקב מחיר לחבילה, לא לספר בודד).
create table if not exists public.book_packages (
  id        bigserial primary key,
  year      text    not null default 'תשפ"ז',
  class_id  bigint  not null references public.classes(id) on delete cascade,
  price     numeric not null default 0,
  supplier  text,
  note      text,
  unique(year, class_id)
);

-- מצב ההזמנה: שורה לכל תלמיד לכל ספר.
-- status: order=מזמין דרך המכינה | home=מביא מהבית | lastyear=יש משנה שעברה
--         | na=לא רלוונטי | unknown=טרם נקבע
create table if not exists public.book_orders (
  id         bigserial primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  book_id    bigint not null references public.books(id) on delete cascade,
  status     text   not null default 'unknown',
  paid       boolean not null default false,
  note       text,
  source     text,
  updated_at timestamptz not null default now(),
  unique(student_id, book_id)
);
create index if not exists book_orders_student on public.book_orders(student_id);
create index if not exists book_orders_book on public.book_orders(book_id);

alter table public.books         enable row level security;
alter table public.book_packages enable row level security;
alter table public.book_orders   enable row level security;

drop policy if exists books_read  on public.books;
drop policy if exists books_admin on public.books;
create policy books_read  on public.books for select using (auth.uid() is not null);
create policy books_admin on public.books for all
  using (public.is_admin() or public.my_role() in ('מזכירה','מפקח'))
  with check (public.is_admin() or public.my_role() in ('מזכירה','מפקח'));

drop policy if exists bpk_read  on public.book_packages;
drop policy if exists bpk_admin on public.book_packages;
create policy bpk_read  on public.book_packages for select using (auth.uid() is not null);
create policy bpk_admin on public.book_packages for all
  using (public.is_admin() or public.my_role() in ('מזכירה','מפקח'))
  with check (public.is_admin() or public.my_role() in ('מזכירה','מפקח'));

drop policy if exists bord_read  on public.book_orders;
drop policy if exists bord_admin on public.book_orders;
create policy bord_read  on public.book_orders for select using (auth.uid() is not null);
create policy bord_admin on public.book_orders for all
  using (public.is_admin() or public.my_role() in ('מזכירה','מפקח','מלמד'))
  with check (public.is_admin() or public.my_role() in ('מזכירה','מפקח','מלמד'));
