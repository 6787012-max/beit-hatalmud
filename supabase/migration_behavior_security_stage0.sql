-- migration_behavior_security_stage0.sql — "שלב 0" באבטחת מעקב ההתנהגות (2026-10-19)
--
-- מקור: ביקורת האבטחה מ-18/10/2026, פרק 3 במסמך
-- C:/projects/beit-hatalmud-research/מעקב-התנהגות-גרסה-2.html
--
--   1. "מי רשם" נקבע בשרת. עד היום `stampAuthor` ב-js/store.js קבע את created_by בדפדפן,
--      והפוליסי beh_ins בדק רק is_staff(). כל איש צוות יכול היה לשמור דיווח "בשמו" של
--      רב אחר, ואז גם לא היה מסוגל לערוך אותו (can_edit_record בודק את created_by).
--      עכשיו: BEFORE INSERT כותב auth.uid(), ו-BEFORE UPDATE משאיר את הערך הישן.
--      בלי משתמש מחובר (service_role, סקריפט, SQL ידני) הערך שנשלח נשמר כמו שהוא.
--   2. רישום רק על תלמיד שמותר לראות (can_see_student), ו"צפייה בלבד" נאכפת בשרת:
--      access_mode='readonly', או בלי override ותפקיד מפקח — בדיוק כמו A.mode ב-js/auth.js.
--      נבדק לפני הכתיבה: אף רישום קיים לא היה נחסם (המפקח לא רשם אף דיווח או הערה,
--      ואף מלמד/מחנך לא רשם על תלמיד מחוץ לשיעורים שלו).
--   3. יומן הפעילות (activity_feed) בלי תוכן ההערה. feed_log העתיק 160 תווים ראשונים עם
--      שם התלמיד, והעותק נשאר גם אחרי עריכה וגם אחרי מחיקה. עכשיו: רק הקטגוריה, טריגר
--      AFTER DELETE שמנקה את שורות היומן של דיווח שנמחק, וניקוי של מה שכבר הצטבר.
--   4. גולש אנונימי: ביטול כל הרשאות הטבלה על הטבלאות הרגישות. RLS כבר חוסם אותו
--      (נבדק: 0 שורות), זו שכבה שנייה.
--   5. איש צוות פעיל שעדיין בסיסמת ברירת המחדל: ההתראה הופכת מיד לחוסמת (pw_status).
--
-- ⚠️ לקרוא את הקובץ עם io.open(..., encoding='utf-8') — יש כאן עברית בתוך פונקציות
--    ופוליסיות (ר' המלכודת ב-CLAUDE.md, "היקף הגישה של הצוות").
-- אידמפוטנטי: אפשר להריץ שוב בלי נזק.

begin;

-- ───────────────────────── 0. עזר: האם מותר לי לכתוב ─────────────────────────
-- משקף את A.mode ב-js/auth.js: override פרטני גובר; אחרת לפי התפקיד (רק מפקח = צפייה).
-- writeonly מותר לכתוב (זו המשמעות שלו). משתמש לא פעיל / לא מחובר = false.
create or replace function public.my_write_ok() returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((
     select case
              when p.access_mode in ('full', 'readonly', 'writeonly') then p.access_mode
              when p.role = 'מפקח' then 'readonly'
              else 'full'
            end <> 'readonly'
       from public.profiles p
      where p.id = auth.uid() and p.active), false) $$;
revoke all on function public.my_write_ok() from public, anon;
grant execute on function public.my_write_ok() to authenticated;

-- ───────────────────────── 1. created_by נקבע בשרת ─────────────────────────
create or replace function public.behavior_stamp_author() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if auth.uid() is null then
    return new;                          -- service_role / סקריפט: סומכים על הערך שנשלח
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();        -- מה שהדפדפן שלח לא משנה
  else
    new.created_by := old.created_by;    -- הרושם לא מתחלף בעריכה
  end if;
  return new;
end $$;

drop trigger if exists behavior_author_trg on public.behavior_events;
create trigger behavior_author_trg before insert or update on public.behavior_events
  for each row execute function public.behavior_stamp_author();

drop trigger if exists behavior_author_trg on public.behavior_comments;
create trigger behavior_author_trg before insert or update on public.behavior_comments
  for each row execute function public.behavior_stamp_author();

-- ───────────────────────── 2. פוליסיות כתיבה ─────────────────────────
-- beh_read ו-bc_read לא משתנים.
drop policy if exists beh_ins on public.behavior_events;
create policy beh_ins on public.behavior_events for insert to authenticated
  with check (public.is_staff() and public.my_write_ok() and public.can_see_student(student_id));

drop policy if exists beh_upd on public.behavior_events;
create policy beh_upd on public.behavior_events for update to authenticated
  using      (public.my_write_ok() and public.can_edit_record(student_id, created_by))
  with check (public.my_write_ok() and public.can_edit_record(student_id, created_by));

drop policy if exists beh_del on public.behavior_events;
create policy beh_del on public.behavior_events for delete to authenticated
  using (public.my_write_ok() and public.can_edit_record(student_id, created_by));

drop policy if exists bc_ins on public.behavior_comments;
create policy bc_ins on public.behavior_comments for insert to authenticated
  with check (public.is_staff() and public.my_write_ok() and exists (
    select 1 from public.behavior_events e
     where e.id = behavior_comments.event_id and public.can_see_student(e.student_id)));

drop policy if exists bc_upd on public.behavior_comments;
create policy bc_upd on public.behavior_comments for update to authenticated
  using (public.my_write_ok() and exists (
    select 1 from public.behavior_events e
     where e.id = behavior_comments.event_id
       and public.can_edit_record(e.student_id, behavior_comments.created_by)))
  with check (public.my_write_ok() and exists (
    select 1 from public.behavior_events e
     where e.id = behavior_comments.event_id
       and public.can_edit_record(e.student_id, behavior_comments.created_by)));

drop policy if exists bc_del on public.behavior_comments;
create policy bc_del on public.behavior_comments for delete to authenticated
  using (public.my_write_ok() and exists (
    select 1 from public.behavior_events e
     where e.id = behavior_comments.event_id
       and public.can_edit_record(e.student_id, behavior_comments.created_by)));

-- ───────────────────────── 3. יומן הפעילות ─────────────────────────
-- 3א. feed_log — הגרסה החיה (pg_get_functiondef, 19/10/2026), ורק ענף behavior_events שונה:
--     בלי ההערה, רק שם הקטגוריה. שאר הענפים זהים לחלוטין.
CREATE OR REPLACE FUNCTION public.feed_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r         record;
  v_sid     bigint;
  v_sname   text;
  v_actor   uuid := auth.uid();
  v_aname   text;
  v_arole   text;
  v_kind    text;
  v_title   text;
  v_detail  text;
  v_op      text := lower(tg_op);
begin
  r := new;

  -- מזהה התלמיד (לא בכל הטבלאות יש)
  begin
    v_sid := (to_jsonb(r) ->> 'student_id')::bigint;
  exception when others then v_sid := null; end;

  if v_sid is not null then
    -- שדה name כבר כולל את שם המשפחה במערכות האלה; לא לשרשר שוב.
    select coalesce(nullif(s.name,''), nullif(trim(coalesce(s.family,'')),''))
      into v_sname from public.students s where s.id = v_sid;
  end if;

  -- מי הזין. אם אין משתמש מחובר (גשר/סקריפט) — נרשם כ"מערכת".
  if v_actor is not null then
    select p.name, p.role into v_aname, v_arole from public.profiles p where p.id = v_actor;
  end if;
  v_aname := coalesce(nullif(v_aname,''), 'מערכת');

  -- ניסוח השורה לפי סוג הרישום
  case tg_table_name
    when 'behavior_events' then
      v_kind := 'behavior';
      select c.name into v_detail from public.categories c
        where c.id = (to_jsonb(r) ->> 'category_id')::bigint;
      v_title := 'רישום מעקב התנהגות';
      -- בלי תוכן ההערה (שלב 0, 19/10/2026): שורת היומן נשארה אחרי עריכה ומחיקה
      -- עם 160 התווים הראשונים ושם התלמיד. היום נשמרת הקטגוריה בלבד.
    when 'attendance' then
      v_kind := 'attendance';
      v_title := 'סימון נוכחות';
      v_detail := coalesce(to_jsonb(r) ->> 'status','') ||
                  coalesce(' · ' || (to_jsonb(r) ->> 'date'), '');
    when 'tests' then
      v_kind := 'test';
      v_title := 'ציון מבחן';
      v_detail := coalesce(to_jsonb(r) ->> 'subject','') ||
                  coalesce(' — ' || (to_jsonb(r) ->> 'grade'), '');
    when 'reading' then
      v_kind := 'reading';
      v_title := 'מעקב קריאה';
      v_detail := coalesce(to_jsonb(r) ->> 'level','');
    when 'writing' then
      v_kind := 'writing';
      v_title := 'מעקב כתיבה';
      v_detail := coalesce(to_jsonb(r) ->> 'level','');
    when 'reading_assessments' then
      v_kind := 'readassess';
      v_title := 'הערכת קריאה';
      v_detail := coalesce(to_jsonb(r) ->> 'note','');
    when 'functioning' then
      v_kind := 'functioning';
      v_title := 'דיווח תפקוד';
      v_detail := coalesce(to_jsonb(r) ->> 'area','') ||
                  coalesce(' — ' || (to_jsonb(r) ->> 'score'), '');
    when 'voice_reports' then
      v_kind := 'voice';
      v_title := 'דיווח קולי מהקו';
      v_detail := left(coalesce(to_jsonb(r) ->> 'report_text', to_jsonb(r) ->> 'transcript',''), 160);
    when 'weekly_reports' then
      v_kind := 'weekly';
      v_title := 'דוח שבועי';
      v_detail := coalesce('שבוע ' || (to_jsonb(r) ->> 'week_start'), '');
    when 'tla_goals' then
      v_kind := 'tla';
      v_title := 'עדכון תל"א';
      v_detail := '';
    when 'meetings' then
      v_kind := 'meeting';
      v_title := 'תיעוד פגישה';
      v_detail := left(coalesce(to_jsonb(r) ->> 'summary', to_jsonb(r) ->> 'note',''), 160);
    when 'conversations' then
      v_kind := 'conversation';
      v_title := 'תיעוד שיחה';
      v_detail := left(coalesce(to_jsonb(r) ->> 'note', to_jsonb(r) ->> 'summary',''), 160);
    when 'medications' then
      v_kind := 'medical';
      v_title := 'עדכון רפואי';
      v_detail := left(coalesce(to_jsonb(r) ->> 'name',''), 160);
    when 'students' then
      v_kind := 'student';
      v_sid := r.id;
      v_sname := coalesce(nullif(r.name,''), nullif(trim(coalesce(r.family,'')),''));
      v_title := case when v_op = 'insert' then 'נוסף תלמיד חדש' else 'עודכן כרטיס תלמיד' end;
      v_detail := '';
    when 'tasks' then
      v_kind := 'task';
      v_title := 'משימה';
      v_detail := left(coalesce(to_jsonb(r) ->> 'title',''), 160);
    else
      v_kind := tg_table_name;
      v_title := 'רישום חדש';
      v_detail := '';
  end case;

  insert into public.activity_feed
    (kind, entity, entity_id, op, actor, actor_name, actor_role, student_id, student_name, title, detail)
  values
    (v_kind, tg_table_name, (to_jsonb(r) ->> 'id')::bigint, v_op, v_actor, v_aname, v_arole,
     v_sid, v_sname, v_title, nullif(v_detail,''));

  return null;   -- AFTER trigger
exception when others then
  return null;   -- לעולם לא להפיל רישום אמיתי בגלל היומן
end $function$;

-- 3ב. מחיקת דיווח מוחקת גם את שורות היומן שלו (כולל אלה שנרשמו בעריכות).
create or replace function public.feed_purge_deleted() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  delete from public.activity_feed where entity = tg_table_name and entity_id = old.id;
  return null;
end $$;

drop trigger if exists feed_purge_trg on public.behavior_events;
create trigger feed_purge_trg after delete on public.behavior_events
  for each row execute function public.feed_purge_deleted();

create index if not exists activity_feed_entity_idx on public.activity_feed (entity, entity_id);

-- 3ג. ניקוי: שורות יומן של דיווחים שכבר נמחקו (3 ב-19/10/2026).
delete from public.activity_feed f
 where f.entity = 'behavior_events'
   and not exists (select 1 from public.behavior_events e where e.id = f.entity_id);

-- 3ד. ניקוי: ההערה מתוך שורות היומן של דיווחים קיימים, כולל נוסחים ישנים מלפני עריכה
--     (56 ב-19/10/2026). הפורמט הישן היה "<קטגוריה> — <הערה>"; נשארת הקטגוריה בלבד.
update public.activity_feed
   set detail = nullif(split_part(detail, ' — ', 1), '')
 where entity = 'behavior_events' and detail like '% — %';

-- ───────────────────────── 4. גולש אנונימי ─────────────────────────
-- אף דף ציבורי לא קורא את הטבלאות האלה (print.html / sign.html / הלובי עובדים דרך
-- פונקציות או טבלאות אחרות; Edge Functions עם service_role). authenticated לא משתנה.
revoke all on table
  public.behavior_events, public.behavior_comments,
  public.behavior_events_enc, public.behavior_comments_enc,
  public.students, public.profiles, public.categories,
  public.voice_reports, public.user_class_access
from anon;

-- ───────────────────────── 5. סיסמת ברירת מחדל ─────────────────────────
-- pw_status() חוסם את המסך כשעברו 7 ימים מ-pw_prompt_since. מי שעדיין לא החליף
-- (19/10/2026: מלמד אחד, נכנס פעם אחת ב-23/08 והסיסמה שלו עדיין הטלפון) — חסום מיד.
-- רק משתמשים שקיימים היום; משתמש חדש מקבל את השבוע הרגיל.
update public.profiles
   set pw_prompt_since = now() - interval '7 days 1 minute'
 where active
   and pw_changed_at is null
   and created_at < timestamptz '2026-10-19'
   and (pw_prompt_since is null or pw_prompt_since > now() - interval '7 days');

commit;
