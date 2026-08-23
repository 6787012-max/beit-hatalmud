-- migration_passport.sql — "דרכון": מעקב שבועי לפי פרשה (2026-08-23, בקשת יוסף)
--
-- מחליף את הקובץ "מעקב דרכון אלול חורף תשפו 22 שבועות.xlsx", שבו לכל פרשה
-- היה גיליון נפרד ולכל שיעור בלוק שורות. כאן זו טבלה אחת: שורה לכל תלמיד
-- לכל שבוע, כך שאפשר לראות גם שבוע בודד וגם מגמה לאורך כל 22 השבועות.
--
-- ארבעת השדות הם בדיוק אלה שמודפסים בחוברת הדרכון עצמה:
--   שחרית בזמן · שעות לימוד בשבת קודש · מבחן גמרא עיון · שקו"ט גמרא בע"פ
--
-- הרשאות: כמו כל מודול תלמיד — can_see_student (צוות לפי כיתות, מנהל=הכל).
-- אידמפוטנטי — בטוח להריץ שוב.

create table if not exists public.passport (
  id            bigserial primary key,
  student_id    bigint not null references public.students(id) on delete cascade,
  week_no       int  not null,             -- 1..22, לפי לוח הפרשות בקוד
  parasha       text not null,             -- שם הפרשה (לקריאוּת ולייצוא)
  heb_date      text,                      -- ט׳ אלול וכו׳
  shacharit     int,                       -- ימי הגעה בזמן לשחרית (0–6)
  study_min     int,                       -- זמן לימוד בשב"ק, בדקות
  test_written  int,                       -- ציון מבחן בכתב (0–100)
  test_oral     int,                       -- ציון מבחן בע"פ (0–100)
  note          text,
  created_by    uuid default auth.uid() references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- שורה אחת לכל תלמיד לכל שבוע. בלי זה הזנה חוזרת יוצרת כפילויות שקטות,
  -- וזה בדיוק מה שקרה במעקב הנוכחות לפני שתוקן.
  constraint passport_uniq unique (student_id, week_no),
  constraint passport_range check (
    (shacharit    is null or shacharit    between 0 and 7)   and
    (study_min    is null or study_min    between 0 and 1440) and
    (test_written is null or test_written between 0 and 100) and
    (test_oral    is null or test_oral    between 0 and 100)
  )
);

create index if not exists passport_student_idx on public.passport(student_id);
create index if not exists passport_week_idx    on public.passport(week_no);

alter table public.passport enable row level security;

drop policy if exists passport_all on public.passport;
create policy passport_all on public.passport for all to authenticated
  using (public.can_see_student(student_id))
  with check (public.can_see_student(student_id));

grant select, insert, update, delete on public.passport to authenticated;
grant usage, select on sequence public.passport_id_seq to authenticated;

-- updated_at מתעדכן לבד — המסך שומר בכל שינוי שדה, וכדאי לדעת מתי
create or replace function public.passport_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists passport_touch_trg on public.passport;
create trigger passport_touch_trg before update on public.passport
  for each row execute function public.passport_touch();
