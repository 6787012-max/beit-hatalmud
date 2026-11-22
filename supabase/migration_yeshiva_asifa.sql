-- migration_yeshiva_asifa.sql — שיבוץ פגישות באסיפת הורים של ישיבת משמרת חיים (25/11/2026)
--
-- מערכת נפרדת לגמרי מזו של המכינה: רק אובייקטים חדשים עם קידומת yeshiva_asifa_.
-- תלמידי הישיבה לא נמצאים במסד, ולכן ההורה מזין בעצמו שם הורה, שם בחור, שיעור וטלפון.
-- אין גישה ישירה לטבלאות (RLS פעיל, ל-anon אין פוליסי). הכול דרך פונקציות SECURITY DEFINER:
--   yeshiva_asifa_public / _mine / _book / _move / _cancel  (בקישור עם טוקן ההורים)
--   yeshiva_asifa_results                                  (בקישור עם מפתח התוצאות, קריאה בלבד)
-- כל ההגדרות (תאריך, שעות, רבנים, שיעורים) בטבלת yeshiva_asifa_settings, בלי שינוי קוד.
-- אידמפוטנטי.

create table if not exists public.yeshiva_asifa_settings (
  id            bigint generated always as identity primary key,
  code          text not null unique,
  title         text not null,
  date          date not null,
  slot_minutes  integer not null default 15 check (slot_minutes between 5 and 120),
  contact_text  text,
  reg_open      boolean not null default true,
  public_token  text not null unique default replace(gen_random_uuid()::text, '-', ''),
  results_key   text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  -- שיעורים שההורה בוחר ביניהם
  classes       jsonb not null default '["שיעור א׳","שיעור ב׳"]'::jsonb,
  -- [{id, name, where, start:'21:15', end:'23:00'}]  (השעות: מ-start עד end בקפיצות של slot_minutes)
  rabbis        jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.yeshiva_asifa_bookings (
  id            bigint generated always as identity primary key,
  settings_id   bigint not null references public.yeshiva_asifa_settings(id) on delete cascade,
  rav_id        text not null,
  slot_time     text not null check (slot_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  parent_name   text not null,
  student_name  text not null,
  student_key   text not null,   -- שם הבחור מנורמל (רווחים), לזיהוי "אותו בחור"
  class_name    text not null,
  phone         text not null,   -- 9 ספרות אחרונות
  created_at    timestamptz not null default now(),
  -- בלי כפילות בתור
  constraint yeshiva_asifa_slot_uq    unique (settings_id, rav_id, slot_time),
  -- לא שני תורים אצל אותו רב לאותו בחור
  constraint yeshiva_asifa_student_uq unique (settings_id, rav_id, student_key),
  -- לא שני תורים באותה שעה לאותו הורה (טלפון)
  constraint yeshiva_asifa_phone_uq   unique (settings_id, phone, slot_time),
  -- ולא לאותו בחור
  constraint yeshiva_asifa_stutime_uq unique (settings_id, student_key, slot_time)
);
create index if not exists idx_yeshiva_asifa_bookings_phone on public.yeshiva_asifa_bookings(settings_id, phone);

alter table public.yeshiva_asifa_settings enable row level security;
alter table public.yeshiva_asifa_bookings enable row level security;
revoke all on public.yeshiva_asifa_settings from anon, public;
revoke all on public.yeshiva_asifa_bookings from anon, public;

-- מנהל/מזכירה מחוברים: ניהול ישיר (כמו במכינה). anon: כלום.
drop policy if exists yeshiva_asifa_settings_admin on public.yeshiva_asifa_settings;
create policy yeshiva_asifa_settings_admin on public.yeshiva_asifa_settings for all
  using (coalesce(public.is_admin(), false) or coalesce(public.my_role() = 'מזכירה', false))
  with check (coalesce(public.is_admin(), false) or coalesce(public.my_role() = 'מזכירה', false));
drop policy if exists yeshiva_asifa_bookings_admin on public.yeshiva_asifa_bookings;
create policy yeshiva_asifa_bookings_admin on public.yeshiva_asifa_bookings for all
  using (coalesce(public.is_admin(), false) or coalesce(public.my_role() = 'מזכירה', false))
  with check (coalesce(public.is_admin(), false) or coalesce(public.my_role() = 'מזכירה', false));

-- ===== עזרים =====
create or replace function public.yeshiva_asifa_hm(t text) returns integer
  language sql immutable as
$$ select split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int $$;

create or replace function public.yeshiva_asifa_phone9(p text) returns text
  language sql immutable as
$$ select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 9
               then right(regexp_replace(p, '\D', '', 'g'), 9) else null end $$;

create or replace function public.yeshiva_asifa_norm_name(p text) returns text
  language sql immutable as
$$ select lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))) $$;

