-- migration_petty_cash.sql — קופה קטנה, כמה קופות נפרדות (2026-08-25, בקשת יוסף)
--
-- "קופה כללית" הקיימת (income/expenses) היא הקופה המוסדית של המכינה: שכר,
-- תלושים, העברות. קופה קטנה היא חיה אחרת לגמרי — קניות יומיומיות, מי קנה,
-- האם מגיע לו החזר, ואיפה החשבונית. ערבוב שתיהן באותן טבלאות היה מחייב
-- להוסיף ל-expenses חצי תריסר עמודות שרלוונטיות רק לחצי מהשורות.
--
-- **כמה קופות, לא אחת:** `petty_funds`. נזרעות "בית התלמוד" ו"משמרת חיים",
-- שהיא גוף נפרד לגמרי — הכסף, החשבוניות והיתרה שלה אינם של המכינה, ואסור
-- שיתערבבו בשום סיכום. אפשר להוסיף עוד קופות בלי שינוי קוד.
--
-- לכל קופה **תיקיית חשבוניות משלה בדרייב** (`drive_folder`); ה-Edge Function
-- `drive` מקבלת `fundId`, שואלת את הטבלה הזו **עם ה-JWT של המשתמש** (ולכן
-- ה-RLS מחליט), ומגבילה את ההעלאה/הצפייה/המחיקה לתיקייה שחזרה.
--
-- אידמפוטנטי — בטוח להריץ שוב.

create table if not exists public.petty_funds (
  id           bigserial primary key,
  name         text not null unique,
  color        text,                       -- צבע הלשונית במסך
  drive_folder text,                       -- מזהה תיקיית החשבוניות בדרייב
  opening      numeric not null default 0, -- יתרת פתיחה בקופה
  active       boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.petty_entries (
  id           bigserial primary key,
  fund_id      bigint not null references public.petty_funds(id) on delete cascade,
  kind         text   not null default 'expense',   -- expense | income
  date         date   not null default current_date,
  amount       numeric not null,
  category     text,          -- מזון / ניקיון / ציוד משרדי / אירועים…
  party        text,          -- ספק (בהוצאה) או מקור (בהכנסה)
  buyer        text,          -- מי קנה / מי הכניס
  method       text,          -- מזומן / העברה / אשראי / נדרים פלוס
  status       text   not null default 'שולם',      -- שולם | ממתין להחזר
  note         text,
  receipt_id   text,          -- מזהה קובץ החשבונית בדרייב
  receipt_name text,
  receipt_link text,
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint petty_kind   check (kind in ('expense', 'income')),
  constraint petty_status check (status in ('שולם', 'ממתין להחזר')),
  constraint petty_amount check (amount >= 0)
);
create index if not exists petty_entries_fund_idx on public.petty_entries(fund_id, date);

alter table public.petty_funds   enable row level security;
alter table public.petty_entries enable row level security;

-- כמו שאר טבלאות הכסף במערכת (tuition/income/expenses): מנהל ומזכירה עורכים,
-- מפקח צופה, וכל השאר — לא רואים כלום. מורה אינו אמור לראות קניות והחזרים.
drop policy if exists pf_money on public.petty_funds;
create policy pf_money on public.petty_funds for all
  using  (public.is_admin() or public.my_role() in ('מזכירה', 'מפקח'))
  with check (public.is_admin() or public.my_role() = 'מזכירה');

drop policy if exists pe_money on public.petty_entries;
create policy pe_money on public.petty_entries for all
  using  (public.is_admin() or public.my_role() in ('מזכירה', 'מפקח'))
  with check (public.is_admin() or public.my_role() = 'מזכירה');

grant select, insert, update, delete on public.petty_funds, public.petty_entries to authenticated;
grant usage, select on sequence public.petty_funds_id_seq   to authenticated;
grant usage, select on sequence public.petty_entries_id_seq to authenticated;

create or replace function public.petty_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists petty_touch_trg on public.petty_entries;
create trigger petty_touch_trg before update on public.petty_entries
  for each row execute function public.petty_touch();

-- שתי הקופות ההתחלתיות. התיקיות נוצרו ב-.local/mk_petty_folders.py בדרייב של
-- חשבון המכינה (6787012) — אותו חשבון שהטוקן של ה-Edge Function שייך לו,
-- ולכן ההעלאה אליהן עובדת בהיקף drive.file בלי שיתוף ידני.
insert into public.petty_funds (name, color, drive_folder, sort) values
  ('בית התלמוד', '#003048', '1M7eVhsuIoHE0LqlooQxy5dEl3h4C8ZqG', 1),
  ('משמרת חיים', '#8a5a2b', '1fwK78TSzoGiP0F38vmpDTugCw4vwhfrU', 2)
on conflict (name) do update set drive_folder = excluded.drive_folder;
