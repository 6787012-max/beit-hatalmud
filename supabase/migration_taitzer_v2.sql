-- migration_taitzer_v2.sql — היסטוריית שבועות + "טעינה נוספת" חד-פעמית.
-- המשך migration_taitzer.sql, בעקבות בקשת יוסף (09/09/2026, המשך אותו יום):
-- לראות/לבחור שבועות קודמים (לא רק "מצב נוכחי"), ואפשרות להוסיף טעינה
-- חד-פעמית שנכנסת אוטומטית בטעינה הבאה. הרץ ב-Supabase SQL Editor אחרי
-- migration_taitzer.sql. בטוח להרצה חוזרת.

-- ── היסטוריה: taitzer_weekly היה "מצב נוכחי בלבד" (unique על tz בלבד) —
-- עובר ל-unique(tz, week_no) כדי שכל שבוע יישמר בנפרד, לא יידרס. ──
alter table public.taitzer_weekly add column if not exists week_no integer;
update public.taitzer_weekly set week_no = 3 where week_no is null;  -- שבוע נוכחי בזמן הריצה
alter table public.taitzer_weekly alter column week_no set not null;

-- מוריד כל unique constraint ישן שהיה על tz בלבד (שם ברירת-המחדל
-- taitzer_weekly_tz_key, אך לא מניח את השם — מחפש לפי מבנה בפועל).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.taitzer_weekly'::regclass and contype = 'u'
      and array_length(conkey, 1) = 1
      and conkey[1] = (select attnum from pg_attribute
                        where attrelid = 'public.taitzer_weekly'::regclass and attname = 'tz')
  loop
    execute format('alter table public.taitzer_weekly drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.taitzer_weekly drop constraint if exists taitzer_weekly_tz_week_no_key;
alter table public.taitzer_weekly add constraint taitzer_weekly_tz_week_no_key unique (tz, week_no);

create index if not exists idx_taitzer_weekly_week on public.taitzer_weekly(week_no);

-- ── טעינה נוספת חד-פעמית לכרטיס (בונוס/החזר וכו') — מצטברת עד שנכנסת
-- אוטומטית לסכום המחושב בשבוע הבא, ואז מתאפסת. ──
alter table public.taitzer_cards add column if not exists extra_pending numeric not null default 0;
