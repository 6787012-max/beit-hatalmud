-- ═══════════════════════════════════════════════════════════════
-- migration_tla_goals_v2.sql · יישור "תכנית היעדים" לטופס הרשמי (2026-08-21)
--
-- משוב נעמי לוי (יועצת): המבנה שהיה לא תאם את הטבלה הרשמית של המכינה.
-- הטופס האמיתי (תל"א אינטגרטיבי) בנוי כך, מימין לשמאל:
--   יעדים  |  הזדמנויות עבודה ואמצעים להשגתם  |  מעקב והערכה
--          |  (עמודה לכל איש צוות שנבחר)       |  (מעצבת / מסכמת)
-- ומתחת:  המלצות  |  הערות ושינויים משמעותיים במהלך השנה
--
-- מה משתנה:
--   • `goals_list` — מערך יעדים (היו שני שדות קבועים: מטרה מסכמת/מבצעת).
--   • `eval_form` / `eval_sum` — הערכה מעצבת ומסכמת (לא היו בכלל).
--   • `recommendations` — המלצות (לא היה).
--   • `roles` נשאר, אבל המפתחות הם **שמות אנשי צוות שנבחרים**, לא תפקידים קבועים.
-- העמודות הישנות נשארות ותוכנן מהוגר, כדי לא לאבד מה שכבר הוזן.
-- אידמפוטנטי.
-- ═══════════════════════════════════════════════════════════════

alter table public.tla_goals add column if not exists goals_list      jsonb not null default '[]'::jsonb;
alter table public.tla_goals add column if not exists eval_form       text;
alter table public.tla_goals add column if not exists eval_sum        text;
alter table public.tla_goals add column if not exists recommendations text;

-- הגירה חד-פעמית: מה שהוזן ב"מטרה מסכמת"/"מבצעת" הופך לפריטים ברשימת היעדים,
-- ו"הישגים" נכנס להערכה המסכמת. רק אם היעדים עדיין ריקים — כדי שלא לדרוס.
update public.tla_goals
   set goals_list = (
        select coalesce(jsonb_agg(x), '[]'::jsonb)
          from (select unnest(array_remove(array[nullif(btrim(goal_sum),''), nullif(btrim(goal_exec),'')], null)) as x) t)
 where jsonb_array_length(goals_list) = 0
   and (coalesce(btrim(goal_sum),'') <> '' or coalesce(btrim(goal_exec),'') <> '');

update public.tla_goals
   set eval_sum = achievements
 where eval_sum is null and coalesce(btrim(achievements),'') <> '';

-- ── רשימת שמות הצוות לבחירה ──
-- טבלת `staff` נעולה למנהל בלבד (ת"ז ופרטי בנק), אבל מחנך שכותב תל"א צריך
-- לבחור מי שותף ביישום. פונקציה זו מחזירה **שמות ותפקיד בלבד** ולכן בטוחה
-- לכל צוות מחובר; שום שדה רגיש לא עובר בה.
create or replace function public.staff_names()
  returns table (id bigint, name text, role_label text)
  language sql stable security definer set search_path = public as
$$
  select s.id,
         btrim(coalesce(s.first_name,'') || ' ' || coalesce(s.last_name,'')) as name,
         s.role_label
    from public.staff s
   where s.active is distinct from false
     and public.is_staff()
   order by 2
$$;

revoke all on function public.staff_names() from public, anon;
grant execute on function public.staff_names() to authenticated;
