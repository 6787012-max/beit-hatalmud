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

const ALLOWED_MODELS = /^gemini-[\w.-]+$/;

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

  let payload: { model?: string; key?: string; body?: unknown };
  try { payload = await req.json(); } catch { return fail('גוף בקשה לא תקין'); }
  const model = String(payload.model || 'gemini-2.5-flash');
  if (!ALLOWED_MODELS.test(model)) return fail('מודל לא מורשה');
  // המפתח מגיע מצד-שרת (Supabase secret GEMINI_KEY) ואינו נחשף ללקוח.
  // מפתח מהלקוח מתקבל רק כגיבוי אם המשתמש הזין מפתח משלו ידנית.
  const key = String(payload.key || '') || (Deno.env.get('GEMINI_KEY') || '');
  if (!/^AIza[\w-]{20,}$/.test(key)) return fail('מפתח AI לא מוגדר בשרת', 500);
  if (!payload.body || typeof payload.body !== 'object') return fail('חסר body');

  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + model +
    ':generateContent?key=' + encodeURIComponent(key),
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.body) },
  );
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
