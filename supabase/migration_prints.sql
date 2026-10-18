-- migration_prints.sql — מעקב הדפסות לצוות + ניהול סיסמאות צוות למנהל (18/10/2026, בקשת יוסף).
--
-- ── חלק א: הדפסות ──
-- היה גיליון Google Sheets נפרד ("נתוני הדפסות", בבעלות 6787012) + טופס גוגל.
-- כל רב "טוען" כסף מראש, וכל הדפסה מורידה מהיתרה לפי מחיר לעמוד.
-- נמצאו בגיליון שלוש תקלות, ובגללן הוא עובר לתוכנה ולא "מתוקן" במקום:
--   1. הנוסחאות בלשונית "טעינה" חותכות ב-F2:I999. מאז 17/07/2026 (שורה 999 של
--      הטופס) **אף הדפסה לא נספרה** — 39 הדפסות, ובהן ₪96.88 של סורוצקין ו-₪85.59
--      של רוקמיל. היתרה שהוצגה בגיליון היתה גבוהה מהאמת.
--   2. "סכום שנטען" הוא מספר אחד מצטבר לכל רב, בלי תאריך ובלי היסטוריה.
--   3. המחיר מחושב מחדש על כל ההיסטוריה — שינוי מחיר היה משנה גם הדפסות עבר.
-- המודל כאן: כל הדפסה שומרת את המחיר שהיה בתוקף ברגע ההדפסה (unit_price), וכל
-- טעינה היא שורה עם תאריך. היתרה = סך הטעינות פחות סך ההדפסות.
-- החשבון הוא איש הצוות עצמו (public.staff) — "רק הצוות של השנה" (יוסף), בלי רשימת
-- שמות נפרדת שצריך לתחזק.
--
-- ── חלק ב: סיסמאות צוות ──
-- יוסף ביקש שהמנהל יוכל לשנות סיסמה של איש צוות **ולראות את הסיסמה הנוכחית**.
-- Supabase שומר רק hash, ולכן אי אפשר "לשלוף" סיסמה קיימת. המודל:
--   • staff_passwords — עותק קריא של הסיסמה, **מנהל בלבד** (RLS), נכתב רק דרך RPC.
--   • admin_set_password — מנהל קובע סיסמה: מעדכן את ה-hash ב-auth.users ושומר עותק.
--   • pw_record_own — משתמש שהחליף סיסמה בעצמו: נשמר עותק **רק אם היא תואמת**
--     את ה-hash האמיתי (אי אפשר לרשום ערך מומצא).
--   • מילוי ראשוני: מי שעדיין בסיסמת ברירת המחדל (הטלפון) — מאומת מול ה-hash ונרשם.
--     לשאר הסיסמה פשוט לא ידועה, עד שהמנהל או המשתמש יקבעו חדשה.
-- ⚠️ זה עותק בטקסט גלוי בכוונה (בקשת המנהל). חלון החלפת הסיסמה העצמי מודיע על כך.
--
-- הרץ דרך Management API (קריאת הקובץ ב-utf-8 — ר' CLAUDE.md, מלכודת cp1255). אידמפוטנטי.

-- ════════════════════ חלק א: הדפסות ════════════════════

create table if not exists public.print_prices (
  color      text not null check (color in ('צבעוני', 'שחור לבן')),
  size       text not null check (size in ('A4', 'A3')),
  price      numeric(8,3) not null check (price >= 0),
  updated_at timestamptz not null default now(),
  primary key (color, size)
);
-- המחירים מהגיליון: דיו (צבעוני 0.32 / ש"ל 0.04) + נייר (A4 0.03 / A3 0.07).
insert into public.print_prices (color, size, price) values
  ('צבעוני', 'A4', 0.35), ('שחור לבן', 'A4', 0.07),
  ('צבעוני', 'A3', 0.39), ('שחור לבן', 'A3', 0.11)
on conflict (color, size) do nothing;

create table if not exists public.print_jobs (
  id          bigint generated always as identity primary key,
  staff_id    bigint not null references public.staff(id),
  printed_at  timestamptz not null default now(),
  color       text not null check (color in ('צבעוני', 'שחור לבן')),
  size        text not null check (size in ('A4', 'A3')),
  qty         integer not null check (qty > 0 and qty <= 5000),
  unit_price  numeric(8,3) not null,
  cost        numeric(12,3) generated always as (qty * unit_price) stored,
  source      text not null default 'תוכנה',      -- 'גיליון' (יבוא) / 'תוכנה' / 'קישור'
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_print_jobs_staff on public.print_jobs(staff_id, printed_at desc);

create table if not exists public.print_credits (
  id          bigint generated always as identity primary key,
  staff_id    bigint not null references public.staff(id),
  amount      numeric(10,2) not null check (amount <> 0),   -- שלילי = תיקון/החזר
  credited_at date not null default current_date,
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_print_credits_staff on public.print_credits(staff_id);

-- המחיר נקבע בשרת ברגע ההכנסה, לפי הטבלה. מי שאינו משרד לא יכול לקבוע מחיר משלו.
create or replace function public.print_jobs_price() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  -- coalesce: בלי משתמש מחובר my_role() מחזיר null, ו-not(null) אינו true — המחיר שנשלח היה נשמר כמו שהוא.
  if new.unit_price is null or not coalesce(public.is_admin() or public.my_role() = 'מזכירה', false) then
    select price into new.unit_price from public.print_prices where color = new.color and size = new.size;
  end if;
  if new.unit_price is null then raise exception 'אין מחיר מוגדר ל-% %', new.color, new.size; end if;
  return new;
end $$;
drop trigger if exists trg_print_jobs_price on public.print_jobs;
create trigger trg_print_jobs_price before insert on public.print_jobs
  for each row execute function public.print_jobs_price();

-- איש הצוות של המשתמש המחובר (staff.user_id). staff עצמה סגורה למנהל בלבד.
create or replace function public.my_staff_id() returns bigint
  language sql stable security definer set search_path = public as
$$ select id from public.staff where user_id = auth.uid() and active order by id limit 1 $$;

create or replace function public.is_print_office() returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce(public.is_admin() or public.my_role() in ('מזכירה', 'מפקח'), false) $$;

alter table public.print_prices  enable row level security;
alter table public.print_jobs    enable row level security;
alter table public.print_credits enable row level security;

drop policy if exists print_prices_read  on public.print_prices;
drop policy if exists print_prices_write on public.print_prices;
create policy print_prices_read  on public.print_prices for select using (auth.uid() is not null);
create policy print_prices_write on public.print_prices for all
  using (public.is_admin() or public.my_role() = 'מזכירה')
  with check (public.is_admin() or public.my_role() = 'מזכירה');

-- הדפסות: המשרד רואה הכל; איש צוות רואה ומוסיף רק את שלו. עריכה/מחיקה — משרד בלבד.
drop policy if exists print_jobs_office     on public.print_jobs;
drop policy if exists print_jobs_own_read   on public.print_jobs;
drop policy if exists print_jobs_own_insert on public.print_jobs;
create policy print_jobs_office on public.print_jobs for all
  using (public.is_admin() or public.my_role() = 'מזכירה')
  with check (public.is_admin() or public.my_role() = 'מזכירה');
create policy print_jobs_own_read on public.print_jobs for select
  using (public.is_print_office() or staff_id = public.my_staff_id());
create policy print_jobs_own_insert on public.print_jobs for insert
  with check (staff_id = public.my_staff_id());

drop policy if exists print_credits_office   on public.print_credits;
drop policy if exists print_credits_own_read on public.print_credits;
create policy print_credits_office on public.print_credits for all
  using (public.is_admin() or public.my_role() = 'מזכירה')
  with check (public.is_admin() or public.my_role() = 'מזכירה');
create policy print_credits_own_read on public.print_credits for select
  using (public.is_print_office() or staff_id = public.my_staff_id());

-- יתרות: כל הצוות הפעיל למשרד, ושורה אחת בלבד (שלו) לאיש צוות רגיל.
-- כולל גם איש צוות שהושבת אבל יש לו תנועות — כדי שיתרה פתוחה לא תיעלם מהעין.
drop function if exists public.print_balances();
create or replace function public.print_balances() returns table(
  staff_id bigint, name text, role_label text, active boolean, has_user boolean,
  credits numeric, used numeric, balance numeric, jobs bigint, pages bigint, last_print timestamptz)
  language sql stable security definer set search_path = public as
$$
  with c as (select staff_id, sum(amount) amt from public.print_credits group by staff_id),
       j as (select staff_id, sum(cost) amt, count(*) n, sum(qty) pages, max(printed_at) last
               from public.print_jobs group by staff_id)
  select s.id, trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), s.role_label,
         s.active, s.user_id is not null,
         coalesce(c.amt, 0), round(coalesce(j.amt, 0), 2), round(coalesce(c.amt, 0) - coalesce(j.amt, 0), 2),
         coalesce(j.n, 0), coalesce(j.pages, 0), j.last
    from public.staff s
    left join c on c.staff_id = s.id
    left join j on j.staff_id = s.id
   where (s.active or c.amt is not null or j.n is not null)
     and (public.is_print_office() or s.id = public.my_staff_id())
   order by s.last_name, s.first_name
$$;
revoke all on function public.print_balances() from public, anon;
grant execute on function public.print_balances() to authenticated;

-- ── קישור ציבורי לדיווח הדפסה (מחליף את טופס הגוגל; לסריקה ליד המדפסת) ──
-- קוד אקראי בלתי-נחיש, כמו forms.link_token (migration_public_forms.sql).
create table if not exists public.print_link (
  id         int primary key default 1 check (id = 1),
  token      text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.print_link (id, token)
  values (1, encode(extensions.gen_random_bytes(12), 'hex'))
on conflict (id) do nothing;
alter table public.print_link enable row level security;
drop policy if exists print_link_admin on public.print_link;
create policy print_link_admin on public.print_link for all
  using (public.is_admin() or public.my_role() = 'מזכירה')
  with check (public.is_admin() or public.my_role() = 'מזכירה');

create or replace function public.print_public_staff(k text) returns table(staff_id bigint, name text)
  language sql stable security definer set search_path = public as
$$ select s.id, trim(coalesce(s.last_name, '') || ' ' || coalesce(s.first_name, ''))
     from public.staff s
    where s.active
      and exists (select 1 from public.print_link l where l.token = k and l.enabled)
    order by s.last_name, s.first_name $$;

create or replace function public.print_public_report(k text, p_staff bigint, p_color text, p_size text, p_qty int)
  returns table(cost numeric, balance numeric)
  language plpgsql security definer set search_path = public as
$$
declare v_cost numeric;
begin
  if not exists (select 1 from public.print_link l where l.token = k and l.enabled) then
    raise exception 'הקישור אינו פעיל';
  end if;
  if not exists (select 1 from public.staff where id = p_staff and active) then
    raise exception 'איש הצוות לא נמצא';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 2000 then raise exception 'כמות לא תקינה'; end if;
  insert into public.print_jobs (staff_id, color, size, qty, unit_price, source, created_by)
    values (p_staff, p_color, p_size, p_qty,
            (select price from public.print_prices where color = p_color and size = p_size), 'קישור', null)
    returning print_jobs.cost into v_cost;
  return query
    select v_cost,
           round(coalesce((select sum(amount) from public.print_credits where staff_id = p_staff), 0)
               - coalesce((select sum(j.cost) from public.print_jobs j where j.staff_id = p_staff), 0), 2);
end $$;
revoke all on function public.print_public_staff(text) from public;
revoke all on function public.print_public_report(text, bigint, text, text, int) from public;
grant execute on function public.print_public_staff(text) to anon, authenticated;
grant execute on function public.print_public_report(text, bigint, text, text, int) to anon, authenticated;

-- ════════════════════ חלק ב: סיסמאות צוות ════════════════════

create table if not exists public.staff_passwords (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  password text not null,
  source   text not null,                 -- 'מנהל' / 'המשתמש' / 'ברירת מחדל'
  set_by   uuid,
  set_at   timestamptz not null default now()
);
alter table public.staff_passwords enable row level security;
drop policy if exists staff_passwords_admin_read on public.staff_passwords;
create policy staff_passwords_admin_read on public.staff_passwords for select using (public.is_admin());
-- אין policy לכתיבה: נכתב רק דרך הפונקציות למטה (security definer).

create or replace function public.admin_set_password(p_user uuid, p_password text) returns boolean
  language plpgsql security definer set search_path = public, extensions as
$$
declare v_phone text;
begin
  if not public.is_admin() then raise exception 'רק מנהל רשאי לשנות סיסמה של משתמש אחר'; end if;
  if p_password is null or length(p_password) < 6 then raise exception 'הסיסמה חייבת להכיל 6 תווים לפחות'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user;
  if not found then raise exception 'המשתמש לא נמצא'; end if;
  select split_part(email, '@', 1) into v_phone from auth.users where id = p_user;
  insert into public.staff_passwords (user_id, password, source, set_by, set_at)
    values (p_user, p_password, case when p_password = v_phone then 'ברירת מחדל' else 'מנהל' end, auth.uid(), now())
  on conflict (user_id) do update
    set password = excluded.password, source = excluded.source, set_by = excluded.set_by, set_at = now();
  -- סיסמה שהמנהל קבע אינה "ברירת המחדל" — לא כופים על המשתמש להחליף אותה
  -- (אחרת העותק אצל המנהל היה מתיישן מיד). אם הוא קבע בדיוק את הטלפון — כן כופים.
  update public.profiles
     set pw_changed_at = case when p_password = v_phone then null else now() end
   where id = p_user;
  insert into public.audit_log (user_id, action, entity, detail)
    values (auth.uid(), 'שינוי סיסמה', 'profiles',
            'המנהל קבע סיסמה חדשה ל: ' || coalesce((select name from public.profiles where id = p_user), p_user::text));
  return true;
end $$;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

-- נקרא אחרי שמשתמש החליף סיסמה בעצמו. נרשם רק אם תואם ל-hash האמיתי.
create or replace function public.pw_record_own(p_password text) returns boolean
  language plpgsql security definer set search_path = public, extensions as
$$
declare ok boolean;
begin
  if auth.uid() is null or p_password is null then return false; end if;
  select u.encrypted_password = extensions.crypt(p_password, u.encrypted_password) into ok
    from auth.users u where u.id = auth.uid();
  if not coalesce(ok, false) then return false; end if;
  insert into public.staff_passwords (user_id, password, source, set_by, set_at)
    values (auth.uid(), p_password, 'המשתמש', auth.uid(), now())
  on conflict (user_id) do update
    set password = excluded.password, source = 'המשתמש', set_by = excluded.set_by, set_at = now();
  return true;
end $$;
revoke all on function public.pw_record_own(text) from public, anon;
grant execute on function public.pw_record_own(text) to authenticated;

-- מילוי ראשוני: מי שהסיסמה שלו עדיין הטלפון (חלק המייל שלפני ה-@) — מאומת מול ה-hash.
insert into public.staff_passwords (user_id, password, source, set_at)
select u.id, split_part(u.email, '@', 1), 'ברירת מחדל', now()
  from auth.users u
 where u.email like '%@bht.co.il'
   and u.encrypted_password = extensions.crypt(split_part(u.email, '@', 1), u.encrypted_password)
on conflict (user_id) do nothing;

-- ════════════════════ חלק ג: טעינה אוטומטית מנדרים פלוס ════════════════════
-- (18/10/2026, בקשת יוסף: "שיוטען אוטומטית מטעינות ישירות של נדרים פלוס, וגם טעינה ידנית".)
-- הזרימה: הרב לוחץ "טעינה בנדרים פלוס" → דף התשלום של המכינה (מוסד 7009572) עם
-- קטגוריה "הדפסות" נעולה והערה "הדפסות #<staff_id>" → נדרים שולחים Webhook (POST JSON,
-- פעם אחת בלבד) ל-Edge Function `nedarim-print` → print_nedarim_ingest() כאן.
-- זיהוי איש הצוות: #מספר בהערות → ת"ז → טלפון → שם מלא (רק התאמה יחידה). מה שלא זוהה,
-- או הגיע מכתובת IP שאינה של נדרים, נשמר כ"ממתין לשיוך" ולא נטען — המשרד משייך ידנית.
-- ⚠️ לנדרים יש כתובת Webhook אחת למוסד ("עוד > Webhook"). אם כבר מוגדרת שם כתובת של
-- מערכת אחרת — הגדרת שלנו תדרוס אותה.

alter table public.print_credits add column if not exists source text not null default 'ידני';
alter table public.print_credits add column if not exists nedarim_tx text unique;
update public.print_credits set source = 'גיליון' where source = 'ידני' and note like 'יתרת טעינות מצטברת%';

create table if not exists public.print_nedarim (
  id         int primary key default 1 check (id = 1),
  mosad      text not null default '7009572',
  groupe     text not null default 'הדפסות',
  secret     text not null,
  updated_at timestamptz not null default now()
);
insert into public.print_nedarim (id, secret) values (1, encode(extensions.gen_random_bytes(16), 'hex'))
on conflict (id) do nothing;
alter table public.print_nedarim enable row level security;
drop policy if exists print_nedarim_office on public.print_nedarim;
create policy print_nedarim_office on public.print_nedarim for all
  using (public.is_admin() or public.my_role() = 'מזכירה')
  with check (public.is_admin() or public.my_role() = 'מזכירה');

-- מה שכל איש צוות צריך כדי לבנות את קישור התשלום — בלי הסוד.
create or replace function public.print_nedarim_link() returns table(mosad text, groupe text, staff_id bigint, name text)
  language sql stable security definer set search_path = public as
$$ select n.mosad, n.groupe, s.id, trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, ''))
     from public.print_nedarim n left join public.staff s on s.id = public.my_staff_id()
    where n.id = 1 and auth.uid() is not null $$;
revoke all on function public.print_nedarim_link() from public, anon;
grant execute on function public.print_nedarim_link() to authenticated;

create table if not exists public.print_nedarim_payments (
  id          bigint generated always as identity primary key,
  tx          text not null unique,
  received_at timestamptz not null default now(),
  paid_at     timestamptz,
  amount      numeric(10,2),
  currency    text,
  client_name text,
  phone       text,
  zeout       text,
  groupe      text,
  comments    text,
  staff_id    bigint references public.staff(id),
  credit_id   bigint references public.print_credits(id) on delete set null,
  status      text not null default 'ממתין לשיוך',   -- 'נטען' / 'ממתין לשיוך'
  note        text,
  raw         jsonb
);
alter table public.print_nedarim_payments enable row level security;
drop policy if exists print_nedarim_payments_office on public.print_nedarim_payments;
create policy print_nedarim_payments_office on public.print_nedarim_payments for select
  using (public.is_print_office());

-- נקרא רק מה-Edge Function (service_role). p_trusted = הפניה הגיעה מכתובת IP של נדרים.
create or replace function public.print_nedarim_ingest(p jsonb, p_trusted boolean) returns text
  language plpgsql security definer set search_path = public as
$$
declare
  v_tx text := nullif(trim(coalesce(p->>'TransactionId', '')), '');
  v_groupe text := coalesce(p->>'Groupe', '');
  v_comments text := coalesce(p->>'Comments', p->>'Comment', '');
  v_name text := trim(coalesce(p->>'ClientName', ''));
  v_amount numeric; v_paid timestamptz; v_pid bigint; v_sid bigint; v_cid bigint; v_why text;
  v_zeout text := ltrim(regexp_replace(coalesce(p->>'Zeout', ''), '[^0-9]', '', 'g'), '0');
  v_phone text := right(regexp_replace(coalesce(p->>'Phone', ''), '[^0-9]', '', 'g'), 9);
begin
  if v_tx is null then return 'אין מזהה עסקה'; end if;
  if v_groupe not like '%הדפס%' and v_comments not like '%הדפס%' then return 'לא קשור להדפסות'; end if;
  begin v_amount := nullif(regexp_replace(coalesce(p->>'Amount', ''), '[^0-9.]', '', 'g'), '')::numeric;
  exception when others then v_amount := null; end;
  begin v_paid := to_timestamp(p->>'TransactionTime', 'DD/MM/YYYY HH24:MI:SS')::timestamp at time zone 'Asia/Jerusalem';
  exception when others then v_paid := null; end;
  insert into public.print_nedarim_payments (tx, paid_at, amount, currency, client_name, phone, zeout, groupe, comments, raw)
    values (v_tx, coalesce(v_paid, now()), v_amount, p->>'Currency', v_name, p->>'Phone', p->>'Zeout', v_groupe, v_comments, p)
  on conflict (tx) do nothing returning id into v_pid;
  if v_pid is null then return 'כפול — כבר נקלט'; end if;

  -- זיהוי: #מספר בהערות, ואחריו ת"ז / טלפון / שם — רק אם יש התאמה אחת בדיוק.
  select s.id into v_sid from public.staff s
   where s.id = nullif(substring(v_comments from '#([0-9]+)'), '')::bigint and s.active;
  if v_sid is null and v_zeout <> '' then
    select min(s.id) into v_sid from public.staff s where s.active
      and ltrim(regexp_replace(coalesce(s.tz, ''), '[^0-9]', '', 'g'), '0') = v_zeout
    having count(*) = 1;
  end if;
  if v_sid is null and length(v_phone) = 9 then
    select min(s.id) into v_sid from public.staff s where s.active
      and right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 9) = v_phone
    having count(*) = 1;
  end if;
  if v_sid is null and v_name <> '' then
    select min(s.id) into v_sid from public.staff s where s.active
      and v_name in (trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
                     trim(coalesce(s.last_name, '') || ' ' || coalesce(s.first_name, '')))
    having count(*) = 1;
  end if;

  v_why := case when not p_trusted then 'הגיע מכתובת שאינה של נדרים — לבדוק לפני שיוך'
                when v_sid is null then 'לא זוהה איש צוות'
                when coalesce(nullif(p->>'Currency', ''), '1') <> '1' then 'מטבע זר'
                when v_amount is null or v_amount <= 0 then 'סכום לא תקין' end;
  if v_why is not null then
    update public.print_nedarim_payments set staff_id = v_sid, note = v_why where id = v_pid;
    return 'ממתין לשיוך: ' || v_why;
  end if;
  insert into public.print_credits (staff_id, amount, credited_at, note, source, nedarim_tx, created_by)
    values (v_sid, v_amount, (coalesce(v_paid, now()) at time zone 'Asia/Jerusalem')::date,
            'נדרים פלוס · ' || coalesce(nullif(v_name, ''), '—') || ' · עסקה ' || v_tx, 'נדרים פלוס', v_tx, null)
    returning id into v_cid;
  update public.print_nedarim_payments set staff_id = v_sid, credit_id = v_cid, status = 'נטען' where id = v_pid;
  return 'נטען';
end $$;
revoke all on function public.print_nedarim_ingest(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.print_nedarim_ingest(jsonb, boolean) to service_role;

-- שיוך ידני של תשלום שלא זוהה (משרד בלבד).
create or replace function public.print_assign_nedarim(p_id bigint, p_staff bigint) returns boolean
  language plpgsql security definer set search_path = public as
$$
declare r record; v_cid bigint;
begin
  if not coalesce(public.is_admin() or public.my_role() = 'מזכירה', false) then raise exception 'אין הרשאה'; end if;
  select * into r from public.print_nedarim_payments where id = p_id for update;
  if r.id is null then raise exception 'התשלום לא נמצא'; end if;
  if r.status = 'נטען' then raise exception 'התשלום כבר נטען'; end if;
  if r.amount is null or r.amount <= 0 then raise exception 'סכום לא תקין'; end if;
  insert into public.print_credits (staff_id, amount, credited_at, note, source, nedarim_tx)
    values (p_staff, r.amount, (coalesce(r.paid_at, now()) at time zone 'Asia/Jerusalem')::date,
            'נדרים פלוס · ' || coalesce(nullif(r.client_name, ''), '—') || ' · עסקה ' || r.tx || ' (שויך ידנית)', 'נדרים פלוס', r.tx)
    returning id into v_cid;
  update public.print_nedarim_payments set staff_id = p_staff, credit_id = v_cid, status = 'נטען',
         note = coalesce(note || ' · ', '') || 'שויך ידנית' where id = p_id;
  return true;
end $$;
revoke all on function public.print_assign_nedarim(bigint, bigint) from public, anon;
grant execute on function public.print_assign_nedarim(bigint, bigint) to authenticated;
