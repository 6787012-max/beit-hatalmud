-- migration_asifa_staff.sql — צפייה של אנשי צוות בהורים שקבעו איתם (15/11/2026)
-- תוספת בלבד: טבלת מפתחות אישיים + פונקציית קריאה אחת. לא נוגע בטבלאות/פוליסי קיימים.
-- הטבלה: RLS פעיל ובלי פוליסי = אף אחד (גם anon) לא קורא ישירות. גישה רק דרך asifa_staff_view(מפתח).
-- אידמפוטנטי.

create table if not exists public.asifa_staff_keys (
  key         text primary key default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  meeting_id  bigint not null references public.asifa_meetings(id) on delete cascade,
  rav         text not null,
  created_at  timestamptz not null default now(),
  constraint asifa_staff_keys_uq unique (meeting_id, rav)
);
alter table public.asifa_staff_keys enable row level security;
revoke all on public.asifa_staff_keys from anon, authenticated, public;

-- קריאה בלבד. מפתח לא תקין = null (בלי שום נתון).
create or replace function public.asifa_staff_view(p_key text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare k public.asifa_staff_keys; m public.asifa_meetings;
begin
  if p_key is null or length(p_key) < 32 then return null; end if;
  select * into k from public.asifa_staff_keys where key = p_key;
  if not found then return null; end if;
  select * into m from public.asifa_meetings where id = k.meeting_id;
  return jsonb_build_object(
    'title', m.title, 'date', m.date, 'slot_minutes', m.slot_minutes, 'me', k.rav,
    'rabbis', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', r->>'name', 'start', r->>'start', 'end', r->>'end',
        'bookings', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'time', b.slot_time,
            'student', public.asifa_full_name(s.name, s.family),
            'class_name', split_part(coalesce(c.name, ''), ' - ', 1),
            'parent_name', b.parent_name,
            'phone', coalesce(nullif(b.parent_phone, ''), nullif(s.parent_phone, ''), nullif(s.mother_phone, ''))
          ) order by b.slot_time), '[]'::jsonb)
          from public.asifa_bookings b
          join public.students s on s.id = b.student_id
          left join public.classes c on c.id = s.class_id
          where b.meeting_id = m.id and b.rav = r->>'name')
      ) order by (r->>'name' <> k.rav), r->>'name'), '[]'::jsonb)
      from jsonb_array_elements(m.rabbis) r));
end $$;

revoke all on function public.asifa_staff_view(text) from public;
grant execute on function public.asifa_staff_view(text) to anon, authenticated;

-- מפתח אישי לכל רב באסיפה הקיימת (מוסיף רק מי שחסר)
insert into public.asifa_staff_keys(meeting_id, rav)
  select m.id, r->>'name' from public.asifa_meetings m, jsonb_array_elements(m.rabbis) r
  where m.is_test = false
  on conflict (meeting_id, rav) do nothing;
