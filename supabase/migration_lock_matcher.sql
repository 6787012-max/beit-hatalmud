-- migration_lock_matcher.sql — סגירת אורקל טלפונים (2026-08-26)
--
-- **הממצא:** `match_student_for_form(p_name, p_answers)` נוצרה אתמול כדי
-- לשייך טופס ציבורי לתלמיד, וקיבלה execute ל-PUBLIC כברירת מחדל. היא
-- **מחזירה מזהה תלמיד**, ולכן כל אדם עם ה-anon key (שהוא ציבורי בקוד) יכול
-- היה לשאול "האם הטלפון הזה שייך לתלמיד במוסד?" ולקבל תשובה — ולסרוק
-- מרחב טלפונים שלם. אומת חי: החזירה 49 עבור טלפון אמיתי.
--
-- **התיקון:** מבטלים execute מכולם ומחזירים רק ל-postgres. `submit_public_form`
-- היא SECURITY DEFINER בבעלות postgres, ולכן היא ממשיכה לקרוא לה כרגיל —
-- ההפרש הוא שאי אפשר לקרוא לה **ישירות** מבחוץ.
--
-- `norm_phone` היא פונקציה טהורה בלי נתונים ולכן אינה מדליפה, אבל אין לאיש
-- צורך בה מבחוץ. `handle_new_user` היא פונקציית טריגר ואינה אמורה להיקרא ידנית.

revoke all on function public.match_student_for_form(text, jsonb) from public, anon, authenticated;
revoke all on function public.norm_phone(text)                     from public, anon, authenticated;
revoke all on function public.handle_new_user()                    from public, anon, authenticated;
