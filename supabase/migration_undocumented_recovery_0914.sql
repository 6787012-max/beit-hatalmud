-- תיעוד-בדיעבד (14/09/2026): 7 טבלאות + פונקציה אחת (is_staff, וכמה נוספות) שקיימות
-- בפועל במסד הנתונים החי הזה, אך מעולם לא נכתבו לשום קובץ מיגרציה בריפו — התגלה תוך
-- כדי ניסיון לשחזר את הסכימה הזו במלואה לפרויקט נפרד (ראה project-student-tracking-saas
-- בזיכרון של קלוד). לפני הקובץ הזה, שחזור המערכת מאפס מהריפו-בלבד היה נכשל חלקית.
--
-- הקובץ הזה תיעוד גרידא — הועתק ישירות מהמסד החי (pg_get_functiondef +
-- information_schema), לא הורץ נגד המסד הזה (הוא כבר תואם). "create ... if not exists"/
-- "create or replace" בכל מקום כרגיל, כך שגם אם ירוץ בעתיד על סביבה שכבר יש בה את
-- אלה — הוא לא-הרסני.
--
-- ⚠️ תגלית אגבית (לא תוקנה כאן בכוונה — זה קובץ תיעוד, לא תיקון-באגים): הטריגר
-- calls_to_feed() למטה מכניס ל-activity_feed לעמודה "actor_id", אבל שם העמודה
-- בפועל הוא "actor" (בלי _id) — כלומר הרישום ליומן הפעילות נכשל בשקט בכל שיחה,
-- מאז ומתמיד (ה-EXCEPTION WHEN OTHERS מסביב בולע את השגיאה). שיחות עצמן נשמרות
-- תקין; רק הרישום ל"יומן הפעילות" חסר. שווה תיקון נפרד אם רוצים.

-- ===== פונקציות =====

CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists(select 1 from public.profiles where id = auth.uid() and active) $function$;

CREATE OR REPLACE FUNCTION public.can_see_feed()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce(public.my_role() = any (array['מנהל','מפקח']), false) $function$;

