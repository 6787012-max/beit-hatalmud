-- migration_ai_usage_cap.sql — מכסה יומית/חודשית קשיחה על שיחות Gemini (2026-09-04, בקשת יוסף)
--
-- הרקע: יוסף דיווח על חיוב בפועל של מאות שקלים דרך מפתח ה-Gemini המשותף.
-- supabase/functions/ai/index.ts (הפרוקסי היחיד שכל פיצ'רי ה-AI באפליקציה
-- עוברים דרכו — טקסט לשמע בפאנל הקו/דיוור, ai-help, ai-insights,
-- voicereports, tla-autofill) לא הגביל שום דבר עד עכשיו: כל משתמש מחובר
-- יכול היה לקרוא לו כמה פעמים שרוצה, בלי שום תקרה.
--
-- הפתרון: מונה יומי אטומי בטבלה, שהפונקציה בודקת *לפני* כל קריאה בפועל
-- ל-Gemini ומסרבת (429) ברגע שעברו את התקרה — במקום להמשיך לחייב בשקט.
-- זו רשת ביטחון פיננסית, לא איתור הסיבה המקורית לחיוב שכבר קרה (את זה
-- אפשר לראות רק בדשבורד החיוב של גוגל/AI Studio — אין לי גישה אליו).
--
-- מספרים שמרניים בכוונה (ניתן להקל דרך UPDATE ישיר על הפונקציה בהמשך אם
-- מתברר שהם חוסמים שימוש לגיטימי):
--   200 קריאות ליום, 3000 לחודש.
--
-- אידמפוטנטי.

create table if not exists public.ai_usage_daily (
  day   date primary key,
  calls integer not null default 0
);
alter table public.ai_usage_daily enable row level security;
-- אין לאף אחד גישה ישירה — רק ai_usage_bump (security definer) נוגעת בטבלה.
drop policy if exists ai_usage_none on public.ai_usage_daily;
create policy ai_usage_none on public.ai_usage_daily for all using (false) with check (false);

-- מגדיל אטומית את מונה היום (ויוצר את השורה בפעם הראשונה), ומחזיר את
-- הספירה החדשה + את סכום 30 הימים האחרונים (למכסה החודשית) יחד.
create or replace function public.ai_usage_bump(p_day date)
  returns table(day_calls integer, month_calls integer)
  language plpgsql security definer set search_path = public as
$$
declare v_day integer; v_month integer;
begin
  insert into public.ai_usage_daily(day, calls) values (p_day, 1)
    on conflict (day) do update set calls = ai_usage_daily.calls + 1
    returning calls into v_day;
  select coalesce(sum(calls), 0) into v_month
    from public.ai_usage_daily
    where day > p_day - interval '30 days' and day <= p_day;
  return query select v_day, v_month;
end;
$$;

revoke all on function public.ai_usage_bump(date) from public, anon;
grant execute on function public.ai_usage_bump(date) to service_role;
