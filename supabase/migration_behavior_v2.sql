-- migration_behavior_v2.sql — מעקב התנהגות, "שלב 2: גרסה 2" (2026-10-19)
--
-- מקור: פרק 4 במסמך C:/projects/beit-hatalmud-research/מעקב-התנהגות-גרסה-2.html
-- דורש את migration_behavior_security_stage0.sql (my_write_ok, behavior_author_trg).
--
--   • behavior_types — סוג אירוע קבוע עם אייקון וכיוון (חיובי / לתיקון / ניטרלי).
--     הקטגוריות הישנות ערבבו "מה קרה" עם "של מי המעקב" (4 מתוך 6 קרויות על שם רב).
--   • על כל דיווח: type_id, assignee ("למעקב של"), status (log/open/in_progress/closed),
--     closed_at, source (site/phone/extension/attendance), group_id (דיווח לכמה תלמידים),
--     place, deleted_at/deleted_by (סל מחזור). due_date הקיים = "תאריך בדיקה".
--   • followup הישן נשאר ומסונכרן עם status בטריגר, כדי שכל מסך שעוד קורא אותו
--     (לוח שנה, כרטיס תלמיד, גרסאות ישנות בדפדפן) ימשיך לעבוד.
--   • מקרה פתוח תמיד עם אחראי ותאריך בדיקה: חסר = נקבע אוטומטית (המחנך של השיעור, +7 ימים).
--   • מחיקה = סל מחזור. DELETE של כל איש צוות הופך ל-deleted_at; רק behavior_purge_trash
--     (מנהל) מוחק באמת, ואז נמחקים גם היומן, העדכונים ויומן השינויים של הדיווח.
--   • behavior_audit — יומן שינויים (מנהל ומפקח בלבד).
--   • הגנה מכפילות בשרת: אותו רושם, תלמיד, סוג והערה בתוך 30 שניות נדחים.
--   • המרה: 108 הדיווחים הקיימים מקבלים סוג/אחראי לפי הקטגוריה, חומרה "רגילה" כשריקה,
--     ו-9 ה"במעקב" נפתחים כמקרה עם תאריך בדיקה היום. שום דיווח לא נמחק ולא נדרס.
--
-- ⚠️ לקרוא עם io.open(..., encoding='utf-8'). אידמפוטנטי.

begin;

