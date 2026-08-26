-- migration_melamed_scope.sql — צמצום מלמד לנתונים שהוא באמת צריך (2026-08-26)
--
-- **הממצא (סריקת בריאות 26/08):** ב-`migration_scope_roles.sql` שוחרר מלמד
-- ממגבלת הכיתה, כי בלעדיה הוא קיבל 0 שורות מנוכחות/דרכון/מבחנים ולא יכול
-- היה לעבוד. אבל `can_see_student` משמש **גם** טבלאות שאינן שלו, ולכן הוא
-- קיבל בדרך גם: רפואי (44), טפסי הורים עם תשובות וחתימות (111), תל"א,
-- תיקי מסמכים (65) ואינדקס מיילים (37) — כל זה בזמן שלפי `roleCaps`
-- ב-`js/auth.js` המסכים שלו הם **מעקב · נוכחות · מבחנים · מעקב קריאה ·
-- דרכון** בלבד. המסכים הוסתרו ב-UI, אבל ה-API היה פתוח.
--
-- **התיקון:** גייט תפקיד נפרד לטבלאות הרגישות, בנוסף ל-can_see_student.
-- מלמד נחסם מהן; מנהל/מפקח/מזכירה/מחנך לא מושפעים.
--
-- ⚠️ **אל תפתור את זה ע"י צמצום `has_class_access`** — זה יחזיר את מלמד
-- למצב של 0 שורות בנוכחות ובדרכון, שזה הבאג שתוקן אתמול.
--
-- אידמפוטנטי.

-- האם למשתמש מותר לראות נתוני עומק על תלמיד (רפואי / טפסים / תל"א / מסמכים).
-- מלמד הוא "הזנה בלבד" — הוא רושם, לא מעיין בתיק.
create or replace function public.can_see_deep(sid bigint) returns boolean
  language sql stable security definer set search_path = public as
$$ select public.my_role() is distinct from 'מלמד' and public.can_see_student(sid) $$;

-- ── רפואי ──
drop policy if exists med_read on public.medications;
create policy med_read on public.medications for select using (public.can_see_deep(student_id));
drop policy if exists med_all on public.medications;
create policy med_all on public.medications for all
  using (public.can_see_deep(student_id)) with check (public.can_see_deep(student_id));

-- ── טפסים ותשובות הורים ──
drop policy if exists fr_staff on public.form_responses;
create policy fr_staff on public.form_responses for all
  using (public.is_admin() or public.my_role() in ('מזכירה', 'מפקח') or public.can_see_deep(student_id))
  with check (public.is_admin() or public.my_role() in ('מזכירה', 'מפקח') or public.can_see_deep(student_id));

-- ── תל"א ──  (roleCaps מחריג במפורש מלמד מתל"א)
drop policy if exists tla_plan_all on public.tla_plans;
create policy tla_plan_all on public.tla_plans for all
  using (public.can_see_deep(student_id)) with check (public.can_see_deep(student_id));
drop policy if exists tla_draft_all on public.tla_profile_drafts;
create policy tla_draft_all on public.tla_profile_drafts for all
  using (public.can_see_deep(student_id)) with check (public.can_see_deep(student_id));

-- ── תיק המסמכים ואינדקס המיילים ──
drop policy if exists sdoc_read on public.student_docs;
create policy sdoc_read on public.student_docs for select using (public.can_see_deep(student_id));
drop policy if exists sl_read on public.student_links;
create policy sl_read on public.student_links for select using (public.can_see_deep(student_id));
