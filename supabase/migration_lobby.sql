-- migration_lobby.sql — מסך הלובי (בית התלמוד)
-- טבלה אחת של הגדרות, מפתח→JSON. הפאנל באתר כותב, מסך הלובי (קיוסק ללא התחברות) קורא.
--
-- ⚠️ קריאה מותרת ל-anon בכוונה: מסך הלובי תלוי על הקיר ואין לו משתמש.
--    לכן מותר לשמור כאן אך ורק תוכן ציבורי — סדר יום, תפריט מטבח, הודעות כלליות.
--    אין לשמור כאן שמות תלמידים, טלפונים או כל מידע אישי.

create table if not exists public.lobby_config (
  key        text primary key,                      -- schedule | menu | messages | display
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by uuid default auth.uid()
);

alter table public.lobby_config enable row level security;

drop policy if exists lobby_read  on public.lobby_config;
drop policy if exists lobby_admin on public.lobby_config;

-- קריאה: כולם (כולל מסך הקיר הלא-מזוהה)
create policy lobby_read on public.lobby_config
  for select to anon, authenticated using (true);

-- כתיבה: מנהל בלבד
create policy lobby_admin on public.lobby_config
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.lobby_config to anon;
grant select, insert, update, delete on public.lobby_config to authenticated;

-- ── דיווח־עצמי של מסך הלובי ──────────────────────────────────────────────
-- המסך שתלוי בקיר אינו מזוהה, ובכל זאת צריך לספר לפאנל אילו תת־תיקיות סרטונים
-- קיימות במחשב ומתי הוא היה פעיל. לכן — ורק לשורה הזאת — מותרת גם כתיבה אנונימית.
-- הסיכון מכוון ומוגבל: התוכן הוא רשימת שמות תיקיות וחותמת זמן, אין בו מידע אישי,
-- ואף החלטת הרשאה במערכת לא נסמכת עליו. insert/delete אסורים, רק update לשורה קיימת.
insert into public.lobby_config(key, value) values ('runtime', '{}'::jsonb)
  on conflict (key) do nothing;

drop policy if exists lobby_runtime_write on public.lobby_config;
create policy lobby_runtime_write on public.lobby_config
  for update to anon
  using (key = 'runtime') with check (key = 'runtime');

grant update on public.lobby_config to anon;
