-- migration_student_photos.sql — תמונת תלמיד בכרטיס (2026-08-25, בקשת יוסף)
--
-- המקור: התמונות שצולמו לחוברות הדרכון (`C:\projects\darkon-hatzlacha\photos`),
-- PNG שקוף 900×1200 אחרי הסרת רקע ירוק.
--
-- **למה טבלה נפרדת ולא עמודה ב-students:** כמעט כל מסך במערכת שואב את
-- `students` (נוכחות, מעקב, בוררי תלמיד, יצוא), ותמונה בשורה היתה מוסיפה
-- ~30KB לכל תלמיד לכל טעינה של כל מסך. כאן המסך מושך את מה שהוא צריך בלבד.
--
-- **למה base64 במסד ולא Storage/דרייב:** (א) הריפו ציבורי — תמונות תלמידים
-- לא נכנסות אליו; (ב) נטפרי חוסם גוף תגובה בינארי (זה כבר הכריח את ה-Edge
-- Function להחזיר base64), ולכן קישור ישיר לקובץ תמונה אינו אמין; (ג) טקסט
-- ב-REST עובר, וה-RLS הקיים על תלמידים חל עליו כמו על כל שדה אחר.
--
-- שתי רזולוציות בכוונה:
--   thumb  — ~96px, לעיגול ברשימות. 36 תלמידים ≈ 100KB לכל הרשימה.
--   photo  — ~480px, לכרטיס התלמיד. נמשך רק כשפותחים כרטיס אחד.
--
-- אידמפוטנטי.

create table if not exists public.student_photos (
  student_id bigint primary key references public.students(id) on delete cascade,
  mime       text not null default 'image/jpeg',
  thumb      text,          -- base64 (בלי הקידומת data:)
  photo      text,          -- base64
  source     text,          -- מאיפה הגיעה, לתיעוד
  updated_at timestamptz not null default now()
);

alter table public.student_photos enable row level security;

-- קריאה: מי שרשאי לראות את התלמיד. כתיבה: מי שרשאי לערוך אותו (כמו students).
drop policy if exists sph_read on public.student_photos;
create policy sph_read on public.student_photos for select
  using (public.can_read_student(student_id));

drop policy if exists sph_write on public.student_photos;
create policy sph_write on public.student_photos for all
  using (public.can_see_student(student_id))
  with check (public.can_see_student(student_id));

grant select, insert, update, delete on public.student_photos to authenticated;
