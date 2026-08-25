-- migration_scope_roles.sql — היקף הגישה לפי תפקיד (2026-08-25, בקשת יוסף)
--
-- שתי תקלות הפוכות התגלו יחד כשנבדק חי מה כל תפקיד באמת רואה:
--
-- 1) **מחנך ראה את כל התלמידים במוסד.** `students.stu_read` היה `is_staff()`,
--    כלומר כל איש צוות פעיל קרא את כל 37 התלמידים — שם, ת"ז, טלפוני הורים
--    וכל שדות `reg`. שאר טבלאות התלמיד (נוכחות/מבחנים/רפואי/תל"א/דרכון) כבר
--    היו מוגבלות ב-`can_see_student`, כך שהתמונה היתה גם לא עקבית: רשימת
--    התלמידים מלאה, אבל הכרטיס של תלמיד מכיתה אחרת ריק.
--    מעכשיו: **מחנך מוגבל לכיתות שהוקצו לו**, ורק הוא.
--
-- 2) **מלמד ומפקח לא ראו כלום.** `has_class_access` דרש שורה ב-
--    `user_class_access`, ולשישה מלמדים אין שורה כזו (וגם לא אמורה להיות —
--    לפי מודל התפקידים ב-`js/auth.js` מלמד מזין **לכל** התלמידים, ומפקח
--    צופה בהכל). בפועל הם קיבלו 0 שורות מ-passport / attendance / tests /
--    classes, ומסך "דרכון" של מלמד היה ריק ושמירה בו נדחתה בשקט ע"י RLS.
--    מעכשיו: מלמד ומפקח אינם מוגבלי-כיתה.
--
-- אידמפוטנטי — בטוח להריץ שוב.

-- מי שאינו מוגבל-כיתה: מנהל, מלמד (מזין לכולם), מפקח (צופה בכל).
-- מחנך *כן* מוגבל — ולכן הוא לא ברשימה.
create or replace function public.has_class_access(cid bigint) returns boolean
  language sql stable security definer set search_path = public as
$$ select public.is_admin()
     or public.my_role() in ('מלמד', 'מפקח')
     or exists (select 1 from public.user_class_access u where u.user_id = auth.uid() and u.class_id = cid)
     or exists (select 1 from public.classes c where c.id = cid and c.melamed = auth.uid()) $$;

-- רשימת התלמידים: מחנך לפי כיתותיו, שאר הצוות הפעיל — כמו קודם.
-- (מזכירה נשארת עם גישה מלאה לרשימה לצורכי מנהלה; טבלאות התלמיד עצמן
--  ממשיכות להיאכף ב-can_see_student ולכן היא לא מרוויחה מזה נתוני מעקב.)
drop policy if exists stu_read on public.students;
create policy stu_read on public.students for select using (
  case when public.my_role() = 'מחנך'
       then public.has_class_access(class_id)
       else public.is_staff()
  end
);
