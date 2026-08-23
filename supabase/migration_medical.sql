-- migration_medical.sql — מידע רפואי: הפרדה בין רגישויות, מצב רפואי ותרופות
-- (2026-08-23, בקשת יוסף)
--
-- עד עכשיו `medications` הייתה טבלה שטוחה: kind/name/details. בפועל יש שלושה
-- סוגי מידע שונים לגמרי שלא צריכים להתערבב:
--   • רגישות/אלרגיה — מה אסור לתת לו
--   • מצב רפואי      — רקע קבוע (אסתמה, אפילפסיה, קשב וריכוז…)
--   • תרופה          — נטילה שוטפת, עם מינון, שעות, אופן נטילה ותופעות לוואי
--
-- הטופס שההורים מילאו באלול תשפ"ו ("עידכון נטילת כדורים") הוא המקור המלא
-- ביותר, והעמודות כאן נגזרות ממנו אחד-לאחד כדי שהייבוא יהיה נאמן.
--
-- ⚠️ נטילת תרופה משתנה — מינון עולה, תרופה מוחלפת, ילד מפסיק. לכן יש
-- `updated_on`: אפשר לראות מה לא עודכן חודש ולשלוח להורים טופס עדכון.
--
-- אידמפוטנטי — בטוח להריץ שוב.

alter table public.medications
  add column if not exists category    text not null default 'תרופה',
  add column if not exists purpose     text,      -- מטרת נטילת הכדור
  add column if not exists dose        text,      -- מינון
  add column if not exists hours       text,      -- מספר שעות השפעה
  add column if not exists take_time   text,      -- זמן נטילה
  add column if not exists take_how    text,      -- עצמאי / בנוכחות הורה / במכינה
  add column if not exists side_during text,      -- תופעות לוואי בזמן ההשפעה
  add column if not exists side_after  text,      -- תופעות לוואי אחרי ההשפעה
  add column if not exists second      boolean not null default false,  -- כדור נוסף בצהריים
  add column if not exists dose2       text,
  add column if not exists hours2      text,
  add column if not exists notes       text,      -- הערות / בקשות ההורים
  add column if not exists active      boolean not null default true,
  add column if not exists updated_on  date,      -- מתי ההורים עדכנו לאחרונה
  add column if not exists source      text,      -- טופס הורים / רישום / ידני
  add column if not exists created_at  timestamptz not null default now();

do $$ begin
  alter table public.medications
    add constraint medications_category_chk
    check (category in ('רגישות', 'מצב רפואי', 'תרופה'));
exception when duplicate_object then null; end $$;

create index if not exists medications_student_idx  on public.medications(student_id);
create index if not exists medications_category_idx on public.medications(category);

-- ההפרדה הישנה נשמרה ב-kind ('allergy'/'medication'); מיישרים לקטגוריות החדשות
update public.medications set category = 'רגישות'
  where kind = 'allergy' and category = 'תרופה';

alter table public.medications enable row level security;

-- מידע רפואי הוא הרגיש ביותר במערכת: אותה הרשאה כמו שאר מודולי התלמיד,
-- ומעליה ה-RLS של can_see_student — צוות רואה רק את הכיתות שלו.
drop policy if exists med_all on public.medications;
create policy med_all on public.medications for all to authenticated
  using (public.can_see_student(student_id))
  with check (public.can_see_student(student_id));

grant select, insert, update, delete on public.medications to authenticated;
