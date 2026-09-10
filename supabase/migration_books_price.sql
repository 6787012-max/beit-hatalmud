-- מחיר לכל ספר בנפרד (לא רק חבילה לשיעור) — לבקשת הרב וינברג, מייל 06/09/2026:
-- לדעת בכל שורת תלמיד כמה יש לשלם לפי הסטטוס בפועל של כל ספר.

alter table public.books add column if not exists price numeric not null default 0;

update public.books set price = case name
  when 'גמרא בבא קמא' then 36
  when 'גמרא בבא מציעא' then 36
  when 'גמרא תענית' then 65
  when 'משניות נזיקין' then 26
  when 'קיצור שולחן ערוך עם פסקי משנה ברורה' then 36
  when 'קלסרים' then 20
  else price
end
where active is not false;

-- book_packages (מחיר חבילה קבוע לשיעור) נשארה בטבלה כתיעוד היסטורי אך אינה
-- נקראת יותר מ-js/books.js — הסכום לתשלום מחושב מ-books.price לפי מה שכל
-- תלמיד בפועל מזמין.