-- ───────────────────────── 1. סוגי אירוע ─────────────────────────
create table if not exists public.behavior_types (
  id         bigserial primary key,
  name       text not null unique,
  icon       text not null default '📌',
  direction  text not null default 'neutral' check (direction in ('positive', 'corrective', 'neutral')),
  sort       int  not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.behavior_types (name, icon, direction, sort) values
  ('איחור',          '⏰', 'corrective', 10),
  ('הפרעה',          '🗣️', 'corrective', 20),
  ('לא מוכן',        '📕', 'corrective', 30),
  ('חברים',          '🤝', 'corrective', 40),
  ('התנהגות',        '⚠️', 'corrective', 50),
  ('שיחה עם תלמיד',  '💬', 'neutral',    60),
  ('שיחה עם הורים',  '👪', 'neutral',    70),
  ('נקודת אור',      '⭐', 'positive',   80),
  ('אחר',            '📌', 'neutral',    90)
on conflict (name) do nothing;

alter table public.behavior_types enable row level security;
drop policy if exists bt_read on public.behavior_types;
create policy bt_read on public.behavior_types for select to authenticated using (public.is_staff());
drop policy if exists bt_admin on public.behavior_types;
create policy bt_admin on public.behavior_types for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on table public.behavior_types from anon;
grant select, insert, update, delete on table public.behavior_types to authenticated;
grant usage on sequence public.behavior_types_id_seq to authenticated;

-- הקטגוריות הישנות → סוג + "למעקב של" (משמש גם להמרה וגם לגרסאות ישנות שעוד שולחות category_id)
alter table public.categories add column if not exists type_id  bigint references public.behavior_types(id);
alter table public.categories add column if not exists assignee uuid;

update public.categories c set type_id = t.id
  from public.behavior_types t
 where c.type_id is null and t.name = case
   when c.name like '%הורים%' then 'שיחה עם הורים'
   when c.name like '%סורוצקין%' or c.name like '%יודלוב%' then 'שיחה עם תלמיד'
   when c.name like '%התנהגות%' then 'התנהגות'
   else 'אחר' end;
update public.categories c set assignee = p.id
  from public.profiles p
 where c.assignee is null and p.active and (
       (c.name like '%וינברג%'   and p.name like '%וינברג%')
    or (c.name like '%סורוצקין%' and p.name like '%סורוצקין%')
    or (c.name like '%יודלוב%'   and p.name like '%יודלוב%')
    or (c.name like '%קליין%'    and p.name like '%קליין%'));

-- ───────────────────────── 2. שדות חדשים על כל דיווח ─────────────────────────
alter table public.behavior_events add column if not exists type_id    bigint references public.behavior_types(id);
alter table public.behavior_events add column if not exists assignee   uuid;
alter table public.behavior_events add column if not exists status     text;
alter table public.behavior_events add column if not exists closed_at  timestamptz;
alter table public.behavior_events add column if not exists source     text not null default 'site';
alter table public.behavior_events add column if not exists group_id   uuid;
alter table public.behavior_events add column if not exists place      text;
alter table public.behavior_events add column if not exists deleted_at timestamptz;
alter table public.behavior_events add column if not exists deleted_by uuid;

-- ───────────────────────── 3. המרת הקיים (לפני הטריגרים, כדי שלא ייכנס ליומן השינויים) ─────────────────────────
create or replace function public.behavior_default_assignee(sid bigint) returns uuid
  language sql stable security definer set search_path = public as
$$ select p.id
     from public.students s
     join public.user_class_access u on u.class_id = s.class_id
     join public.profiles p on p.id = u.user_id
    where s.id = sid and p.active and p.role = 'מחנך'
    order by (select count(*) from public.user_class_access u2 where u2.user_id = p.id), p.id
    limit 1 $$;

update public.behavior_events e set type_id = c.type_id
  from public.categories c where e.type_id is null and e.category_id = c.id;
update public.behavior_events e set assignee = c.assignee
  from public.categories c where e.assignee is null and e.category_id = c.id and c.assignee is not null;
update public.behavior_events set severity = 'רגילה' where severity is null or severity = '';
update public.behavior_events
   set status   = case when followup then 'open' else 'log' end,
       due_date = case when followup then coalesce(due_date, current_date) else due_date end
 where status is null;
update public.behavior_events
   set assignee = coalesce(public.behavior_default_assignee(student_id), created_by)
 where status in ('open', 'in_progress') and assignee is null;

alter table public.behavior_events alter column status set default 'log';
alter table public.behavior_events alter column status set not null;
alter table public.behavior_events alter column severity set default 'רגילה';
alter table public.behavior_events alter column severity set not null;
alter table public.behavior_events drop constraint if exists behavior_events_status_chk;
alter table public.behavior_events add constraint behavior_events_status_chk
  check (status in ('log', 'open', 'in_progress', 'closed'));
alter table public.behavior_events drop constraint if exists behavior_events_source_chk;
alter table public.behavior_events add constraint behavior_events_source_chk
  check (source in ('site', 'phone', 'extension', 'attendance'));
alter table public.behavior_events drop constraint if exists behavior_events_severity_chk;
alter table public.behavior_events add constraint behavior_events_severity_chk
  check (severity in ('נמוכה', 'רגילה', 'גבוהה'));

create index if not exists behavior_events_open_idx on public.behavior_events (status) where status in ('open', 'in_progress');
create index if not exists behavior_events_deleted_idx on public.behavior_events (deleted_at) where deleted_at is not null;

-- ───────────────────────── 4. יומן שינויים ─────────────────────────
create table if not exists public.behavior_audit (
  id       bigserial primary key,
  event_id bigint not null,
  op       text not null,
  actor    uuid,
  at       timestamptz not null default now(),
  old_row  jsonb,
  new_row  jsonb
);
create index if not exists behavior_audit_event_idx on public.behavior_audit (event_id);
alter table public.behavior_audit enable row level security;
drop policy if exists ba_read on public.behavior_audit;
create policy ba_read on public.behavior_audit for select to authenticated using (public.can_see_feed());
revoke all on table public.behavior_audit from anon;
revoke insert, update, delete, truncate on table public.behavior_audit from authenticated;
grant select on table public.behavior_audit to authenticated;

-- ───────────────────────── 5. הטריגר של גרסה 2 ─────────────────────────
-- רץ אחרי behavior_author_trg (סדר אלפביתי), כך ש-created_by כבר נקבע.
create or replace function public.behavior_v2_before() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare
  me uuid := auth.uid();
  fixed text[] := array['status', 'due_date', 'followup', 'closed_at', 'assignee'];
  c record;
begin
  new.severity := coalesce(nullif(new.severity, ''), 'רגילה');
  if new.source is null then new.source := 'site'; end if;

  if tg_op = 'INSERT' then
    -- גרסה ישנה שעוד שולחת קטגוריה: הסוג ו"למעקב של" נגזרים ממנה; בלי כלום = "אחר"
    if new.type_id is null and new.category_id is not null then
      select type_id, assignee into c from public.categories where id = new.category_id;
      new.type_id  := c.type_id;
      new.assignee := coalesce(new.assignee, c.assignee);
    end if;
    if new.type_id is null then
      select id into new.type_id from public.behavior_types where name = 'אחר';
    end if;
    if new.status is null or new.status = 'log' then
      new.status := case when new.followup then 'open' else coalesce(new.status, 'log') end;
    end if;
    -- דאבל-טאפ / שליחה חוזרת: אותו רושם, תלמיד, סוג והערה בתוך 30 שניות
    if me is not null and exists (
         select 1 from public.behavior_events e
          where e.created_by = me and e.student_id = new.student_id
            and e.type_id is not distinct from new.type_id
            and coalesce(e.note, '') = coalesce(new.note, '')
            and e.deleted_at is null
            and e.created_at > now() - interval '30 seconds') then
      raise exception 'DUPLICATE_REPORT' using errcode = 'P0001',
        hint = 'אותו דיווח בדיוק נשמר לפני רגע';
    end if;
  else
    -- גרסה ישנה שמחליפה רק followup ("טופל" / דגל) — מתורגם למצב
    if new.followup is distinct from old.followup and new.status is not distinct from old.status then
      new.status := case when new.followup
                         then case when old.status in ('open', 'in_progress') then old.status else 'open' end
                         else 'closed' end;
    end if;
    -- שחזור מסל המחזור — מנהל בלבד
    if old.deleted_at is not null and new.deleted_at is null and me is not null and not public.is_admin() then
      raise exception 'RESTORE_ADMIN_ONLY' using errcode = '42501';
    end if;
    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_by := coalesce(me, new.deleted_by);
    end if;
    -- "למעקב של" שאינו רשאי לערוך את הדיווח: רק מצב, תאריך בדיקה ואחראי
    if me is not null and not public.can_edit_record(old.student_id, old.created_by)
       and (to_jsonb(new) - fixed) is distinct from (to_jsonb(old) - fixed) then
      raise exception 'ASSIGNEE_STATUS_ONLY' using errcode = '42501';
    end if;
  end if;

  new.followup := new.status in ('open', 'in_progress');
  if new.followup then
    new.due_date := coalesce(new.due_date, current_date + 7);
    new.assignee := coalesce(new.assignee, public.behavior_default_assignee(new.student_id), me, new.created_by);
    new.closed_at := null;
  elsif new.status = 'closed' and (tg_op = 'INSERT' or old.status is distinct from 'closed') then
    new.closed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists behavior_v2_trg on public.behavior_events;
create trigger behavior_v2_trg before insert or update on public.behavior_events
  for each row execute function public.behavior_v2_before();

-- מחיקה = סל מחזור. רק behavior_purge_trash (או service_role / SQL ידני) מוחק באמת.
create or replace function public.behavior_soft_delete() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is null or coalesce(current_setting('beh.purge', true), '') = 'on' then
    return old;
  end if;
  update public.behavior_events set deleted_at = now() where id = old.id and deleted_at is null;
  return null;
end $$;
drop trigger if exists behavior_soft_delete_trg on public.behavior_events;
create trigger behavior_soft_delete_trg before delete on public.behavior_events
  for each row execute function public.behavior_soft_delete();

create or replace function public.behavior_audit_log() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'followup') is not distinct from (to_jsonb(old) - 'followup') then return null; end if;
    insert into public.behavior_audit (event_id, op, actor, old_row, new_row)
      values (new.id, case when new.deleted_at is not null and old.deleted_at is null then 'trash'
                           when new.deleted_at is null and old.deleted_at is not null then 'restore'
                           else 'update' end,
              auth.uid(), to_jsonb(old), to_jsonb(new));
  else
    -- מחיקה אמיתית (ניקוי הסל): לא נשאר עותק של התוכן, כמו בשלב 0
    delete from public.behavior_audit where event_id = old.id;
  end if;
  return null;
