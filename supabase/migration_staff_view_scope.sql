-- migration_staff_view_scope.sql — הצוות רואה את התלמידים שהוקצו לו (2026-08-30, בקשת יוסף)
--
-- **הממצא:** איש צוות שנכנס למערכת — למשל אריה לייב קליין (מלמד, ומשויך
-- במסך ההגדרות לכל ארבעת השיעורים) — פתח את מסכי המעקב וראה **מסך ריק**.
-- רק המנהל ראה נתונים. שני מנגנונים בלתי-תלויים גרמו לזה:
--
-- 1) **בצד הלקוח (העיקרי):** `roleCaps('מלמד')` החזיר `mode:'writeonly'`,
--    וה-CSS `body.mode-writeonly` מסתיר `#timeline`, `.table-wrap`,
--    `#recList*` וכל רשימה אחרת — כולל את הרישומים שהמלמד עצמו הזין.
--    כלומר גם כשה-RLS החזיר שורות, הן לא צוירו על המסך. תוקן ב-`js/auth.js`.
--
-- 2) **בצד השרת (המשלים):** `has_class_access` שחרר את מלמד ומפקח ממגבלת
--    הכיתה לגמרי, ולכן שיוך שיעורים למלמד במסך ההגדרות **לא עשה כלום** —
--    לא הרחיב ולא צמצם. מנהל שסימן שיעור אחד ציפה להגבלה שלא קרתה.
--
-- **המודל מעכשיו — "שיוך אם הוגדר":**
--   * מנהל / מפקח — כל המוסד, כמו קודם.
--   * מחנך — רק השיעורים שסומנו לו. בלי סימון = אף תלמיד (ללא שינוי).
--   * מלמד — אם סומנו לו שיעורים, הוא מוגבל אליהם; **אם לא סומן לו כלום,
--     הוא רואה את כל המכינה**, בדיוק כמו היום.
--
-- ⚠️ הסעיף האחרון הוא לב העניין ולא נועד לנוחות: לחמישה מתוך שישה מלמדים
-- אין שום שורה ב-`user_class_access`. צמצום גורף של מלמד לשיוך היה מאפס
-- אותם ל-0 שורות — בדיוק הרגרסיה שעליה מזהיר `migration_melamed_scope.sql`.
--
-- **המשקל שכנגד:** פתיחת הצפייה למלמד מלווה בהידוק הכתיבה. מלמד יכול היה
-- עד היום לערוך ולמחוק רישומי מעקב ומבחנים של **כל** איש צוות אחר, ולעדכן
-- את רשומת התלמיד עצמה (ת"ז, טלפוני הורים) — למרות שמסך "תלמידים" כלל לא
-- פתוח לו. מעכשיו הוא מתקן שם רק את מה שהוא עצמו רשם. הנוכחות מוחרגת
-- מההידוק הזה — ראה הנימוק בסעיף 3.
--
-- אידמפוטנטי — בטוח להריץ שוב.

-- ── 1. היקף הכיתות ─────────────────────────────────────────────────────
-- מפקח נשאר בלתי-מוגבל (תפקידו לצפות בכל המוסד).
-- מלמד: השיוך מצמצם אותו אם קיים, ומשחרר אותו אם אינו קיים.
create or replace function public.has_class_access(cid bigint) returns boolean
  language sql stable security definer set search_path = public as
$$ select public.is_admin()
     or public.my_role() = 'מפקח'
     or exists (select 1 from public.user_class_access u where u.user_id = auth.uid() and u.class_id = cid)
     or exists (select 1 from public.classes c where c.id = cid and c.melamed = auth.uid())
     or (public.my_role() = 'מלמד'
         and not exists (select 1 from public.user_class_access u where u.user_id = auth.uid())) $$;

-- ── 2. רשימת התלמידים ──────────────────────────────────────────────────
-- מלמד מצטרף למחנך כמוגבל-כיתה. שאר הצוות הפעיל (מזכירה/מפקח) — כמו קודם.
drop policy if exists stu_read on public.students;
create policy stu_read on public.students for select using (
  case when public.my_role() in ('מחנך', 'מלמד')
       then public.has_class_access(class_id)
       else public.is_staff()
  end
);

-- רשומת התלמיד עצמה (ת"ז, טלפוני הורים, שדות רישום) נערכת ע"י מנהל ומחנך
-- בלבד. מסך "תלמידים" ממילא סגור למלמד ב-roleCaps — ה-API היה פתוח.
drop policy if exists stu_upd on public.students;
create policy stu_upd on public.students for update
  using      (public.is_admin() or (public.my_role() = 'מחנך' and public.has_class_access(class_id)))
  with check (public.is_admin() or (public.my_role() = 'מחנך' and public.has_class_access(class_id)));

-- ── 3. תיקון ומחיקה של רישומי מעקב — רק מה שאתה רשמת (למלמד) ───────────
-- הקריאה (`*_read`) לא נוגעים בה: היא כבר
-- `is_admin() or created_by = auth.uid() or can_read_student(student_id)`.
create or replace function public.can_edit_record(sid bigint, owner uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select public.can_see_student(sid)
     and (public.my_role() is distinct from 'מלמד'
          or owner is null
          or owner = auth.uid()) $$;

drop policy if exists beh_upd on public.behavior_events;
create policy beh_upd on public.behavior_events for update
  using (public.can_edit_record(student_id, created_by))
  with check (public.can_edit_record(student_id, created_by));
drop policy if exists beh_del on public.behavior_events;
create policy beh_del on public.behavior_events for delete
  using (public.can_edit_record(student_id, created_by));

-- ⚠️ **נוכחות מוחרגת בכוונה.** שם יש בדיוק שורה אחת לכל תלמיד ליום
-- (`attendance_student_day` unique), והמסך מעדכן אותה במקום — כלומר מי
-- שמתקן סימון של חבר *חייב* לעדכן שורה של מישהו אחר, ואין לו דרך לעקוף
-- זאת בהוספה. הגבלה לבעלים היתה שוברת את עבודת הנוכחות היומית.

drop policy if exists tst_upd on public.tests;
create policy tst_upd on public.tests for update
  using (public.can_edit_record(student_id, created_by))
  with check (public.can_edit_record(student_id, created_by));
drop policy if exists tst_del on public.tests;
create policy tst_del on public.tests for delete
  using (public.can_edit_record(student_id, created_by));
