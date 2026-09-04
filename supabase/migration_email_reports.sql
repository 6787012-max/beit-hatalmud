-- migration_email_reports.sql — סורק מיילים אוטומטי → דיווחי AI בכרטיס תלמיד (2026-09-04)
-- הרץ ב-Supabase SQL Editor אחרי schema.sql + policies.sql. בטוח להרצה חוזרת.
--
-- למה: Apps Script bridge יסרוק כל שעתיים מיילים חדשים ב-INBOX של המכינה,
-- יזהה מיילים שקשורים לתלמיד קונקרטי (מוצאי הורה של תלמיד), ינתח את התוכן
-- ב-Gemini, וישמור סיכום פה. הכרטיס יציג את זה בסקשן חדש "דיווחי AI ממיילים".
--
-- ⚠️ פרטיות: הגשר שולח ל-Gemini רק מיילים שבהם זוהה שם תלמיד. מיילים אחרים
-- לא נגעים בהם כלל. גם אחרי הזיהוי — הסיכום הוא רק 2-3 שורות, לא הגוף המלא.

create table if not exists public.email_reports (
  id             bigint generated always as identity primary key,
  student_id     bigint not null references public.students(id) on delete cascade,
  gmail_msg_id   text unique,                       -- מונע כפילויות בין הרצות
  email_subject  text,
  email_from     text,
  email_date     timestamptz,
  summary        text,                              -- 2-3 שורות שגמיני החזיר
  sentiment      text,                              -- חיובי / ניטרלי / שלילי
  category       text,                              -- הודעה מהורה / עדכון מצוות / אירוע חריג / שגרה
  gmail_link     text,                              -- קישור פתיחה בג'ימייל
  ai_model       text default 'gemini-1.5-flash',
  created_at     timestamptz not null default now()
);

create index if not exists idx_email_reports_student on public.email_reports(student_id, created_at desc);
create index if not exists idx_email_reports_created on public.email_reports(created_at desc);

alter table public.email_reports enable row level security;

-- אותה מדיניות כמו כל דבר שקשור לתלמיד: מנהל/מזכירה/מפקח רואים הכל,
-- מלמד רואה את הכיתות שלו. can_see_student כבר עושה את כל זה.
drop policy if exists er_read on public.email_reports;
create policy er_read on public.email_reports for select
  using (public.can_see_student(student_id));

-- כתיבה: רק service_role (Apps Script bridge). אף לקוח לא כותב לטבלה זו.
-- (אין policy insert/update/delete — RLS חוסם ברירת מחדל.)
-- אבל מנהל צריך לקבל מחיקה, אם מתחשק לו לנקות דיווח שגוי:
drop policy if exists er_delete_admin on public.email_reports;
create policy er_delete_admin on public.email_reports for delete
  using (public.is_admin());
