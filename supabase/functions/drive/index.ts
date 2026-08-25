// supabase/functions/drive/index.ts
// שער יחיד בין האתר לבין Google Drive.
//
// למה בכלל: הדפדפן לא יכול לדבר עם גוגל — אין לו טוקן (ואסור שיהיה לו), ונטפרי
// חוסם את script.google.com. לכן הדפדפן פונה רק ל-Supabase (מותר), והפונקציה הזו
// מדברת עם Drive בשם חשבון המכינה, שיש לו הרשאת עריכה על תיקיית "תיקי תלמידים".
//
// אבטחה — שתי שכבות, ואף אחת מהן לא סומכת על הדפדפן:
//   1. מזהים את המשתמש לפי ה-JWT שלו, ושואלים את Supabase **בשמו** אילו תיקיות
//      דרייב משויכות לתלמיד המבוקש. ה-RLS (can_read_student) הוא שמחליט — אם
//      אין לו גישה לתלמיד, הוא מקבל רשימה ריקה ואין מה להמשיך.
//   2. כל פעולה מוגבלת לתיקיות שחזרו מהשאילתה הזו. גם קובץ בודד נבדק מול
//      ה-parents שלו, כדי שלא יהיה אפשר להזין מזהה של קובץ אקראי מהדרייב.
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const REFRESH_TOKEN = Deno.env.get('GOOGLE_REFRESH_TOKEN')!;
const GAS_URL = Deno.env.get('GAS_URL') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

// access token נשמר בזיכרון בין קריאות (ה-instance חי כמה דקות) — פחות סיבובים לגוגל
let cached: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('google_auth_failed: ' + JSON.stringify(d).slice(0, 200));
  cached = { token: d.access_token, exp: Date.now() + (d.expires_in ?? 3600) * 1000 };
  return cached.token;
}
const gFetch = async (url: string, init: RequestInit = {}) => {
  const t = await googleToken();
  const h = new Headers(init.headers);
  h.set('Authorization', 'Bearer ' + t);
  return fetch(url, { ...init, headers: h });
};


const b64 = (buf: Uint8Array) => {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
  return btoa(bin);
};

// המרת Word/Excel/PowerPoint ל-PDF, כדי שתהיה תצוגה מקדימה גם להם.
// הטריק: העלאה חוזרת לדרייב **עם המרה** ליצירת מסמך גוגל זמני (יצירה מותרת גם
// בהיקף drive.file, גם כשהמקור הוא קובץ ישן שאסור לנו לגעת בו), ייצוא ל-PDF,
// ומיד מחיקה. הקובץ הזמני נוצר בשורש הדרייב של חשבון המכינה ולא בתיקיית התלמיד.
const OFFICE: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
  'application/msword': 'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
  'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation',
};
async function toPdfIfOffice(buf: Uint8Array, mime: string, name: string) {
  const target = OFFICE[mime];
  if (!target) return null;
  let tmpId = '';
  try {
    const boundary = 'cv' + crypto.randomUUID().replace(/-/g, '');
    const enc = new TextEncoder();
    const meta = JSON.stringify({ name: 'tmp-preview', mimeType: target });
    const head = enc.encode(`--${boundary}
Content-Type: application/json; charset=UTF-8

${meta}
--${boundary}
Content-Type: ${mime}

`);
    const tail = enc.encode(`
--${boundary}--
`);
    const body = new Uint8Array(head.length + buf.length + tail.length);
    body.set(head, 0); body.set(buf, head.length); body.set(tail, head.length + buf.length);
    const up = await gFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
    if (!up.ok) return null;
    tmpId = (await up.json()).id;
    const ex = await gFetch(`${DRIVE}/files/${tmpId}/export?mimeType=application/pdf`);
    if (!ex.ok) return null;
    const pdf = new Uint8Array(await ex.arrayBuffer());
    return { buf: pdf, name: name.replace(/\.[^.]+$/, '') + '.pdf' };
  } catch (_) {
    return null;
  } finally {
    if (tmpId) { try { await gFetch(`${DRIVE}/files/${tmpId}`, { method: 'DELETE' }); } catch (_) { /* ignore */ } }
  }
}

