-- migration_voice_phone.sql — דיווח קולי מקו הטלפון (2026-08-23)
-- הטבלה voice_reports כבר קיימת (הקלטה מהדפדפן). כאן מוסיפים את מה
-- שנדרש כשהמקור הוא שיחת טלפון ולא הקלטה במסך.
alter table public.voice_reports
  add column if not exists source      text default 'מערכת',   -- מערכת / קו טלפון
  add column if not exists heard_name  text,                    -- שם התלמיד כפי שנשמע בהקלטה
  add column if not exists confidence  numeric;                 -- ביטחון הזיהוי 0..1

-- audio_name הוא שם קובץ ההקלטה בימות; הוא גם המפתח שמונע עיבוד כפול
-- כשה-Worker רץ שוב על אותה תיקייה.
create unique index if not exists voice_reports_audio_name_uidx
  on public.voice_reports(audio_name) where audio_name is not null;
