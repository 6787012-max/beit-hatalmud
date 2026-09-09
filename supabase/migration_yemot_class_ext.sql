-- migration_yemot_class_ext.sql — מיפוי יציב כיתה→שלוחת קו ימות (2026-09-09)
--
-- עד עכשיו המיפוי כיתה→שלוחת ימות (1/2/3/4) התבסס על התאמת שם-הכיתה המדויק
-- כטקסט חופשי (למשל "שיעור ג1 - הרב יודלוב"), משוכפל באופן עצמאי בשני מקומות
-- (js/yemot-line.js ו-beit-hatalmud-broadcast-worker). שינוי שגרתי — כיתה
-- שמתחלף בה מלמד, או תיקון איות — גורם לתלמידי אותה כיתה "להיעלם בשקט" מכל
-- רשימת שידור עתידית, בלי שגיאה. עמודה זו הופכת את המיפוי ליציב ומפורש.
--
-- הרץ פעם אחת ב-Supabase SQL Editor. בטוח להרצה חוזרת.

alter table public.classes add column if not exists yemot_ext text;

update public.classes set yemot_ext = '1' where name = 'שיעור א';
update public.classes set yemot_ext = '2' where name = 'שיעור ב';
update public.classes set yemot_ext = '3' where name like 'שיעור ג1%';
update public.classes set yemot_ext = '4' where name like 'שיעור ג2%';

-- כיתה חדשה שתתווסף בעתיד עם שלוחת ימות משלה: לעדכן yemot_ext ידנית כאן
-- (או בפאנל הניהול, כשייבנה שם עורך לעמודה הזו) — לא להסתמך על התאמת-שם.