// אילו תיקיות דרייב מותרות למשתמש הזה — לפי RLS, לא לפי הדפדפן.
// שני נושאים: תלמיד (student_docs, לפי can_read_student) ואיש צוות (staff, מנהל בלבד).
// בשני המקרים השאילתה נשלחת **עם ה-JWT של המשתמש**, ולכן ה-RLS הוא שמחליט:
// אם אין לו גישה הוא מקבל רשימה ריקה, ואין מה להמשיך.
async function allowedFolders(userJwt: string, studentId: string, staffId: string, fundId = ''): Promise<string[]> {
  const url = fundId
    // קופה קטנה: תיקיית החשבוניות של הקופה. ה-RLS על petty_funds הוא
    // מנהל/מזכירה/מפקח בלבד, ולכן מורה שינחש fundId יקבל רשימה ריקה.
    ? `${SB_URL}/rest/v1/petty_funds?select=drive_folder&id=eq.${encodeURIComponent(fundId)}`
    : staffId
      ? `${SB_URL}/rest/v1/staff?select=drive_id&id=eq.${encodeURIComponent(staffId)}`
      : `${SB_URL}/rest/v1/student_docs?select=drive_id&source=eq.drive&student_id=eq.${encodeURIComponent(studentId)}`;
  const r = await fetch(url, { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + userJwt } });
  if (!r.ok) return [];
  const rows = await r.json();
  const key = fundId ? 'drive_folder' : 'drive_id';
  const top = (Array.isArray(rows) ? rows : [])
    .map((x: Record<string, string>) => x[key]).filter(Boolean);
  if (!top.length) return [];
  // מרחיבים רמה אחת: תיקיות משנה שנוצרו בתוך תיקיית התלמיד מותרות גם הן,
  // אחרת אי אפשר להעלות לתוכן או למחוק אותן.
  const subs: string[] = [];
  for (const fid of top) {
    const q = encodeURIComponent(`'${fid}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const rr = await gFetch(`${DRIVE}/files?q=${q}&fields=files(id)&pageSize=100`);
    if (rr.ok) {
      const d = await rr.json();
      for (const f of (d.files || [])) subs.push(f.id);
    }
  }
  return top.concat(subs);
}

// קובץ בודד: מוודאים שההורה שלו הוא אחת מהתיקיות המורשות
async function fileInAllowed(fileId: string, folders: string[]) {
  const r = await gFetch(`${DRIVE}/files/${fileId}?fields=id,name,mimeType,parents`);
  if (!r.ok) return null;
  const f = await r.json();
  return (f.parents || []).some((p: string) => folders.includes(p)) ? f : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return fail('לא מחובר', 401);

    const u = new URL(req.url);
    const action = u.searchParams.get('action') || '';
    const studentId = u.searchParams.get('studentId') || '';
    const staffId = u.searchParams.get('staffId') || '';
    const fundId = u.searchParams.get('fundId') || '';
    if (!studentId && !staffId && !fundId) return fail('חסר מזהה תלמיד / איש צוות / קופה');

    const folders = await allowedFolders(jwt, studentId, staffId, fundId);
    if (!folders.length) {
      return fail(fundId
        ? 'אין לך הרשאה לקופה הזו, או שלא הוגדרה לה תיקיית חשבוניות בדרייב'
        : staffId
          ? 'אין לך הרשאה לתיק הזה (מנהל בלבד), או שאין לאיש הצוות תיקייה בדרייב'
          : 'אין לך הרשאה לתלמיד הזה, או שאין לו תיקייה בדרייב', 403);
    }

    // ── רשימת הקבצים בכל התיקיות של התלמיד ──
    if (action === 'list') {
      const out: unknown[] = [];
      for (const fid of folders) {
        const q = encodeURIComponent(`'${fid}' in parents and trashed=false`);
        const r = await gFetch(`${DRIVE}/files?q=${q}&pageSize=200&orderBy=name` +
          `&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,parents)`);
        const d = await r.json();
        if (d.files) out.push(...d.files.map((f: Record<string, unknown>) => ({ ...f, folderId: fid })));
      }
      return json({ ok: true, folders, files: out });
    }

    // ── העלאה: הגוף הוא הקובץ עצמו (בלי base64 — חוסך שליש נפח) ──
    if (action === 'upload') {
      const folderId = u.searchParams.get('folderId') || folders[0];
      if (!folders.includes(folderId)) return fail('תיקייה לא מורשית', 403);
      const name = u.searchParams.get('name') || 'file';
      const mime = req.headers.get('content-type') || 'application/octet-stream';
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length) return fail('קובץ ריק');

      const boundary = 'bht' + crypto.randomUUID().replace(/-/g, '');
      const meta = JSON.stringify({ name, parents: [folderId] });
      const enc = new TextEncoder();
      const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
      const tail = enc.encode(`\r\n--${boundary}--\r\n`);
      const body = new Uint8Array(head.length + bytes.length + tail.length);
      body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);

      const r = await gFetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      });
      const d = await r.json();
      if (!r.ok) return fail('ההעלאה לדרייב נכשלה: ' + JSON.stringify(d).slice(0, 200), 502);
      return json({ ok: true, file: d });
    }

    // ── הורדה/צפייה: מחזירים את הבייטים דרך Supabase, כדי שהדפדפן לא ייגע בגוגל ──
    if (action === 'download' || action === 'preview') {
      const fileId = u.searchParams.get('fileId') || '';
      const f = await fileInAllowed(fileId, folders);
      if (!f) return fail(fundId ? 'הקובץ אינו בתיקיית החשבוניות של הקופה' : 'הקובץ אינו בתיקיית התלמיד', 403);
      // מסמכי Google (Docs/Sheets) אינם ניתנים להורדה ישירה — מייצאים ל-PDF
      const isGoogleDoc = String(f.mimeType || '').startsWith('application/vnd.google-apps');
      const url = isGoogleDoc
        ? `${DRIVE}/files/${fileId}/export?mimeType=application/pdf`
        : `${DRIVE}/files/${fileId}?alt=media`;
      const r = await gFetch(url);
      if (!r.ok) {
        // 403 = קובץ ישן שלא הועלה דרך המערכת (היקף drive.file מכסה רק מה שהיא יצרה).
        // נופלים לגשר ה-Apps Script, שרץ בחשבון המכינה עם drive.readonly ולכן מגיע גם אליו.
        if (r.status === 403 && GAS_URL) {
          const g = await fetch(`${GAS_URL}?type=fileget&sid=${encodeURIComponent(studentId)}` +
            `&fid=${encodeURIComponent(fileId)}&token=${encodeURIComponent(jwt)}&callback=cb`, { redirect: 'follow' });
          const txt = await g.text();
          const mm = txt.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
          let d: Record<string, unknown> | null = null;
          try { d = mm ? JSON.parse(mm[1]) : JSON.parse(txt); } catch (_) { d = null; }
          if (d && d.ok) {
            if (action === 'preview') {
              const raw = Uint8Array.from(atob(String(d.dataB64 || '')), c => c.charCodeAt(0));
              const conv = await toPdfIfOffice(raw, String(d.mimeType || ''), String(d.name || 'file'));
              if (conv) return json({ ok: true, name: conv.name, mimeType: 'application/pdf', size: conv.buf.length, dataB64: b64(conv.buf) });
            }
            return json(d);
          }
          return fail(String((d && d.error) || 'אין הרשאת הורדה לקובץ הזה — פתח אותו בדרייב'), 403);
        }
        const t = await r.text();
        return fail('ההורדה נכשלה: ' + t.slice(0, 150), r.status);
      }
      // ⚠️ נטפרי סורק את גוף התגובה וחוסם קבצים בינאריים (PDF חזר עם 418
      // "Error in NetFree", והדפדפן ראה את זה כשגיאת CORS). לכן מחזירים את
      // הקובץ כ-base64 בתוך JSON — תוכן טקסטואלי שעובר — והדפדפן מרכיב אותו
      // בחזרה ל-Blob עם ה-mime הנכון. עלות: כשליש נפח, וזה שווה את זה.
      let buf = new Uint8Array(await r.arrayBuffer());
      let outMime = isGoogleDoc ? 'application/pdf' : (r.headers.get('content-type') || 'application/octet-stream');
      let outName = String(f.name || 'file') + (isGoogleDoc ? '.pdf' : '');
      if (action === 'preview') {
        const conv = await toPdfIfOffice(buf, outMime, outName);
        if (conv) { buf = conv.buf; outMime = 'application/pdf'; outName = conv.name; }
      }
      return json({ ok: true, name: outName, mimeType: outMime, size: buf.length, dataB64: b64(buf) });
    }

    // ── מחיקה (לפח האשפה של דרייב, לא לצמיתות — ניתן לשחזור) ──
    if (action === 'delete') {
      const fileId = u.searchParams.get('fileId') || '';
      const f = await fileInAllowed(fileId, folders);
      if (!f) return fail(fundId ? 'הקובץ אינו בתיקיית החשבוניות של הקופה' : 'הקובץ אינו בתיקיית התלמיד', 403);
      const r = await gFetch(`${DRIVE}/files/${fileId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
      });
      if (!r.ok) {
        const t = await r.text();
        return fail(r.status === 403
          ? 'אין הרשאת מחיקה לקובץ הזה — הוא לא הועלה דרך המערכת. מחק אותו בדרייב'
          : 'המחיקה נכשלה: ' + t.slice(0, 150), r.status);
      }
      return json({ ok: true });
    }

    // ── העברת חשבונית בין קופות ──
    // כשרישום עובר מקופה לקופה, גם הקובץ בדרייב חייב לעבור: אחרת השורה
    // מצביעה על קובץ שיושב בתיקייה של הקופה השנייה, ו-fileInAllowed יחסום
    // אותו — כלומר החשבונית "נעלמת" מבלי שאיש מחק אותה.
    // ההרשאה נבדקת על **שתי** התיקיות, כל אחת בנפרד ועם ה-JWT של המשתמש.
    if (action === 'move') {
      const fileId = u.searchParams.get('fileId') || '';
      const toFundId = u.searchParams.get('toFundId') || '';
      if (!fundId || !toFundId) return fail('חסר מזהה קופה מקור או יעד');
      const dest = await allowedFolders(jwt, '', '', toFundId);
      if (!dest.length) return fail('אין לך הרשאה לקופת היעד, או שאין לה תיקיית חשבוניות', 403);
      const f = await fileInAllowed(fileId, folders);
      if (!f) return fail('הקובץ אינו בתיקיית החשבוניות של קופת המקור', 403);
      const from = (f.parents || []).filter((x: string) => folders.includes(x)).join(',');
      const r = await gFetch(`${DRIVE}/files/${fileId}?addParents=${dest[0]}&removeParents=${encodeURIComponent(from)}` +
        `&fields=id,name,webViewLink,parents`, { method: 'PATCH' });
      const d = await r.json();
      if (!r.ok) {
        return fail(r.status === 403
          ? 'אין הרשאת העברה לקובץ הזה — הוא לא הועלה דרך המערכת. העבר אותו בדרייב'
          : 'ההעברה נכשלה: ' + JSON.stringify(d).slice(0, 150), r.status);
      }
      return json({ ok: true, file: d });
    }

    // ── תיקיית משנה בתוך תיקיית התלמיד ──
    if (action === 'mkdir') {
      const folderId = u.searchParams.get('folderId') || folders[0];
      if (!folders.includes(folderId)) return fail('תיקייה לא מורשית', 403);
      const name = (u.searchParams.get('name') || '').trim();
      if (!name) return fail('חסר שם תיקייה');
      const r = await gFetch(`${DRIVE}/files?fields=id,name`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [folderId] }),
      });
      const d = await r.json();
      if (!r.ok) return fail('יצירת התיקייה נכשלה: ' + JSON.stringify(d).slice(0, 150), 502);
      return json({ ok: true, folder: d });
    }

    return fail('פעולה לא מוכרת: ' + action);
  } catch (e) {
    return fail(String((e as Error).message || e), 500);
  }
});