end $$;
drop trigger if exists behavior_audit_trg on public.behavior_events;
create trigger behavior_audit_trg after update or delete on public.behavior_events
  for each row execute function public.behavior_audit_log();

-- ניקוי הסל: p_id = דיווח אחד עכשיו; בלי p_id = מה שבסל יותר מ-30 יום
create or replace function public.behavior_purge_trash(p_id bigint default null) returns int
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY' using errcode = '42501'; end if;
  perform set_config('beh.purge', 'on', true);
  delete from public.behavior_comments c using public.behavior_events e
   where c.event_id = e.id and e.deleted_at is not null
     and (case when p_id is null then e.deleted_at < now() - interval '30 days' else e.id = p_id end);
  delete from public.behavior_events e
   where e.deleted_at is not null
     and (case when p_id is null then e.deleted_at < now() - interval '30 days' else e.id = p_id end);
  get diagnostics n = row_count;
  perform set_config('beh.purge', '', true);
  return n;
end $$;
revoke all on function public.behavior_purge_trash(bigint) from public, anon;
grant execute on function public.behavior_purge_trash(bigint) to authenticated;

-- ───────────────────────── 6. "למעקב של" רשאי לעדכן מצב ─────────────────────────
drop policy if exists beh_upd on public.behavior_events;
create policy beh_upd on public.behavior_events for update to authenticated
  using      (public.my_write_ok() and (public.can_edit_record(student_id, created_by)
              or (assignee = auth.uid() and public.can_see_student(student_id))))
  with check (public.my_write_ok() and (public.can_edit_record(student_id, created_by)
              or (assignee = auth.uid() and public.can_see_student(student_id))));

