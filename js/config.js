window.CV3={INSTANCE:'beit-hatalmud',INSTANCE_NAME:'מכינה בית התלמוד',SUPABASE_URL:'https://jpcepdbhouuwpjdidqfo.supabase.co',SUPABASE_ANON_KEY:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwY2VwZGJob3V1d3BqZGlkcWZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTY1NDIsImV4cCI6MjEwMjAzMjU0Mn0.SR1cwgyI6eDv5aXqPkL4Nu0UINuvaWIh4jtElO44LS0'};
window.CV3.DEMO=!window.CV3.SUPABASE_URL||!window.CV3.SUPABASE_ANON_KEY;
// כתובת ה-Web App של Apps Script (חשבון המכינה) — לשליחת מיילים מהפאנל.
// אינדוקס מייל/דרייב לכרטיס תלמיד כבר עובד ברקע (Apps Script פותר ל-Supabase).
// כתובת ה-web app מתעדכנת בכל deploy — לעדכן פה.
window.CV3.GAS_URL='https://script.google.com/macros/s/AKfycbzUwbrUA-NkklgRolmYdmT2uznAJIuj4mtLvWJ_KhCgetSD5iB-2QysdkZDaUon9Lmp/exec';
// כתובת חיוג הורים (call-parent) — Supabase Edge Function, לא Cloudflare Worker:
// נטפרי חוסם *.workers.dev מהדפדפן (HTTP 418, נבדק בפועל גם על worker-tts
// הקיים — הוא עובד רק כי ימות המשיח, שרת חיצוני, קורא לו, לא הדפדפן). קוד
// ה-Worker המקורי (worker-call/) נשאר בדיסק כתיעוד, לא בשימוש. לעדכן כאן רק
// אם שם הפונקציה/הפרויקט משתנה.
window.CV3.CALL_WORKER_URL='https://jpcepdbhouuwpjdidqfo.supabase.co/functions/v1/call-parent';
