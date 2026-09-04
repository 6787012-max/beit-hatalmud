-- migration_behavior_comments_rls_fix.sql — תיקון הרשאות עריכה/מחיקה של תגובות מעקב (2026-09-04)
--
-- migration_behavior_followup.sql הגדיר bc_all יחיד שמבוסס על can_see_student
-- בלבד לכל הפעולות (select/insert/update/delete) — בדיוק המדיניות הישנה
-- שכבר הוחלפה עבור behavior_events עצמה ב-migration_staff_view_scope.sql
-- (מלמד מתקן/מוחק רק מה שהוא עצמו רשם, דרך can_edit_record). ההערה המקורית
-- שם טענה "הרשאות זהות לחלוטין ל-behavior_events" — נכון לקריאה, לא נכון
-- לעדכון/מחיקה. מיגרציה זו מתקנת:
--   * קריאה + הוספה — נשארות scoped-ראייה (can_see_student): כל מי שרואה
--     את התלמיד יכול לקרוא/להוסיף תגובה. זו בדיוק המטרה השיתופית של
--     הפיצ'ר (כמה אנשי צוות מתעדים המשך טיפול על אותו תלמיד).
--   * עדכון + מחיקה — עוברות ל-can_edit_record, הפעם על היוצר של *התגובה*
--     עצמה (behavior_comments.created_by), לא של הדיווח — תואם למה שהלקוח
--     כבר מניח (commentRowHtml מציג את כפתור המחיקה רק כש-canEditRow(c)
--     מחזיר אמת; עד עכשיו זו הייתה הגנת-UI בלבד בלי אכיפה מקבילה בשרת).
--
-- אידמפוטנטי.

drop policy if exists bc_all on public.behavior_comments;

drop policy if exists bc_read on public.behavior_comments;
create policy bc_read on public.behavior_comments for select using (
  exists (
    select 1 from public.behavior_events e
    where e.id = behavior_comments.event_id and public.can_see_student(e.student_id)
  )
);

drop policy if exists bc_ins on public.behavior_comments;
create policy bc_ins on public.behavior_comments for insert with check (
  exists (
    select 1 from public.behavior_events e
    where e.id = behavior_comments.event_id and public.can_see_student(e.student_id)
  )
);

drop policy if exists bc_upd on public.behavior_comments;
create policy bc_upd on public.behavior_comments for update
  using (
    exists (
      select 1 from public.behavior_events e
      where e.id = behavior_comments.event_id
        and public.can_edit_record(e.student_id, behavior_comments.created_by)
    )
  )
  with check (
    exists (
      select 1 from public.behavior_events e
      where e.id = behavior_comments.event_id
        and public.can_edit_record(e.student_id, behavior_comments.created_by)
    )
  );

drop policy if exists bc_del on public.behavior_comments;
create policy bc_del on public.behavior_comments for delete using (
  exists (
    select 1 from public.behavior_events e
    where e.id = behavior_comments.event_id
      and public.can_edit_record(e.student_id, behavior_comments.created_by)
  )
);