-- ───────────────────────── 7. התצוגות (עקיפת נטפרי: ההערה ב-base64) ─────────────────────────
-- התצוגה הרגילה מסתירה את מה שבסל; לסל ולמחוקים יש תצוגה משלהם.
drop view if exists public.behavior_events_enc;
create view public.behavior_events_enc with (security_invoker = true) as
  select id, student_id, category_id, severity, event_date, event_time,
         case when note is null then null::text else encode(convert_to(note, 'UTF8'), 'base64') end as note_b64,
         created_by, created_at, followup, due_date,
         type_id, assignee, status, closed_at, source, group_id, place
    from public.behavior_events
   where deleted_at is null;

drop view if exists public.behavior_events_trash_enc;
create view public.behavior_events_trash_enc with (security_invoker = true) as
  select id, student_id, category_id, severity, event_date, event_time,
         case when note is null then null::text else encode(convert_to(note, 'UTF8'), 'base64') end as note_b64,
         created_by, created_at, type_id, status, deleted_at, deleted_by
    from public.behavior_events
   where deleted_at is not null;

drop view if exists public.behavior_audit_enc;
create view public.behavior_audit_enc with (security_invoker = true) as
  select id, event_id, op, actor, at,
         encode(convert_to(coalesce(old_row::text, ''), 'UTF8'), 'base64') as old_b64,
         encode(convert_to(coalesce(new_row::text, ''), 'UTF8'), 'base64') as new_b64
    from public.behavior_audit;

revoke all on table public.behavior_events_enc, public.behavior_events_trash_enc, public.behavior_audit_enc from anon;
grant select on table public.behavior_events_enc, public.behavior_events_trash_enc, public.behavior_audit_enc to authenticated;

commit;
