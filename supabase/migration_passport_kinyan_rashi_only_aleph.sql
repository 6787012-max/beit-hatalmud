-- migration_passport_kinyan_rashi_only_aleph.sql — הבהרת הרב וינברג (מייל המשך, 06/09/2026 12:04):
-- "תכניס רק מי שיש לו א או א+, מה שכתוב סתם אל תתייחס כל מיני הערות"
--
-- מגביל את kinyan_rashi (שנוסף ב-migration_passport_kinyan_rashi.sql כטקסט
-- חופשי, בטרם התקבלה ההבהרה) לשני ערכים בדיוק. הנתונים ההיסטוריים שכללו
-- דרגות אחרות (ב, ג) והערות חופשיות כבר נוקו בנפרד ישירות ב-DB.
--
-- normalize מסיר רווחים לפני ההשוואה כדי ש"א +" (רווח, כפי שנכתב בגיליון
-- המקור) יעבור כמו "א+" — נשמר ב-DB כפי שהוזן, לא משוכתב.
--
-- אידמפוטנטי.

alter table public.passport drop constraint if exists passport_kinyan_rashi_chk;
alter table public.passport add constraint passport_kinyan_rashi_chk
  check (kinyan_rashi is null or regexp_replace(kinyan_rashi, '\s+', '', 'g') in ('א', 'א+'));