-- ===== ציבורי: פרטי האסיפה + שעות תפוסות (בלי שמות) =====
create or replace function public.yeshiva_asifa_public(p_token text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare m public.yeshiva_asifa_settings; occ jsonb;
begin
  select * into m from public.yeshiva_asifa_settings where public_token = p_token limit 1;
  if not found then return null; end if;
  select coalesce(jsonb_object_agg(rav_id, slots), '{}'::jsonb) into occ
    from (select rav_id, jsonb_agg(slot_time order by slot_time) slots
            from public.yeshiva_asifa_bookings where settings_id = m.id group by rav_id) x;
  return jsonb_build_object(
    'title', m.title, 'date', m.date, 'slot_minutes', m.slot_minutes,
    'contact_text', m.contact_text, 'open', m.reg_open, 'classes', m.classes,
    'rabbis', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', r->>'id', 'name', r->>'name', 'where', r->>'where',
                  'start', r->>'start', 'end', r->>'end')), '[]'::jsonb)
                 from jsonb_array_elements(m.rabbis) r),
    'occupied', occ);
end $$;

-- ===== ציבורי: הפגישות של אותו טלפון =====
create or replace function public.yeshiva_asifa_mine(p_token text, p_phone text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare m public.yeshiva_asifa_settings; p9 text;
begin
  select * into m from public.yeshiva_asifa_settings where public_token = p_token limit 1;
  if not found then return '[]'::jsonb; end if;
  p9 := public.yeshiva_asifa_phone9(p_phone);
  if p9 is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'rav_id', b.rav_id, 'slot', b.slot_time,
      'student', b.student_name, 'student_key', b.student_key,
      'parent', b.parent_name, 'class_name', b.class_name) order by b.slot_time, b.id)
    from public.yeshiva_asifa_bookings b
    where b.settings_id = m.id and b.phone = p9), '[]'::jsonb);
end $$;

-- ===== ציבורי: הזמנת תור =====
create or replace function public.yeshiva_asifa_book(
  p_token text, p_parent text, p_student text, p_class text, p_phone text, p_rav text, p_slot text)
  returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  m public.yeshiva_asifa_settings; p9 text; r jsonb; st int; en int; sl int;
  v_parent text; v_student text; v_key text; v_id bigint;