CREATE OR REPLACE FUNCTION public.can_read_student(sid bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.is_admin() or exists (
     select 1 from public.students s where s.id = sid and public.has_class_access(s.class_id)) $function$;

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
  begin
    v_sid := (to_jsonb(r) ->> 'student_id')::bigint;
  exception when others then v_sid := null; end;
  if v_sid is not null then
    select coalesce(nullif(s.name,''), nullif(trim(coalesce(s.family,'')),''))
      into v_sname from public.students s where s.id = v_sid;
  end if;
  if v_actor is not null then
    select p.name, p.role into v_aname, v_arole from public.profiles p where p.id = v_actor;
  end if;
  v_aname := coalesce(nullif(v_aname,''), 'מערכת');
  case tg_table_name
    when 'behavior_events' then
      v_kind := 'behavior';
      select c.name into v_detail from public.categories c
        where c.id = (to_jsonb(r) ->> 'category_id')::bigint;
      v_title := 'רישום מעקב התנהגות';
      v_detail := coalesce(v_detail,'') ||
        case when coalesce(to_jsonb(r) ->> 'note','') <> ''
             then ' — ' || left(to_jsonb(r) ->> 'note', 160) else '' end;
    when 'attendance' then
      v_kind := 'attendance'; v_title := 'סימון נוכחות';
      v_detail := coalesce(to_jsonb(r) ->> 'status','') || coalesce(' · ' || (to_jsonb(r) ->> 'date'), '');
    when 'tests' then
      v_kind := 'test'; v_title := 'ציון מבחן';
      v_detail := coalesce(to_jsonb(r) ->> 'subject','') || coalesce(' — ' || (to_jsonb(r) ->> 'grade'), '');
    when 'reading' then v_kind := 'reading'; v_title := 'מעקב קריאה'; v_detail := coalesce(to_jsonb(r) ->> 'level','');
    when 'writing' then v_kind := 'writing'; v_title := 'מעקב כתיבה'; v_detail := coalesce(to_jsonb(r) ->> 'level','');
    when 'reading_assessments' then v_kind := 'readassess'; v_title := 'הערכת קריאה'; v_detail := coalesce(to_jsonb(r) ->> 'note','');
    when 'functioning' then
      v_kind := 'functioning'; v_title := 'דיווח תפקוד';
      v_detail := coalesce(to_jsonb(r) ->> 'area','') || coalesce(' — ' || (to_jsonb(r) ->> 'score'), '');
    when 'voice_reports' then
      v_kind := 'voice'; v_title := 'דיווח קולי מהקו';
      v_detail := left(coalesce(to_jsonb(r) ->> 'report_text', to_jsonb(r) ->> 'transcript',''), 160);
    when 'weekly_reports' then v_kind := 'weekly'; v_title := 'דוח שבועי'; v_detail := coalesce('שבוע ' || (to_jsonb(r) ->> 'week_start'), '');
    when 'tla_goals' then v_kind := 'tla'; v_title := 'עדכון תל"א'; v_detail := '';
    when 'meetings' then
      v_kind := 'meeting'; v_title := 'תיעוד פגישה';
      v_detail := left(coalesce(to_jsonb(r) ->> 'summary', to_jsonb(r) ->> 'note',''), 160);
    when 'conversations' then
      v_kind := 'conversation'; v_title := 'תיעוד שיחה';
      v_detail := left(coalesce(to_jsonb(r) ->> 'note', to_jsonb(r) ->> 'summary',''), 160);
    when 'medications' then v_kind := 'medical'; v_title := 'עדכון רפואי'; v_detail := left(coalesce(to_jsonb(r) ->> 'name',''), 160);
    when 'students' then
      v_kind := 'student'; v_sid := r.id;
      v_sname := coalesce(nullif(r.name,''), nullif(trim(coalesce(r.family,'')),''));
      v_title := case when v_op = 'insert' then 'נוסף תלמיד חדש' else 'עודכן כרטיס תלמיד' end;
      v_detail := '';
    when 'tasks' then v_kind := 'task'; v_title := 'משימה'; v_detail := left(coalesce(to_jsonb(r) ->> 'title',''), 160);
    else v_kind := tg_table_name; v_title := 'רישום חדש'; v_detail := '';
  end case;
  insert into public.activity_feed
    (kind, entity, entity_id, op, actor, actor_name, actor_role, student_id, student_name, title, detail)
  values
    (v_kind, tg_table_name, (to_jsonb(r) ->> 'id')::bigint, v_op, v_actor, v_aname, v_arole,
     v_sid, v_sname, v_title, nullif(v_detail,''));
  return null;
exception when others then
  return null;
end $function$;

-- ⚠️ שים לב: מכניס ל-actor_id, אבל בטבלה actor_id לא קיים (רק actor) — ראו הערה למעלה.
CREATE OR REPLACE FUNCTION public.calls_to_feed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
    DECLARE
      actor_name  TEXT;
      actor_role  TEXT;
    BEGIN
      BEGIN
        SELECT name, role INTO actor_name, actor_role
          FROM public.profiles WHERE id = NEW.created_by;
      EXCEPTION WHEN OTHERS THEN
        actor_name := NULL; actor_role := NULL;
      END;
      INSERT INTO public.activity_feed (kind, title, detail, actor_id, actor_name, actor_role, student_id, created_at)
      VALUES (
        'voice',
        CASE WHEN NEW.direction='in' THEN 'שיחה נכנסת' ELSE 'שיחה יוצאת' END,
        COALESCE(NEW.contact_name, NEW.to_number) ||
          CASE WHEN NEW.from_ext IS NOT NULL THEN ' · שלוחה ' || NEW.from_ext ELSE '' END,
        NEW.created_by, actor_name, actor_role, NEW.student_id, NEW.started_at
      );
      RETURN NEW;
    EXCEPTION WHEN OTHERS THEN
      RETURN NEW;
    END;
    $function$;

-- ===== טבלאות =====

create table if not exists public.activity_feed (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  entity text not null,
  entity_id bigint,
  op text not null,
  actor uuid,
  actor_name text,
  actor_role text,
  student_id bigint,
  student_name text,
  title text,
  detail text
);
alter table public.activity_feed enable row level security;
drop policy if exists activity_feed_read on public.activity_feed;
create policy activity_feed_read on public.activity_feed for select to authenticated using (can_see_feed());

create table if not exists public.contacts (
  id bigserial primary key,
  name text not null,
  phone text not null,
  source text not null default 'manual',
  notes text,
  student_id bigint,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.contacts enable row level security;
drop policy if exists contacts_select_admin on public.contacts;
create policy contacts_select_admin on public.contacts for select using (can_see_feed());
drop policy if exists contacts_insert_admin on public.contacts;
create policy contacts_insert_admin on public.contacts for insert with check (can_see_feed());
drop policy if exists contacts_update_admin on public.contacts;
create policy contacts_update_admin on public.contacts for update using (can_see_feed()) with check (can_see_feed());
drop policy if exists contacts_delete_admin on public.contacts;
create policy contacts_delete_admin on public.contacts for delete using (can_see_feed());

create table if not exists public.calls (
  id bigserial primary key,
  contact_id bigint references public.contacts(id),
  student_id bigint,
  direction text not null default 'out',
  from_ext text,
  to_number text not null,
  contact_name text,
  started_at timestamptz not null default now(),
  duration_sec integer,
  status text,
  note text,
  created_by uuid
);
alter table public.calls enable row level security;
drop policy if exists calls_select_admin on public.calls;
create policy calls_select_admin on public.calls for select using (can_see_feed());
drop policy if exists calls_insert_admin on public.calls;
create policy calls_insert_admin on public.calls for insert with check (can_see_feed());

create table if not exists public.institution_settings (
  id integer primary key default 1,
  stamp_data text,
  letterhead_data text,
  stamp_x integer not null default 72,
  stamp_y integer not null default 80,
  stamp_size integer not null default 130,
  cert_title text not null default 'אישור לימודים',
  updated_at timestamptz not null default now(),
  moses_symbol text,
  cert_from text
);
alter table public.institution_settings enable row level security;
drop policy if exists inst_read on public.institution_settings;
create policy inst_read on public.institution_settings for select to authenticated using (is_staff());
drop policy if exists inst_admin on public.institution_settings;
create policy inst_admin on public.institution_settings for all to authenticated using (is_admin()) with check (is_admin());
insert into public.institution_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.reading_categories (
  id bigserial primary key,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.reading_categories enable row level security;
drop policy if exists rcat_read on public.reading_categories;
create policy rcat_read on public.reading_categories for select to authenticated using (is_staff());
drop policy if exists rcat_admin on public.reading_categories;
create policy rcat_admin on public.reading_categories for all to authenticated using (is_admin()) with check (is_admin());

create table if not exists public.reading_assessments (
  id bigserial primary key,
  student_id bigint not null,
  assessed_on date not null default current_date,
  scores jsonb not null default '{}'::jsonb,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.reading_assessments enable row level security;
drop policy if exists rasm_read on public.reading_assessments;
create policy rasm_read on public.reading_assessments for select to authenticated using (is_admin() or created_by = auth.uid() or can_read_student(student_id));
drop policy if exists rasm_ins on public.reading_assessments;
create policy rasm_ins on public.reading_assessments for insert to authenticated with check (is_staff());
drop policy if exists rasm_upd on public.reading_assessments;
create policy rasm_upd on public.reading_assessments for update to authenticated using (is_admin() or created_by = auth.uid()) with check (is_admin() or created_by = auth.uid());
drop policy if exists rasm_del on public.reading_assessments;
create policy rasm_del on public.reading_assessments for delete to authenticated using (is_admin() or created_by = auth.uid());

create table if not exists public.student_links (
  student_id bigint primary key references public.students(id) on delete cascade,
  mails jsonb,
  files jsonb,
  updated_at timestamptz default now()
);
