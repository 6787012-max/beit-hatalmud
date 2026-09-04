-- migration_messaging_staff_directory.sql — רשימת צוות עם מייל, לפאנל הדיוור (2026-09-04)
--
-- js/messaging.js הוסיף אפשרות לשלוח דיוור ל"צוות" — צריך שם+מייל לכל איש
-- צוות פעיל. profiles.email קיים, אבל prof_self_read (policies.sql) מתיר
-- SELECT על הטבלה רק לבעל הרשומה עצמו או למנהל — בדיוק הבעיה שכבר נפתרה
-- פעם אחת עבור "מי דיווח" (staff_directory() ב-migration_weekly_reports.sql,
-- אבל זו מחזירה בכוונה בלי email: "שם+תפקיד בלבד" לתצוגה).
--
-- הפאנל הזה פתוח למנהל **ומזכירה** (בדיקת role ב-js/messaging.js) — צריך
-- RPC נפרד שגם כולל email וגם גדור לשני התפקידים האלה בדיוק (לא is_staff()
-- הרחב יותר — מייל רגיש יותר משם+תפקיד).
--
-- אידמפוטנטי.

create or replace function public.staff_directory_with_email()
  returns table (id uuid, name text, email text, role text)
  language sql stable security definer set search_path = public as
$$ select p.id, p.name, p.email, p.role
     from public.profiles p
    where p.active and (public.is_admin() or public.my_role() = 'מזכירה') $$;

revoke all on function public.staff_directory_with_email() from public, anon;
grant execute on function public.staff_directory_with_email() to authenticated;