begin
  select * into m from public.yeshiva_asifa_settings where public_token = p_token limit 1;
  if not found then raise exception 'הקישור אינו תקין'; end if;
  if not m.reg_open then raise exception 'ההרשמה סגורה כרגע'; end if;
  v_parent := btrim(regexp_replace(coalesce(p_parent, ''), '\s+', ' ', 'g'));
  v_student := btrim(regexp_replace(coalesce(p_student, ''), '\s+', ' ', 'g'));
  v_key := public.yeshiva_asifa_norm_name(v_student);
  if length(v_parent) < 2 or length(v_parent) > 60 then raise exception 'נא למלא שם הורה'; end if;
  if length(v_student) < 2 or length(v_student) > 60 then raise exception 'נא למלא שם בחור'; end if;
  if not (m.classes @> to_jsonb(coalesce(p_class, ''))) then raise exception 'נא לבחור שיעור'; end if;
  p9 := public.yeshiva_asifa_phone9(p_phone);
  if p9 is null then raise exception 'נא למלא טלפון תקין'; end if;
  select t.x into r from jsonb_array_elements(m.rabbis) as t(x) where t.x->>'id' = p_rav limit 1;
  if r is null then raise exception 'הרב שנבחר אינו קיים'; end if;
  if p_slot is null or p_slot !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception 'שעה לא תקינה'; end if;
  st := public.yeshiva_asifa_hm(r->>'start'); en := public.yeshiva_asifa_hm(r->>'end');
  sl := public.yeshiva_asifa_hm(p_slot);
  if sl < st or sl + m.slot_minutes > en or (sl - st) % m.slot_minutes <> 0 then
    raise exception 'השעה שנבחרה אינה זמינה אצל הרב';
  end if;
  begin
    insert into public.yeshiva_asifa_bookings(settings_id, rav_id, slot_time, parent_name, student_name, student_key, class_name, phone)
      values (m.id, p_rav, p_slot, v_parent, v_student, v_key, p_class, p9)
      returning id into v_id;
  exception when unique_violation then
    if exists (select 1 from public.yeshiva_asifa_bookings where settings_id = m.id and rav_id = p_rav and slot_time = p_slot) then
      raise exception 'התור הזה נתפס הרגע, בחרו שעה אחרת';
    elsif exists (select 1 from public.yeshiva_asifa_bookings where settings_id = m.id and rav_id = p_rav and student_key = v_key) then
      raise exception 'כבר נקבע תור לבחור הזה אצל הרב הזה';
    else
      raise exception 'כבר נקבעה לכם פגישה אחרת באותה שעה, בחרו שעה אחרת';
    end if;
  end;
  return jsonb_build_object('ok', true, 'id', v_id, 'rav_id', p_rav, 'rav', r->>'name', 'where', r->>'where',
                            'slot', p_slot, 'date', m.date, 'student', v_student);
end $$;

-- ===== ציבורי: שינוי שעה (אטומי: או שהשעה החדשה נקבעה, או שהישנה נשארת) =====
create or replace function public.yeshiva_asifa_move(p_token text, p_phone text, p_booking_id bigint, p_slot text)
  returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  m public.yeshiva_asifa_settings; p9 text; b public.yeshiva_asifa_bookings; r jsonb; st int; en int; sl int;
begin
  select * into m from public.yeshiva_asifa_settings where public_token = p_token limit 1;
  if not found then raise exception 'הקישור אינו תקין'; end if;
  if not m.reg_open then raise exception 'ההרשמה סגורה כרגע'; end if;
  p9 := public.yeshiva_asifa_phone9(p_phone);
  select * into b from public.yeshiva_asifa_bookings where id = p_booking_id and settings_id = m.id;
  if not found or p9 is null or b.phone <> p9 then raise exception 'הפגישה לא נמצאה עבור הטלפון הזה'; end if;
  select t.x into r from jsonb_array_elements(m.rabbis) as t(x) where t.x->>'id' = b.rav_id limit 1;
  if p_slot is null or p_slot !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception 'שעה לא תקינה'; end if;
  st := public.yeshiva_asifa_hm(r->>'start'); en := public.yeshiva_asifa_hm(r->>'end');
  sl := public.yeshiva_asifa_hm(p_slot);
  if sl < st or sl + m.slot_minutes > en or (sl - st) % m.slot_minutes <> 0 then
    raise exception 'השעה שנבחרה אינה זמינה אצל הרב';
  end if;
  begin
    update public.yeshiva_asifa_bookings set slot_time = p_slot where id = b.id;
  exception when unique_violation then
    if exists (select 1 from public.yeshiva_asifa_bookings where settings_id = m.id and rav_id = b.rav_id and slot_time = p_slot) then
      raise exception 'התור הזה נתפס הרגע, בחרו שעה אחרת';
    else
      raise exception 'כבר נקבעה לכם פגישה אחרת באותה שעה, בחרו שעה אחרת';
    end if;
  end;
  return jsonb_build_object('ok', true, 'id', b.id, 'rav_id', b.rav_id, 'rav', r->>'name', 'where', r->>'where',
                            'slot', p_slot, 'date', m.date, 'student', b.student_name);
end $$;

