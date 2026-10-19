-- migration_behavior_rules.sql — מעקב התנהגות, "שלב 3: חכם" (2026-10-19)
--
-- כללי התראה ("3 דיווחי לתיקון בשבועיים ← למחנך") והתראות אישיות.
--   • behavior_rules — scope: corrective (דיווח מסוג "לתיקון") / type (סוג מסוים) / late (איחור בנוכחות).
--     notify: mechanech (המחנכים של השיעור; אין — המנהלים) / admins.
--   • notifications — התראה לאדם אחד. רואה ומסמן רק הנמען (notification_read).
--   • נבדק אחרי כל דיווח חדש ואחרי כל סימון "איחור" בנוכחות. אותו כלל על אותו תלמיד לא
--     מתריע שוב בתוך חלון הזמן של הכלל. תקלה בבדיקה לעולם לא מפילה את הדיווח עצמו.
-- דורש migration_behavior_v2.sql. ⚠️ לקרוא עם io.open(..., encoding='utf-8'). אידמפוטנטי.

begin;

create table if not exists public.behavior_rules (
  id          bigserial primary key,
  name        text not null unique,
  scope       text not null check (scope in ('corrective', 'type', 'late')),
  type_id     bigint references public.behavior_types(id),
  threshold   int  not null check (threshold > 0),
  window_days int  not null check (window_days > 0),
  notify      text not null default 'mechanech' check (notify in ('mechanech', 'admins')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into public.behavior_rules (name, scope, threshold, window_days, notify) values
  ('3 דיווחי לתיקון בשבועיים', 'corrective', 3, 14, 'mechanech'),
  ('3 איחורים בשבועיים (נוכחות)', 'late', 3, 14, 'mechanech')
on conflict (name) do nothing;

alter table public.behavior_rules enable row level security;
drop policy if exists br_read on public.behavior_rules;
create policy br_read on public.behavior_rules for select to authenticated using (public.is_staff());
drop policy if exists br_admin on public.behavior_rules;
create policy br_admin on public.behavior_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on table public.behavior_rules from anon;
grant select, insert, update, delete on table public.behavior_rules to authenticated;
grant usage on sequence public.behavior_rules_id_seq to authenticated;

create table if not exists public.notifications (
  id         bigserial primary key,
  user_id    uuid not null,
  kind       text not null default 'rule',
  title      text not null,
  body       text,
  student_id bigint,
  rule_id    bigint,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, read_at);
create index if not exists notifications_rule_idx on public.notifications (rule_id, student_id, created_at);
alter table public.notifications enable row level security;
drop policy if exists notif_own on public.notifications;
create policy notif_own on public.notifications for select to authenticated using (user_id = auth.uid());
revoke all on table public.notifications from anon;
revoke insert, update, delete, truncate on table public.notifications from authenticated;
grant select on table public.notifications to authenticated;

create or replace function public.notification_read(p_id bigint default null) returns int
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_id is null or id = p_id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.notification_read(bigint) from public, anon;
grant execute on function public.notification_read(bigint) to authenticated;

-- הבדיקה עצמה: לכל כלל פעיל מה-scope הזה — כמה בחלון, ואם עבר את הסף ולא התריע כבר בחלון
create or replace function public.behavior_rules_check(p_student bigint, p_scope text, p_type bigint default null)
  returns int language plpgsql security definer set search_path = public as
$$
declare
  r record; n int; total int := 0; cls bigint;
begin
  select class_id into cls from public.students where id = p_student;
  for r in select * from public.behavior_rules
            where active and scope = p_scope and (scope <> 'type' or type_id = p_type) loop
    if r.scope = 'late' then
      select count(*) into n from public.attendance
       where student_id = p_student and status = 'late' and date > current_date - r.window_days;
    else
      select count(*) into n from public.behavior_events e
        left join public.behavior_types t on t.id = e.type_id
       where e.student_id = p_student and e.deleted_at is null
         and e.event_date > current_date - r.window_days
         and (case when r.scope = 'type' then e.type_id = r.type_id else t.direction = 'corrective' end);
    end if;
    continue when n < r.threshold;
    continue when exists (select 1 from public.notifications x
                           where x.rule_id = r.id and x.student_id = p_student
                             and x.created_at > now() - make_interval(days => r.window_days));
    insert into public.notifications (user_id, kind, title, body, student_id, rule_id)
    select u.id, 'rule', r.name, n || ' ב-' || r.window_days || ' הימים האחרונים', p_student, r.id
      from (
        select p.id from public.profiles p
         where r.notify = 'mechanech' and p.active and p.role = 'מחנך'
           and exists (select 1 from public.user_class_access a where a.user_id = p.id and a.class_id = cls)
        union
        select p.id from public.profiles p
         where p.active and p.role = 'מנהל'
           and (r.notify = 'admins' or not exists (
                 select 1 from public.profiles q join public.user_class_access a on a.user_id = q.id
                  where q.active and q.role = 'מחנך' and a.class_id = cls))
      ) u;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end $$;
revoke all on function public.behavior_rules_check(bigint, text, bigint) from public, anon, authenticated;

create or replace function public.behavior_rules_trg() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  begin
    if tg_table_name = 'attendance' then
      if new.status = 'late' and (tg_op = 'INSERT' or old.status is distinct from 'late') then
        perform public.behavior_rules_check(new.student_id, 'late');
      end if;
    elsif new.deleted_at is null then
      perform public.behavior_rules_check(new.student_id, 'corrective');
      perform public.behavior_rules_check(new.student_id, 'type', new.type_id);
    end if;
  exception when others then
    null;                       -- התראה שנכשלה לא מפילה דיווח אמיתי
  end;
  return null;
end $$;

drop trigger if exists behavior_rules_trg on public.behavior_events;
create trigger behavior_rules_trg after insert on public.behavior_events
  for each row execute function public.behavior_rules_trg();
drop trigger if exists behavior_rules_trg on public.attendance;
create trigger behavior_rules_trg after insert or update of status on public.attendance
  for each row execute function public.behavior_rules_trg();

commit;
