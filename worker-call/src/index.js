// cheder-call — Cloudflare Worker: כפתור "חייג" בכרטיס תלמיד (בית התלמוד) → שיחת PBX
// (Adel Telecom) להורה. שם הזוג עם worker-tts: אותה צורת fetch handler/CORS.
//
// זהו שער ההרשאה האמיתי של הפיצ'ר — לא הכפתור בדפדפן (js/call.js), שהוא UX בלבד
// וכל אחד יכול לעקוף אותו מ-devtools. לפני שנוגעים בכלל ב-API של ה-PBX:
//   1) שולפים 'Authorization: Bearer <token>' מהבקשה.
//   2) מאמתים את הטוקן מול Supabase עצמו (GET /auth/v1/user) — לא סומכים על שום
//      דבר שהלקוח טוען על זהותו, מקבלים בחזרה את ה-id האמיתי של המשתמש המחובר.
//   3) שולפים role/active מ-public.profiles עם מפתח service-role (עוקף RLS
//      לגמרי, לא תלוי בכך ש-policies.sql יישאר מוגדר נכון) ומאשרים רק
//      role==='מנהל' && active!==false.
//   4) רק אחרי זה — מנרמלים ומוודאים את מספר הטלפון בצד-שרת.
//   5) בונים את כתובת ה-PBX ומחייגים. snumber (שלוחת המקור) הוא תמיד
//      env.PBX_SOURCE_EXT הקבוע — לעולם לא ערך שמגיע מהלקוח, אחרת קורא מורשה
//      (או באג) יכול להפוך את הנקודה הזו לרילי פתוח בין שני מספרים כלשהם.
//
// הסודות (PBX_AUTH_USER, PBX_AUTH_PASS, SUPABASE_SERVICE_KEY, SUPABASE_URL,
// SUPABASE_ANON_KEY) מגיעים רק מ-env.* — נשמרים כ-secrets עם `wrangler secret put`,
// לא כתובים כאן ולא בשום קובץ צד-לקוח.
//
// CORS פתוח (כמו ב-worker-tts) כי הגבול האמיתי הוא הטוקן+role, לא ה-origin של הבקשה.
// בשונה מ-worker-tts, הבקשה כאן חייבת לשאת גם Authorization ו-apikey, ולכן
// Access-Control-Allow-Headers כולל אותם (לא רק Content-Type כמו שם).

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
    ...extra,
  };
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: cors({ 'Content-Type': 'application/json' }) });
}

// נירמול טלפון — כפילות *מכוונת* של window.cv3NormPhone (js/phone-utils.js).
// Worker לא יכול לייבא קוד דפדפן, אז האלגוריתם משוכפל כאן ביד. אם cv3NormPhone
// משתנה — יש לעדכן גם כאן בהתאם, אחרת השרת יאמת לפי כלל אחר מהלקוח.
function normPhone(v) {
  if (!v) return null;
  let d = String(v).replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  if (!d.startsWith('0')) d = '0' + d;
  return (d.length >= 9 && d.length <= 10) ? d : null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (request.method !== 'POST') return json({ ok: false, error: 'POST בלבד' }, 405);

    let body = {};
    try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'bad json' }, 400); }

    // (1) חילוץ הטוקן.
    const authHeader = request.headers.get('Authorization') || '';
    const bm = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = bm && bm[1] && bm[1].trim();
    if (!token) return json({ ok: false, error: 'unauthorized' }, 401);

    // (2) אימות הטוקן מול Supabase עצמו — ה-id שחוזר הוא המשתמש האמיתי, לא
    // מה שהלקוח שולח.
    let userId = null;
    try {
      const ures = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
        headers: { Authorization: 'Bearer ' + token, apikey: env.SUPABASE_ANON_KEY },
      });
      if (!ures.ok) return json({ ok: false, error: 'unauthorized' }, 401);
      const udata = await ures.json();
      userId = udata && udata.id;
      if (!userId) return json({ ok: false, error: 'unauthorized' }, 401);
    } catch (_) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    // (3) role/active מ-profiles עם service-role — הבדיקה המוסמכת, בעצמאות
    // מ-RLS. כשל בשליפה עצמה נחשב "לא מאושר" (נכשל סגור), לא רק role שגוי.
    let role = null, active = true;
    try {
      const purl = env.SUPABASE_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId) + '&select=role,active';
      const pres = await fetch(purl, {
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
      });
      if (!pres.ok) return json({ ok: false, error: 'forbidden' }, 403);
      const rows = await pres.json();
      const prof = Array.isArray(rows) ? rows[0] : null;
      role = prof && prof.role;
      active = prof ? prof.active : false;
    } catch (_) {
      return json({ ok: false, error: 'forbidden' }, 403);
    }
    if (role !== 'מנהל' || active === false) return json({ ok: false, error: 'forbidden' }, 403);

    // (4) נירמול+ולידציה של הטלפון — רק אחרי שעבר את שער ההרשאה. עוצר כאן גם
    // מחרוזת טלפון מזוהמת שיכולה, אם הייתה מגיעה גולמית ל-';'-query למטה,
    // להזריק פרמטרים נוספים.
    const phone = normPhone(body.phone);
    if (!phone) return json({ ok: false, error: 'bad phone' }, 400);

    // (5) כתובת ה-PBX נבנית ביד עם ';' (לא URLSearchParams — זה משתמש ב-'&').
    // snumber = env.PBX_SOURCE_EXT הקבוע בלבד, לעולם לא מהלקוח.
    const snumber = env.PBX_SOURCE_EXT || '';
    const pbxUrl = 'https://adeltelecom.com/pbx_api/calls/make/?' +
      'auth_username=' + env.PBX_AUTH_USER + ';' +
      'auth_password=' + env.PBX_AUTH_PASS + ';' +
      'stype=phone;' +
      'snumber=' + snumber + ';' +
      'cnumber=' + phone;

    try {
      const cres = await fetch(pbxUrl);
      const ctext = await cres.text();
      if (!cres.ok) {
        // pbxUrl נושא את PBX_AUTH_PASS בגוף ה-query string שלו. אם ה-PBX מהדהד
        // חזרה חלק מהבקשה שקיבל (דפוס נפוץ ב-API טלפוניה ישן, למשל הודעת שגיאה
        // שכוללת את הפרמטרים שנשלחו) — ctext עלול להכיל את הסיסמה בפועל. לכן
        // הטקסט הגולמי נרשם רק ללוג הפנימי של ה-Worker (wrangler tail), ולדפדפן
        // חוזרת הודעה גנרית בלבד, בלי שום חלק מתגובת ה-PBX.
        console.error('pbx call failed', cres.status, ctext.slice(0, 500));
        return json({ ok: false, error: 'pbx failed' }, 502);
      }
      return json({ ok: true });
    } catch (e) {
      // מאותה סיבה: הודעת שגיאה של fetch יכולה לכלול את ה-URL שנכשל (עם הסיסמה
      // בתוכו) — לא מעבירים את e.message ללקוח.
      console.error('pbx fetch error', e && (e.message || e));
      return json({ ok: false, error: 'pbx error' }, 502);
    }
  },
};
