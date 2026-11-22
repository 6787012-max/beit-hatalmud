-- migration_meds_klein.sql — לשונית "כדורים" (2026-11-22, בקשת יוסף)
--
-- הרב קליין אחראי על נושא הכדורים של התלמידים. הגישה:
--   • מנהל תמיד, ומי ש-'meds' נמצא ברשימת ההרשאות (perms) של הפרופיל שלו.
--   • שאר הצוות לא מקבל כלום (לא טבלת התרופות, לא ההיסטוריה, לא הסטטוס).
--
-- מה נוסף:
--   1. can_manage_meds()        — הבדיקה המרכזית (מנהל או perms ∋ 'meds').
--   2. מדיניות על medications    — מי שמורשה קורא ומעדכן (המדיניות הקיימת נשארת).
--   3. medication_history        — יומן שינויים לכל תלמיד (נכתב רק בטריגרים/RPC).
--   4. student_med_status        — סטטוס לכל תלמיד: לוקח / לא לוקח / לבדוק.
--   5. med_save(...)             — הדרך לשמור: עושה את השינוי והערת העדכון בטרנזקציה אחת.
--
-- אידמפוטנטי — בטוח להריץ שוב.

-- ───────────────────────────── 1. הרשאה ─────────────────────────────
create or replace function public.can_manage_meds()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.active
          and 'meds' = any(coalesce(p.perms, '{}'::text[]))
      )
$$;
revoke all on function public.can_manage_meds() from public, anon;
grant execute on function public.can_manage_meds() to authenticated;

-- ───────────────────────────── 2. מדיניות ───────────────────────────
-- המדיניות הקיימת (med_all = can_see_deep, med_write = is_admin) נשארת כמות שהיא.
-- זו מדיניות נוספת (OR): מי שיש לו 'meds' מקבל גישה לשורות התרופות בלבד.
drop policy if exists med_manage on public.medications;
create policy med_manage on public.medications for all to authenticated
  using (public.can_manage_meds())
  with check (public.can_manage_meds());

-- ───────────────────────────── 3. יומן שינויים ──────────────────────
create table if not exists public.medication_history (
  id              bigserial primary key,
  student_id      bigint not null references public.students(id) on delete cascade,
  medication_id   bigint,                       -- בלי FK: הרשומה עשויה להימחק, והיומן נשאר
  kind            text not null,                -- 'תרופה' | 'סטטוס' | 'הערה'
  action          text not null,                -- 'insert' | 'update' | 'delete' | 'status' | 'note'
  changed_at      timestamptz not null default now(),
  changed_by      uuid,
  changed_by_name text,
  old_data        jsonb,                        -- היה
  new_data        jsonb,                        -- עכשיו
  note            text                          -- הערת העדכון החופשית
);
create index if not exists medication_history_student_idx
  on public.medication_history(student_id, changed_at desc);

alter table public.medication_history enable row level security;
drop policy if exists medhist_read on public.medication_history;
create policy medhist_read on public.medication_history for select to authenticated
  using (public.can_manage_meds());
-- אין מדיניות כתיבה: היומן נכתב רק מטריגרים ומ-med_save (SECURITY DEFINER).
revoke all on public.medication_history from anon;
revoke insert, update, delete on public.medication_history from authenticated;
grant select on public.medication_history to authenticated;

-- ───────────────────────────── 4. סטטוס תלמיד ───────────────────────
create table if not exists public.student_med_status (
  student_id bigint primary key references public.students(id) on delete cascade,
  status     text not null check (status in ('לוקח', 'לא לוקח', 'לבדוק')),
  note       text,                              -- הערת הסטטוס הנוכחית
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.student_med_status enable row level security;
drop policy if exists sms_manage on public.student_med_status;
create policy sms_manage on public.student_med_status for all to authenticated
  using (public.can_manage_meds())
  with check (public.can_manage_meds());
revoke all on public.student_med_status from anon;
grant select, insert, update, delete on public.student_med_status to authenticated;

-- ───────────────────────────── 5. טריגרים ליומן ─────────────────────
-- הערת העדכון נקראת מ-app.med_note, שמוגדרת ע"י med_save לטרנזקציה הנוכחית בלבד.
create or replace function public.med_history_fn()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_note text := nullif(current_setting('app.med_note', true), '');
  v_name text := coalesce((select p.name from public.profiles p where p.id = auth.uid()), 'מערכת');
begin
  if tg_op = 'INSERT' then
    insert into public.medication_history
      (student_id, medication_id, kind, action, changed_by, changed_by_name, old_data, new_data, note)
    values (new.student_id, new.id, 'תרופה', 'insert', auth.uid(), v_name, null, to_jsonb(new), v_note);
    return new;
  elsif tg_op = 'UPDATE' then
    if old is not distinct from new then return new; end if;
    insert into public.medication_history
      (student_id, medication_id, kind, action, changed_by, changed_by_name, old_data, new_data, note)
    values (new.student_id, new.id, 'תרופה', 'update', auth.uid(), v_name, to_jsonb(old), to_jsonb(new), v_note);
    return new;
  else
    insert into public.medication_history
      (student_id, medication_id, kind, action, changed_by, changed_by_name, old_data, new_data, note)
    values (old.student_id, old.id, 'תרופה', 'delete', auth.uid(), v_name, to_jsonb(old), null, v_note);
    return old;
  end if;
end $$;

drop trigger if exists med_history_trg on public.medications;
create trigger med_history_trg
  after insert or update or delete on public.medications
  for each row execute function public.med_history_fn();

create or replace function public.med_status_hist_fn()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_note text := nullif(current_setting('app.med_note', true), '');
  v_name text := coalesce((select p.name from public.profiles p where p.id = auth.uid()), 'מערכת');
begin
  if tg_op = 'UPDATE' and old.status = new.status and coalesce(old.note, '') = coalesce(new.note, '') then
    return new;
  end if;
  insert into public.medication_history
    (student_id, medication_id, kind, action, changed_by, changed_by_name, old_data, new_data, note)
  values (
    new.student_id, null, 'סטטוס', 'status', auth.uid(), v_name,
    case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status, 'note', old.note) end,
    jsonb_build_object('status', new.status, 'note', new.note),
    v_note);
  return new;
