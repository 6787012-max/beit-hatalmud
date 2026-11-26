-- migration_writing_tracking.sql — מעקב כתיבה (2026-11-26, בקשת הרב יודלוב)
--
-- מרחיב את הטבלה הקיימת `writing` (היתה ריקה: level + note) ולא בונה מקבילה.
-- דפוס זהה למעקב קריאה: טבלת מדדים הניתנת לעריכה (writing_metrics, כמו
-- reading_categories) + רשומת דיווח לתלמיד (writing, כמו reading_assessments).
--
--   writing.vals  = jsonb {מזהה_מדד: מפתח_ערך}  (מדד מרובה-ערכים: מערך מפתחות)
--   writing.level = סיכום טקסט קצר (נשאר, כדי שכרטיס התלמיד וציר הפעילות ימשיכו לעבוד)
--   writing_metrics.options = [{k, t, tone}]  tone: good / mid / bad / בלי = תיאורי
--
-- הרשאות: זהות לדפוס של reading_assessments (rasm_*) / reading_categories (rcat_*).
-- בטוח להרצה חוזרת.

alter table public.writing add column if not exists vals jsonb not null default '{}'::jsonb;

-- ה-policy הישן wrt_all (ALL) איפשר לכל מי שרואה את התלמיד לעדכן ולמחוק
-- רישום של אחר. מפרקים לארבע policies כמו ב-reading_assessments.
drop policy if exists wrt_all on public.writing;
drop policy if exists wrt_read on public.writing;
create policy wrt_read on public.writing for select to authenticated
  using (is_admin() or created_by = auth.uid() or can_read_student(student_id));
drop policy if exists wrt_ins on public.writing;
create policy wrt_ins on public.writing for insert to authenticated
  with check (is_staff() and can_read_student(student_id));
drop policy if exists wrt_upd on public.writing;
create policy wrt_upd on public.writing for update to authenticated
  using (is_admin() or created_by = auth.uid()) with check (is_admin() or created_by = auth.uid());
drop policy if exists wrt_del on public.writing;
create policy wrt_del on public.writing for delete to authenticated
  using (is_admin() or created_by = auth.uid());

