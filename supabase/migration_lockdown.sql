-- migration_lockdown.sql — סגירת דליפת נתוני תלמידים (2026-08-19)
--
-- הבעיה: הרשמה עצמית ב-Supabase Auth פתוחה (וחייבת להישאר — admin.js יוצר
-- משתמשי צוות דרך signUp עם ה-anon key). הטריגר handle_new_user יצר פרופיל
-- בלי לציין active, וברירת המחדל של העמודה היא true. לכן is_staff() החזיר true
-- לכל אדם שנרשם, ומדיניות students.stu_read = is_staff() חשפה את כל התלמידים
-- כולל ת"ז, טלפוני הורים, כתובות ושדות הרישום. אומת חי מול ה-API.
--
-- התיקון: פרופיל חדש נולד לא-פעיל. המנהל מפעיל אותו במסך ההגדרות (admin.js
-- שולח active:true מיד אחרי היצירה). נרשם מהרחוב מקבל פרופיל מושבת ורואה כלום.

alter table public.profiles alter column active set default false;

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  insert into public.profiles (id, email, tz, name, active)
  values (new.id, new.email, split_part(new.email, '@', 1),
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
          false)     -- ← לא פעיל עד שמנהל מאשר
  on conflict (id) do nothing;
  return new;
end $$;

-- הידוק: קטגוריות היו גלויות לכל מאומת (גם למי שאינו צוות)
drop policy if exists cat_read on public.categories;
create policy cat_read on public.categories for select using (public.is_staff());

-- הידוק: כל מאומת יכול היה להזריק רשומות audit מזויפות
drop policy if exists aud_ins on public.audit_log;
create policy aud_ins on public.audit_log for insert with check (public.is_staff());

-- הידוק: אותו דבר לפידבק
drop policy if exists fb_ins on public.feedback;
create policy fb_ins on public.feedback for insert with check (public.is_staff());

-- ── נוכחות: אין היה אילוץ ייחודיות, והקוד מחק-ואז-הוסיף ללא אטומיות.
-- לחיצות רצופות או שמירה חלקית יכלו להשאיר שתי רשומות לאותו תלמיד באותו יום.
-- (נבדק: אין כפילויות קיימות, לכן האינדקס נוצר ללא ניקוי מקדים.)
create unique index if not exists attendance_student_day on public.attendance (student_id, date);
