// supabase/functions/call-parent/index.ts
// כפתור "חייג" (כרטיס תלמיד + פאנל חיוג מהיר, בית התלמוד) → שיחת PBX
// (Adel Telecom) ליעד שביקשו.
//
// למה Supabase Edge Function ולא Cloudflare Worker: נבדק בפועל שנטפרי חוסם
// *.workers.dev מהדפדפן (HTTP 418, "unknown") — כולל את worker-tts הקיים,
// שעובד רק כי ימות המשיח (שרת חיצוני) קורא לו, לא הדפדפן. כפתור בדפדפן חייב
// לעבור דרך משהו שנטפרי כבר מאשר — Supabase כן מאושר (בלעדיו אין התחברות
// לאתר בכלל). אותה תבנית בדיוק כבר קיימת ועובדת ב-cheder-maale-amos
// (supabase/functions/ai). קוד ה-Worker המקורי (worker-call/) נשאר בדיסק
// כתיעוד/גיבוי, לא בשימוש בפועל — לא נמחק (מדיניות: העברה על פני מחיקה).
//
// זהו שער ההרשאה האמיתי של הפיצ'ר — לא הכפתור בדפדפן (js/call.js), שהוא UX
// בלבד וכל אחד יכול לעקוף אותו מ-devtools. לפני שנוגעים בכלל ב-API של ה-PBX:
//   1) שולפים 'Authorization: Bearer <token>' מהבקשה.
//   2) מאמתים את הטוקן מול Supabase עצמו (GET /auth/v1/user) — לא סומכים על
//      שום דבר שהלקוח טוען על זהותו, מקבלים בחזרה את ה-id האמיתי של המשתמש.
//   3) שולפים role/active מ-public.profiles עם מפתח service-role (עוקף RLS
//      לגמרי, לא תלוי בכך ש-policies.sql יישאר מוגדר נכון) ומאשרים רק
//      role==='מנהל' && active!==false.
//   4) רק אחרי זה — מנרמלים ומוודאים את מספר היעד בצד-שרת.
//   5) בונים את כתובת ה-PBX ומחייגים.
//
// ⚠️ תיקון הבנה מהותי (10/09/2026, אומת חי עם יוסף מול ה-API האמיתי):
// בהתחלה הנחתי ש-snumber הוא "שלוחת-המקור של מי שמחייג" (משתנה לפי איזה
// מנהל מחובר). זו הייתה טעות. אומת בפועל: **snumber הוא ערך קבוע** אחד
// (7090473485) שזהה בכל קריאה — **cnumber הוא היעד שאליו בפועל רוצים
// להתקשר** (הורה, איש צוות, או — לבדיקה עצמית — הטלפון של מנהל ספציפי).
// אין יותר "בחירת שלוחה למחייג מפורשת" — זה לא היה המודל הנכון של ה-API הזה.
//
// ⚠️ מלכודת שנייה שכבר נתקלנו בה: Adel Telecom יכול להחזיר HTTP 200 גם
// כשהפרמטרים לא תקינים בפועל (לא חייג בכלל) — ה-body עצמו הוא מה שמעיד על
// הצלחה אמיתית: {"responses":[{"message":"OK","code":204,...}]}. code/message
// אחר (גם עם HTTP 200!) נחשב כישלון אמיתי, לא רק status לא-2xx ברמת ה-HTTP.
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY מוזרקים
// אוטומטית ע"י הפלטפורמה לכל Edge Function (כמו ב-supabase/functions/ai).
// PBX_AUTH_USER / PBX_AUTH_PASS הם secrets ייעודיים (`supabase secrets set`).
//
// תגובת ה-PBX (או שגיאת fetch) עלולה להדהד בחזרה חלקים מהבקשה שנשלחה אליו —
// והבקשה הזו נושאת את PBX_AUTH_PASS בגוף ה-query string שלה. לכן שום טקסט
// גולמי מתגובת ה-PBX/משגיאת fetch לא חוזר ללקוח, רק לוג פנימי (Edge Function log).

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// snumber קבוע — לא תלוי משתמש, לא ניתן לבחירה מהלקוח (אומת חי 10/09/2026).
const SNUMBER = '7090473485';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// נירמול מספר-יעד — כפילות *מכוונת* של window.cv3NormPhone (js/phone-utils.js),
// למספרי הורים/צוות רגילים (05X נייד, 0-משהו קווי — 9-10 ספרות). Edge Function
// לא יכולה לייבא קוד דפדפן, אז האלגוריתם משוכפל כאן ביד. אם cv3NormPhone
// משתנה — יש לעדכן גם כאן, אחרת השרת יאמת לפי כלל אחר מהלקוח.
function normPhone(v: unknown): string | null {
  if (!v) return null;
  let d = String(v).replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  if (!d.startsWith('0')) d = '0' + d;
  return (d.length >= 9 && d.length <= 10) ? d : null;
}