create table if not exists public.writing_metrics (
  id bigserial primary key,
  name text not null,
  kind text not null default 'single' check (kind in ('single', 'multi')),
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.writing_metrics enable row level security;
drop policy if exists wmet_read on public.writing_metrics;
create policy wmet_read on public.writing_metrics for select to authenticated using (is_staff());
drop policy if exists wmet_admin on public.writing_metrics;
create policy wmet_admin on public.writing_metrics for all to authenticated using (is_admin()) with check (is_admin());

-- ברירת מחדל ראשונית (הרב יודלוב ישלח רשימה מלאה; המנהל עורך במסך "מדדים")
insert into public.writing_metrics (name, kind, options, sort_order)
select * from (values
  ('מה נבדק', 'single', '[{"k": "o1", "t": "סיכום גמרא"}, {"k": "o2", "t": "מחברת לימוד"}, {"k": "o3", "t": "העתקה מהלוח"}, {"k": "o4", "t": "הכתבה"}, {"k": "o5", "t": "כתיבה חופשית"}]'::jsonb, 1),
  ('סוג הכתב', 'single', '[{"k": "o1", "t": "כתב יד רציף"}, {"k": "o2", "t": "כתב דפוס"}, {"k": "o3", "t": "כתב רש\"י"}, {"k": "o4", "t": "מעורב"}]'::jsonb, 2),
  ('לחץ הכתיבה', 'single', '[{"k": "o1", "t": "חלש", "tone": "mid"}, {"k": "o2", "t": "תקין", "tone": "good"}, {"k": "o3", "t": "חזק", "tone": "mid"}, {"k": "o4", "t": "משתנה", "tone": "bad"}]'::jsonb, 3),
  ('אחיזת העט', 'single', '[{"k": "o1", "t": "תקינה ויציבה", "tone": "good"}, {"k": "o2", "t": "מהודקת מדי", "tone": "mid"}, {"k": "o3", "t": "רפויה", "tone": "mid"}, {"k": "o4", "t": "חריגה", "tone": "bad"}]'::jsonb, 4),
  ('צורת האותיות', 'single', '[{"k": "o1", "t": "ברורה ותקינה", "tone": "good"}, {"k": "o2", "t": "חלקית", "tone": "mid"}, {"k": "o3", "t": "מעוותת", "tone": "bad"}]'::jsonb, 5),
  ('בלבולי אותיות', 'multi', '[{"k": "o1", "t": "ד / ר"}, {"k": "o2", "t": "ו / ז / ן"}, {"k": "o3", "t": "ב / כ"}, {"k": "o4", "t": "ה / ח / ת"}, {"k": "o5", "t": "ס / ם"}, {"k": "o6", "t": "ע / צ"}, {"k": "o7", "t": "ג / נ"}, {"k": "o8", "t": "סופיות"}]'::jsonb, 6),
  ('גודל האותיות', 'single', '[{"k": "o1", "t": "קטן מדי", "tone": "mid"}, {"k": "o2", "t": "מתאים", "tone": "good"}, {"k": "o3", "t": "גדול מדי", "tone": "mid"}, {"k": "o4", "t": "משתנה", "tone": "bad"}]'::jsonb, 7),
  ('עקביות', 'single', '[{"k": "o1", "t": "עקבית", "tone": "good"}, {"k": "o2", "t": "בינונית", "tone": "mid"}, {"k": "o3", "t": "לא עקבית", "tone": "bad"}]'::jsonb, 8),
  ('רווחים בין אותיות ומילים', 'single', '[{"k": "o1", "t": "תקינים", "tone": "good"}, {"k": "o2", "t": "צפופים", "tone": "mid"}, {"k": "o3", "t": "רחבים מדי", "tone": "mid"}, {"k": "o4", "t": "לא אחידים", "tone": "bad"}]'::jsonb, 9),
  ('שמירה על השורה', 'single', '[{"k": "o1", "t": "על השורה", "tone": "good"}, {"k": "o2", "t": "יורד", "tone": "mid"}, {"k": "o3", "t": "עולה", "tone": "mid"}, {"k": "o4", "t": "מתנדנד", "tone": "bad"}]'::jsonb, 10),
  ('נטייה ויציבות', 'single', '[{"k": "o1", "t": "ישרה ויציבה", "tone": "good"}, {"k": "o2", "t": "נטייה קלה", "tone": "mid"}, {"k": "o3", "t": "נטייה חזקה", "tone": "mid"}, {"k": "o4", "t": "לא יציבה", "tone": "bad"}]'::jsonb, 11),
  ('קריאוּת', 'single', '[{"k": "o1", "t": "ברורה", "tone": "good"}, {"k": "o2", "t": "קריאה בקושי", "tone": "mid"}, {"k": "o3", "t": "לא קריאה", "tone": "bad"}]'::jsonb, 12),
  ('מהירות', 'single', '[{"k": "o1", "t": "איטית מאוד", "tone": "bad"}, {"k": "o2", "t": "איטית", "tone": "mid"}, {"k": "o3", "t": "מתאימה", "tone": "good"}, {"k": "o4", "t": "מהירה מדי", "tone": "mid"}]'::jsonb, 13),
  ('סדר וארגון הדף', 'single', '[{"k": "o1", "t": "מסודר", "tone": "good"}, {"k": "o2", "t": "חלקית", "tone": "mid"}, {"k": "o3", "t": "לא מסודר", "tone": "bad"}]'::jsonb, 14),
  ('התמדה ועייפות', 'single', '[{"k": "o1", "t": "מתמיד", "tone": "good"}, {"k": "o2", "t": "מתעייף בהדרגה", "tone": "mid"}, {"k": "o3", "t": "מתעייף מהר", "tone": "bad"}]'::jsonb, 15)
) v(name, kind, options, sort_order)
where not exists (select 1 from public.writing_metrics);
