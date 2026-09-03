-- migration_behavior_reminder.sql — תאריך תזכורת על דיווחי מעקב (2026-09-04, בקשת יוסף)
--
-- אותו עיקרון כמו tasks.due_date הקיים: תאריך יעד רגיל, "באיחור" מחושב
-- בצד-לקוח (due_date עבר וההדיווח עדיין followup=true) — בלי תשתית
-- תזכורות/מיילים נפרדת, עקבי עם איך שמשימות כבר עובדות באפליקציה הזו.
--
-- אידמפוטנטי.

alter table public.behavior_events add column if not exists due_date date;
