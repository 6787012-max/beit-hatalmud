// supabase/functions/ai/index.ts
// פרוקסי בין האתר לבין Gemini API.
//
// למה בכלל: חלק מהמשתמשים (נעמי, 1.9.2026) מאחורי סינון שחוסם את
// generativelanguage.googleapis.com מהדפדפן, ואז כל פיצ'רי ה-AI נופלים עם
// "אין תקשורת עם שירות הניתוח". Supabase כן מאושר אצל כולם (בלעדיו אין
// התחברות בכלל), ולכן הקריאה עוברת דרך כאן.
//
// אבטחה: רק משתמש מחובר — ה-JWT נבדק מול Supabase לפני כל העברה. המפתח
// שמור כסוד צד-שרת (Supabase secret GEMINI_KEY) ואינו נחשף ללקוח כלל.
// מפתח מהלקוח מתקבל רק כגיבוי, אם מנהל הזין מפתח משלו ידנית.
// ה-body מועבר כמו שהוא ל-generateContent של המודל המבוקש, ותו לא.
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_MODELS = /^gemini-[\w.-]+$/;

// מכסה קשיחה — יוסף כבר חויב בפועל מאות שקלים על שימוש לא-מוגבל בפרוקסי
// הזה (2026-09-04). שמרני בכוונה; להקל רק במכוון אם מתברר שזה חוסם שימוש
// לגיטימי. ראה migration_ai_usage_cap.sql.
const DAILY_CAP = 200;
const MONTHLY_CAP = 3000;

// בודק+מגדיל אטומית את מונה השימוש. בכשל בבדיקה עצמה (לא בגלל המכסה) —
// מעדיפים לתת לקריאה לעבור על פני לחסום שימוש לגיטימי בגלל תקלה בספירה.
async function checkUsageCap(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await fetch(SB_URL + '/rest/v1/rpc/ai_usage_bump', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE },
      body: JSON.stringify({ p_day: today }),
    });
    if (!r.ok) return { ok: true };
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { ok: true };
    if (row.day_calls > DAILY_CAP) return { ok: false, reason: 'מכסת ה-AI היומית (' + DAILY_CAP + ') נוצלה — נסו שוב מחר' };
    if (row.month_calls > MONTHLY_CAP) return { ok: false, reason: 'מכסת ה-AI החודשית (' + MONTHLY_CAP + ') נוצלה — פנו למנהל המערכת' };
    return { ok: true };
  } catch { return { ok: true }; }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (msg: string, status = 400) => json({ error: { message: msg } }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('POST בלבד', 405);

  // אימות משתמש: ה-JWT חייב להשתייך למשתמש אמיתי במערכת
  const auth = req.headers.get('Authorization') || '';
  const u = await fetch(SB_URL + '/auth/v1/user', {
    headers: { Authorization: auth, apikey: SB_ANON },
  });
  if (!u.ok) return fail('לא מחובר', 401);

  // מכסה — נבדק לפני כל קריאה בפועל ל-Gemini, לא אחריה.
  const usage = await checkUsageCap();
  if (!usage.ok) return fail(usage.reason || 'מכסת שימוש', 429);

  let payload: { model?: string; key?: string; body?: unknown };
  try { payload = await req.json(); } catch { return fail('גוף בקשה לא תקין'); }
  const model = String(payload.model || 'gemini-2.5-flash');
  if (!ALLOWED_MODELS.test(model)) return fail('מודל לא מורשה');
  // המפתח מגיע מצד-שרת (Supabase secret GEMINI_KEY) ואינו נחשף ללקוח.
  // מפתח מהלקוח מתקבל רק כגיבוי אם המשתמש הזין מפתח משלו ידנית.
  const key = String(payload.key || '') || (Deno.env.get('GEMINI_KEY') || '');
  // מפתחות Google: פורמט ישן AIza… או חדש AQ.… (גוגל החלה במעבר ב-2025)
  if (!/^(AIza[\w-]{20,}|AQ\.[\w-]{20,})$/.test(key)) return fail('מפתח AI לא מוגדר בשרת', 500);
  if (!payload.body || typeof payload.body !== 'object') return fail('חסר body');

  // המפתח נשלח ב-header x-goog-api-key (לא ב-URL) — נקי יותר ותומך בשני הפורמטים
  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload.body) },
  );
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