end $$;

drop trigger if exists med_status_hist_trg on public.student_med_status;
create trigger med_status_hist_trg
  after insert or update on public.student_med_status
  for each row execute function public.med_status_hist_fn();

-- ───────────────────────────── 6. שמירה אטומית ──────────────────────
-- p_op: 'insert' | 'update' | 'delete' | 'status' | 'note'
-- p_data: לתרופה — השורה המלאה (שדות FIELDS של התרופה);
--         לסטטוס — {"status": "...", "note": "..."}.
-- p_note: הערת העדכון החופשית (נכנסת ליומן).
create or replace function public.med_save(
  p_op      text,
  p_student bigint,
  p_id      bigint default null,
  p_data    jsonb  default null,
  p_note    text   default null
)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  r public.medications;
  v_id bigint;
begin
  if not public.can_manage_meds() then
    raise exception 'אין הרשאה לניהול כדורים' using errcode = '42501';
  end if;
  if p_op not in ('insert', 'update', 'delete', 'status', 'note') then
    raise exception 'פעולה לא מוכרת: %', p_op;
  end if;

  perform set_config('app.med_note', coalesce(trim(p_note), ''), true);

  if p_op = 'insert' then
    r := jsonb_populate_record(null::public.medications, p_data);
    if coalesce(r.category, 'תרופה') <> 'תרופה' then
      raise exception 'הלשונית הזאת מיועדת לתרופות בלבד';
    end if;
    if nullif(trim(coalesce(r.name, '')), '') is null then
      raise exception 'חובה שם תרופה';
    end if;
    insert into public.medications
      (student_id, kind, category, name, details, purpose, dose, hours, take_time, take_how,
       side_during, side_after, second, dose2, hours2, notes, active, updated_on, source)
    values
      (p_student, 'תרופה', 'תרופה', r.name, null, r.purpose, r.dose, r.hours, r.take_time, r.take_how,
       r.side_during, r.side_after, coalesce(r.second, false), r.dose2, r.hours2, r.notes,
       coalesce(r.active, true), r.updated_on, coalesce(r.source, 'ידני'))
    returning id into v_id;
    return v_id;

  elsif p_op = 'update' then
    r := jsonb_populate_record(null::public.medications, p_data);
    update public.medications m set
      name        = r.name,
      purpose     = r.purpose,
      dose        = r.dose,
      hours       = r.hours,
      take_time   = r.take_time,
      take_how    = r.take_how,
      side_during = r.side_during,
      side_after  = r.side_after,
      second      = coalesce(r.second, false),
      dose2       = r.dose2,
      hours2      = r.hours2,
      notes       = r.notes,
      active      = coalesce(r.active, true),
      updated_on  = r.updated_on
    where m.id = p_id and m.student_id = p_student and m.category = 'תרופה';
    if not found then
      raise exception 'הרישום לא נמצא';
    end if;
    return p_id;

  elsif p_op = 'delete' then
    delete from public.medications
      where id = p_id and student_id = p_student and category = 'תרופה';
    if not found then
      raise exception 'הרישום לא נמצא';
    end if;
    return p_id;

  elsif p_op = 'status' then
    insert into public.student_med_status (student_id, status, note, updated_at, updated_by)
    values (p_student, p_data->>'status', nullif(p_data->>'note', ''), now(), auth.uid())
    on conflict (student_id) do update set
      status     = excluded.status,
      note       = excluded.note,
      updated_at = now(),
      updated_by = auth.uid();
    return null;

  else -- 'note': הערה חופשית בלי שינוי נתונים
    if nullif(trim(coalesce(p_note, '')), '') is null then
      raise exception 'חובה לכתוב הערה';
    end if;
    insert into public.medication_history
      (student_id, medication_id, kind, action, changed_by, changed_by_name, note)
    values (
      p_student, null, 'הערה', 'note', auth.uid(),
      coalesce((select p.name from public.profiles p where p.id = auth.uid()), 'מערכת'),
      trim(p_note));
    return null;
  end if;
end $$;

revoke all on function public.med_save(text, bigint, bigint, jsonb, text) from public, anon;
grant execute on function public.med_save(text, bigint, bigint, jsonb, text) to authenticated;
