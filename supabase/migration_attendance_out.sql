-- migration_attendance_out.sql — נוכחות: סטטוס "יצא" + פרטי איחור/יציאה (2026-08-25)
--
-- קודם הסטטוס היה present/late/absent בלבד, בלי שום פירוט: "איחר" לא אמר
-- באיזו שעה הגיע, ולא היה בכלל מצב לתלמיד שיצא באמצע היום וחזר.
--   • status='left'  — יצא באמצע (נוסף; אין CHECK על העמודה, ולכן די בקוד).
--   • at_time        — שעת ההגעה (באיחור) או שעת היציאה.
--   • minutes        — כמה דקות (איחור / משך היציאה).
alter table public.attendance add column if not exists at_time time;
alter table public.attendance add column if not exists minutes  integer;

comment on column public.attendance.at_time is 'שעת הגעה (late) או שעת יציאה (left)';
comment on column public.attendance.minutes is 'דקות איחור (late) או משך היציאה בדקות (left)';
