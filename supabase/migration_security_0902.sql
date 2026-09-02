-- ═══════════════════════════════════════════════════════════════════════
-- חיזוק אבטחה 02/09/2026 — מתיעוד ביקורת רב-סוכנית.
-- כל הפקודות כאן כבר הורצו חי על המסד; הקובץ הוא רשומת version-control.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. [קריטי] email_by_name היה SECURITY DEFINER פתוח ל-anon → אורקל שם→טלפון
--    (=סיסמת ברירת מחדל) → השתלטות חשבון. הלקוח כבר לא משתמש בו. מוחקים.
drop function if exists public.email_by_name(text);

-- 2. [גבוה] מלמד ראה אבחוני תל"א וסיכומי שיחות הורים: tla_goals/meetings/schedule
--    השתמשו ב-can_see_tla שלא החריג מלמד (רק טבלת האב tla_plans הודקה).
create or replace function public.can_see_tla(pid bigint)
  returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() is distinct from 'מלמד'
   and exists (select 1 from public.tla_plans p
               where p.id = pid and public.can_see_student(p.student_id)) $$;

-- 3. [בינוני] tasks/projects/calendar_events היו קריאים/כתיבים לכל מאומת
--    (auth.uid() is not null) — כולל חשבון שנרשם-לבד ולא-מאושר. מהדקים ל-is_staff().
alter policy cal_read  on public.calendar_events using (public.is_staff());
alter policy cal_ins   on public.calendar_events with check (public.is_staff());
alter policy proj_read on public.projects        using (public.is_staff());
alter policy proj_ins  on public.projects         with check (public.is_staff());
alter policy task_read on public.tasks            using (public.is_staff());
alter policy task_ins  on public.tasks            with check (public.is_staff());

-- 4. [בינוני] submit_public_form (anon) בלי תקרת גודל → הצפת מסד/ניפוח אחסון.
--    נוספו מגני גודל: שם ≤100, חתימה ≤300KB, תשובות ≤64KB.
--    (ההגדרה המלאה עם המגנים הורצה חי; ראה pg_get_functiondef.)

-- הערה: XSS (forms/lobby signatureImg + videoCount) ו-PII של הלובי תוקנו בצד הלקוח
-- (commit js/forms.js, js/lobby.js), ו-37 שורות ימי-ההולדת נוקו חי מ-lobby_config.