-- ===== ציבורי: ביטול =====
create or replace function public.yeshiva_asifa_cancel(p_token text, p_phone text, p_booking_id bigint)
  returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare m public.yeshiva_asifa_settings; p9 text; n int;
begin
  select * into m from public.yeshiva_asifa_settings where public_token = p_token limit 1;
  if not found then raise exception 'הקישור אינו תקין'; end if;
  if not m.reg_open then raise exception 'ההרשמה סגורה כרגע'; end if;
  p9 := public.yeshiva_asifa_phone9(p_phone);
  if p9 is null then raise exception 'נא למלא טלפון תקין'; end if;
  delete from public.yeshiva_asifa_bookings where id = p_booking_id and settings_id = m.id and phone = p9;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'הפגישה לא נמצאה עבור הטלפון הזה'; end if;
  return jsonb_build_object('ok', true, 'deleted', n);
end $$;

-- ===== קריאה בלבד לרב לינצ'נר: כל הפגישות, לפי מפתח התוצאות =====
create or replace function public.yeshiva_asifa_results(p_key text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare m public.yeshiva_asifa_settings;
begin
  if p_key is null or length(p_key) < 32 then return null; end if;
  select * into m from public.yeshiva_asifa_settings where results_key = p_key limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'title', m.title, 'date', m.date, 'slot_minutes', m.slot_minutes, 'now', now(),
    'rabbis', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r->>'id', 'name', r->>'name', 'where', r->>'where', 'start', r->>'start', 'end', r->>'end',
        'bookings', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'time', b.slot_time, 'parent', b.parent_name, 'student', b.student_name,
            'class_name', b.class_name, 'phone', b.phone) order by b.slot_time), '[]'::jsonb)
          from public.yeshiva_asifa_bookings b
          where b.settings_id = m.id and b.rav_id = r->>'id')
      ) order by ord), '[]'::jsonb)
      from jsonb_array_elements(m.rabbis) with ordinality as t(r, ord)));
end $$;

revoke all on function public.yeshiva_asifa_public(text) from public;
revoke all on function public.yeshiva_asifa_mine(text, text) from public;
revoke all on function public.yeshiva_asifa_book(text, text, text, text, text, text, text) from public;
revoke all on function public.yeshiva_asifa_move(text, text, bigint, text) from public;
revoke all on function public.yeshiva_asifa_cancel(text, text, bigint) from public;
revoke all on function public.yeshiva_asifa_results(text) from public;
grant execute on function public.yeshiva_asifa_public(text) to anon, authenticated;
grant execute on function public.yeshiva_asifa_mine(text, text) to anon, authenticated;
grant execute on function public.yeshiva_asifa_book(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.yeshiva_asifa_move(text, text, bigint, text) to anon, authenticated;
grant execute on function public.yeshiva_asifa_cancel(text, text, bigint) to anon, authenticated;
grant execute on function public.yeshiva_asifa_results(text) to anon, authenticated;

-- ===== האסיפה של 25/11/2026 (ט"ו כסלו תשפ"ז) =====
insert into public.yeshiva_asifa_settings(code, title, date, slot_minutes, contact_text, classes, rabbis)
values (
  'yeshiva-2026-11-25',
  'ישיבת משמרת חיים, אסיפת הורים',
  date '2026-11-25',
  15,
  'לשאלות ולשינויים אפשר לפנות להנהלת הישיבה.',
  '["שיעור א׳","שיעור ב׳"]'::jsonb,
  '[{"id":"heinman","name":"הרב יהונתן היינמן","where":"שיעור א׳","start":"21:15","end":"23:00"},
    {"id":"weinberg-yager","name":"הרב יאיר וינברג והרב דוד יגר","where":"שיעור ב׳","start":"21:15","end":"23:00"},
    {"id":"zvi-weinberg","name":"הרב צבי וינברג","where":"במשרדו","start":"21:15","end":"23:00"},
    {"id":"lintzner","name":"הרב שלמה לינצ׳נר","where":"במשרדו","start":"21:15","end":"23:00"}]'::jsonb)
on conflict (code) do update set classes = excluded.classes;
