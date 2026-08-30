-- migration_weekly_reports.sql — סיכום שבועי לר"מ (2026-08-30, בקשת צבי וינברג)
--
-- "אני רוצה לעשות סיכום שבועי לכל ר"מ בכל תחום מבחינת למידה ופעילות — מה עשו
--  בשבוע האחרון, מה הספיקו וכו', שזה יהיה בתוכנה."
--
-- המבנה: שורה אחת = ר"מ אחד × שיעור אחד × שבוע אחד. תחומי הלימוד יושבים
-- ב-`items` כ-jsonb ולא כטבלה נפרדת, כי מספר התחומים ושמותיהם משתנים בין
-- ר"מ לר"מ ובין שבוע לשבוע — טבלה נורמלית היתה מחייבת ניהול רשימת תחומים
-- קשיחה שאיש לא יתחזק.
--   items = [{subject, learned, progress, rating}]
--     subject  — התחום (גמרא / הלכה / מוסר …)
--     learned  — מה נלמד השבוע
--     progress — היכן אוחזים / מה הספיקו
--     rating   — 'מעולה' | 'טוב' | 'חלקי' | 'פיגור'
--
-- `week_start` = **יום ראשון** של השבוע, תמיד. הלקוח מנרמל לפני שמירה, כדי
-- ששני ר"מים שפתחו את המסך בימים שונים ייפלו על אותה שורה בדוח המרכז.
--
-- אידמפוטנטי.

create table if not exists public.weekly_reports (
  id          bigint generated always as identity primary key,
  class_id    bigint not null references public.classes(id) on delete cascade,
  week_start  date   not null,
  items       jsonb  not null default '[]'::jsonb,
  activities  text,            -- פעילויות, טיולים, אירועים
  notes       text,            -- הערות והצרכים להנהלה
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ר"מ אחד ממלא סיכום אחד לשיעור לשבוע. שני ר"מים באותו שיעור — שתי שורות
-- נפרדות, וזה בכוונה: הבקשה היא סיכום **לכל ר"מ**, לא סיכום אחד לשיעור.
create unique index if not exists weekly_reports_uniq
  on public.weekly_reports (class_id, week_start, created_by);
create index if not exists weekly_reports_week on public.weekly_reports (week_start);

alter table public.weekly_reports enable row level security;

-- קריאה: הנהלה רואה הכל; ר"מ רואה את שלו ואת השיעורים שהוקצו לו.
drop policy if exists wk_read on public.weekly_reports;
create policy wk_read on public.weekly_reports for select using (
  public.is_admin()
  or public.my_role() in ('מפקח', 'מזכירה')
  or created_by = auth.uid()
  or public.has_class_access(class_id)
);

-- כתיבה: רק על שיעור שיש לך גישה אליו, ורק בשמך.
drop policy if exists wk_ins on public.weekly_reports;
create policy wk_ins on public.weekly_reports for insert with check (
  public.is_staff() and public.has_class_access(class_id)
  and (created_by is null or created_by = auth.uid())
);

-- תיקון ומחיקה — הבעלים או המנהל. ר"מ לא נוגע בסיכום של חברו.
drop policy if exists wk_upd on public.weekly_reports;
create policy wk_upd on public.weekly_reports for update
  using      (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());
drop policy if exists wk_del on public.weekly_reports;
create policy wk_del on public.weekly_reports for delete
  using (public.is_admin() or created_by = auth.uid());

-- updated_at אמיתי: בלעדיו "עודכן לאחרונה" בדוח המרכז היה מציג את מועד
-- היצירה לנצח, ומנהל לא יכול היה לדעת אם הר"מ חזר ותיקן.
create or replace function public.weekly_touch() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists weekly_touch_t on public.weekly_reports;
create trigger weekly_touch_t before update on public.weekly_reports
  for each row execute function public.weekly_touch();

-- ── תחומי הלימוד ───────────────────────────────────────────────────────
-- `subjects` קיימת בסכימה מהיום הראשון אך נשארה **ריקה**, ולכן שום מסך לא
-- השתמש בה. כאן היא מקבלת תוכן ומשמשת כרשימת ההשלמה של הטופס. הר"מ יכול
-- להקליד גם תחום שאינו ברשימה — הרשימה היא הצעה, לא כלוב.
insert into public.subjects (name)
select v from (values ('גמרא'), ('משנה'), ('הלכה'), ('חומש ורש"י'), ('נביא'),
                      ('מוסר'), ('אמונה ומחשבה'), ('תפילה'), ('כישורי חיים'),
                      ('חברותא'), ('מבחנים וחזרות')) as t(v)
where not exists (select 1 from public.subjects s where s.name = t.v);

-- ── ספריית הצוות ───────────────────────────────────────────────────────
-- `prof_self_read` מתיר קריאת `profiles` **רק למנהל** (ולכל אחד את שורתו),
-- ולכן `Author.load()` החזיר מפה ריקה לכל מי שאינו מנהל — ובכל המערכת
-- הוצג "לא ידוע" במקום "מי רשם". גם ריכוז ההנהלה כאן היה יוצא ריק למפקח.
--
-- ⚠️ **אסור פשוט להרחיב את `prof_self_read`**: `profiles.tz` הוא מספר
-- הטלפון, שהוא גם שם המשתמש לכניסה — וסיסמת ברירת המחדל היא אותו מספר.
-- חשיפת השורה המלאה לכל הצוות = רשימת פרטי כניסה של כל החברים.
-- לכן פונקציה שמחזירה **שם ותפקיד בלבד**, בלי tz ובלי email.
create or replace function public.staff_directory()
  returns table (id uuid, name text, role text)
  language sql stable security definer set search_path = public as
$$ select p.id, p.name, p.role
     from public.profiles p
    where p.active and public.is_staff() $$;

revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;
