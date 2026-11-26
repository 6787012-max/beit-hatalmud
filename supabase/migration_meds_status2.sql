-- 2026-11-26: סטטוס רביעי בלשונית "כדורים" לבקשת יוסף: "אמור לקחת ועדיין לא".
alter table public.student_med_status drop constraint if exists student_med_status_status_check;
alter table public.student_med_status add constraint student_med_status_status_check
  check (status in ('לוקח', 'לא לוקח', 'לבדוק', 'אמור לקחת ועדיין לא'));
