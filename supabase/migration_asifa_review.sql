-- migration_asifa_review.sql — דף ביקורת תמונות לשלט אסיפת ההורים (17/11/2026)
-- אובייקטים חדשים בלבד, קידומת asifa_review_. אידמפוטנטי.
-- RLS פעיל ובלי פוליסי: anon לא קורא ולא כותב ישירות. גישה רק דרך פונקציות SECURITY DEFINER עם מפתח של 64 תווים.
-- התמונות: bucket ציבורי asifa-review, תיקייה אקראית (folder) שמוחזרת רק לבעל המפתח. אין list ל-anon.

create table if not exists public.asifa_review_sessions (
  key        text primary key default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  label      text not null unique,
  title      text not null default 'שלט אסיפת ההורים',
  folder     text not null default substr(replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), 1, 32),
  sheet      text,
  items      jsonb not null default '[]'::jsonb,   -- [{num, fp}]
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint asifa_review_key_len check (length(key) = 64)
);
create table if not exists public.asifa_review_marks (
  session_key text not null references public.asifa_review_sessions(key) on delete cascade,
  num         int  not null,
  remove      boolean not null default false,
  note        text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (session_key, num)
);
alter table public.asifa_review_sessions enable row level security;
alter table public.asifa_review_marks    enable row level security;
revoke all on public.asifa_review_sessions from anon, authenticated, public;
revoke all on public.asifa_review_marks    from anon, authenticated, public;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('asifa-review', 'asifa-review', true, 8388608, array['image/jpeg'])
  on conflict (id) do nothing;

-- קריאת מצב. מפתח לא תקין = null.
create or replace function public.asifa_review_state(p_key text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare s public.asifa_review_sessions;
begin
  if p_key is null or length(p_key) <> 64 then return null; end if;
  select * into s from public.asifa_review_sessions where key = p_key;
  if not found then return null; end if;
  return jsonb_build_object(
    'title', s.title, 'folder', s.folder, 'sheet', s.sheet, 'done_at', s.done_at,
    'nums', (select coalesce(jsonb_agg((i->>'num')::int order by (i->>'num')::int), '[]'::jsonb) from jsonb_array_elements(s.items) i),
    'marks', (select coalesce(jsonb_object_agg(m.num::text, jsonb_build_object('remove', m.remove, 'note', m.note)), '{}'::jsonb)
              from public.asifa_review_marks m
              where m.session_key = s.key and (m.remove or m.note <> '')
                and exists (select 1 from jsonb_array_elements(s.items) i where (i->>'num')::int = m.num)));
end $$;

-- סימון תמונה אחת. מחזיר true רק אם נשמר.
create or replace function public.asifa_review_mark(p_key text, p_num int, p_remove boolean, p_note text default '') returns boolean
  language plpgsql security definer set search_path = public as
$$
declare s public.asifa_review_sessions;
begin
  if p_key is null or length(p_key) <> 64 or p_num is null then return false; end if;
  select * into s from public.asifa_review_sessions where key = p_key;
  if not found then return false; end if;
  if not exists (select 1 from jsonb_array_elements(s.items) i where (i->>'num')::int = p_num) then return false; end if;
  insert into public.asifa_review_marks(session_key, num, remove, note, updated_at)
    values (p_key, p_num, coalesce(p_remove, false), left(coalesce(p_note, ''), 500), now())
    on conflict (session_key, num) do update
      set remove = excluded.remove, note = excluded.note, updated_at = now();
  return true;
end $$;

-- "סיימתי" / ביטול. מחזיר true אם נשמר.
create or replace function public.asifa_review_done(p_key text, p_done boolean default true) returns boolean
  language plpgsql security definer set search_path = public as
$$
begin
  if p_key is null or length(p_key) <> 64 then return false; end if;
  update public.asifa_review_sessions set done_at = case when coalesce(p_done, true) then now() else null end where key = p_key;
  return found;
end $$;

revoke all on function public.asifa_review_state(text) from public;
revoke all on function public.asifa_review_mark(text,int,boolean,text) from public;
revoke all on function public.asifa_review_done(text,boolean) from public;
grant execute on function public.asifa_review_state(text) to anon, authenticated;
grant execute on function public.asifa_review_mark(text,int,boolean,text) to anon, authenticated;
grant execute on function public.asifa_review_done(text,boolean) to anon, authenticated;