// מספרי-בדיקה ידועים (11 ספרות — DID פנימי, לא מספר נייד/קווי רגיל) שמותר
// לחייג אליהם בלי לעבור את ולידציית ה-9/10-ספרות הרגילה של normPhone. רק
// אלה — לא כל מחרוזת 11-ספרות שהלקוח שולח.
const KNOWN_TEST_TARGETS: Record<string, string> = {
  '07722000030': 'יוסף — שלוחה 201',
};

function resolveDestination(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s && KNOWN_TEST_TARGETS[s]) return s;
  return normPhone(raw);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST בלבד' }, 405);

  let body: { phone?: string } = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }

  // (1) חילוץ הטוקן.
  const authHeader = req.headers.get('Authorization') || '';
  const bm = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = bm && bm[1] && bm[1].trim();
  if (!token) return json({ ok: false, error: 'unauthorized' }, 401);

  // (2) אימות הטוקן מול Supabase עצמו — ה-id שחוזר הוא המשתמש האמיתי, לא מה
  // שהלקוח שולח.
  let userId: string | null = null;
  try {
    const ures = await fetch(SB_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SB_ANON },
    });
    if (!ures.ok) return json({ ok: false, error: 'unauthorized' }, 401);
    const udata = await ures.json();
    userId = udata && udata.id;
    if (!userId) return json({ ok: false, error: 'unauthorized' }, 401);
  } catch {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  // (3) role/active מ-profiles עם service-role — הבדיקה המוסמכת, בעצמאות
  // מ-RLS. כשל בשליפה עצמה נחשב "לא מאושר" (נכשל סגור), לא רק role שגוי.
  let role: string | null = null, active: boolean | null = true;
  try {
    const purl = SB_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId) + '&select=role,active';
    const pres = await fetch(purl, {
      headers: { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE },
    });
    if (!pres.ok) return json({ ok: false, error: 'forbidden' }, 403);
    const rows = await pres.json();
    const prof = Array.isArray(rows) ? rows[0] : null;
    role = prof && prof.role;
    active = prof ? prof.active : false;
  } catch {
    return json({ ok: false, error: 'forbidden' }, 403);
  }
  if (role !== 'מנהל' || active === false) return json({ ok: false, error: 'forbidden' }, 403);

  // (4) נירמול+ולידציה של היעד — רק אחרי שעבר את שער ההרשאה. עוצר כאן גם
  // מחרוזת מזוהמת שיכולה, אם הייתה מגיעה גולמית ל-';'-query למטה, להזריק
  // פרמטרים נוספים.
  const cnumber = resolveDestination(body.phone);
  if (!cnumber) return json({ ok: false, error: 'bad phone' }, 400);

  // (5) כתובת ה-PBX נבנית ביד עם ';' (לא URLSearchParams — זה משתמש ב-'&').
  const pbxUser = Deno.env.get('PBX_AUTH_USER') || '';
  const pbxPass = Deno.env.get('PBX_AUTH_PASS') || '';
  const pbxUrl = 'https://adeltelecom.com/pbx_api/calls/make/?' +
    'auth_username=' + pbxUser + ';' +
    'auth_password=' + pbxPass + ';' +
    'stype=phone;' +
    'snumber=' + SNUMBER + ';' +
    'cnumber=' + cnumber;

  try {
    const cres = await fetch(pbxUrl);
    const ctext = await cres.text();
    // הצלחה אמיתית = HTTP 2xx *וגם* גוף התשובה מדווח code 204/"OK" — Adel
    // Telecom יכול להחזיר HTTP 200 גם כשלא חייג בפועל (נתפס בעבודה עם יוסף).
    let bodyOk = false;
    try {
      const j = JSON.parse(ctext);
      const first = j && Array.isArray(j.responses) ? j.responses[0] : null;
      bodyOk = !!first && (first.code === 204 || first.message === 'OK');
    } catch { /* לא JSON תקין — bodyOk נשאר false */ }
    if (!cres.ok || !bodyOk) {
      console.error('pbx call not confirmed', cres.status, ctext.slice(0, 500));
      return json({ ok: false, error: 'pbx failed' }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    console.error('pbx fetch error', e && (e instanceof Error ? e.message : String(e)));
    return json({ ok: false, error: 'pbx error' }, 502);
  }
});
