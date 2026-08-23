// Cloudflare Worker — קולט דיווחים קוליים משלוחה 9 בימות ומכניס אותם למערכת.
//
// למה Worker ולא סקריפט על המחשב: יוסף ביקש שזה יעבוד גם כשהמחשב כבוי.
// ה-Worker רץ בענן של Cloudflare לפי cron, בלי תלות בשום מכונה מקומית.
//
// הזרימה (כל 5 דקות):
//   1. Login לימות → GetIVR2Dir על תיקיית שלוחה 9
//   2. כל קובץ הקלטה שעדיין לא טופל (לפי טבלת voice_reports ב-Supabase)
//   3. הורדה → Gemini: תמלול + זיהוי שם התלמיד + סיווג + תקציר
//   4. התאמה לרשימת התלמידים (fuzzy, כי בהקלטה השם נאמר ולא נכתב)
//   5. הכנסה כ**טיוטה** ל-voice_reports — אף פעם לא ישר לכרטיס.
//      אדם מאשר. דיווח על תלמיד לא נכנס למערכת בלי עין אנושית.
//
// כל הסודות ב-wrangler secrets, לא בקוד.

const YM = 'https://www.call2all.co.il/ym/api';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const EXT = '9';

/* ─────────────────────────── ימות ─────────────────────────── */

async function ymLogin(env) {
  const u = `${YM}/Login?username=${encodeURIComponent(env.YM_USER)}&password=${encodeURIComponent(env.YM_PASS)}`;
  const d = await (await fetch(u)).json();
  if (d.responseStatus !== 'OK' || !d.token) throw new Error('כניסה לימות נכשלה: ' + (d.message || ''));
  return d.token;
}

async function ymList(token) {
  const u = `${YM}/GetIVR2Dir?token=${encodeURIComponent(token)}&path=${encodeURIComponent('ivr2:/' + EXT)}`;
  const d = await (await fetch(u)).json();
  // מחזירים רק הקלטות. ext.ini ו-WhiteList.ini הם קונפיג ולא דיווחים.
  return (d.files || []).filter(f => /\.(wav|mp3|ogg)$/i.test(f.name || ''));
}

async function ymDownload(token, name) {
  const path = `ivr2:/${EXT}/${name}`;
  const u = `${YM}/DownloadFile?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('הורדת ההקלטה נכשלה: ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

/* ─────────────────────────── Supabase ─────────────────────────── */

async function sb(env, path, init) {
  const r = await fetch(`${env.SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SB_SERVICE_KEY,
      Authorization: `Bearer ${env.SB_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init && init.headers),
    },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

/* ─────────────────────────── Gemini ─────────────────────────── */

function b64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

const SCHEMA = {
  type: 'object',
  properties: {
    transcript: { type: 'string' },
    reporter: { type: 'string' },
    student: { type: 'string' },
    category: { type: 'string', enum: ['התנהגות', 'לימודים', 'חברתי', 'בריאות', 'שיחת הורים', 'אחר'] },
    summary: { type: 'string' },
    severity: { type: 'string', enum: ['נמוכה', 'רגילה', 'גבוהה'] },
    confidence: { type: 'number' },
  },
  required: ['transcript', 'student', 'category', 'summary', 'confidence'],
};

async function analyze(env, audio, mime, studentNames) {
  const prompt =
    'לפניך הקלטה קולית בעברית מאיש צוות בישיבה. הוא אומר את שמו, את שם התלמיד ואת הדיווח.\n' +
    'החזר JSON עם: תמלול מלא, שם המדווח, שם התלמיד, קטגוריה, תקציר של משפט-שניים, וחומרה.\n' +
    'שם התלמיד חייב להיבחר **מתוך הרשימה הבאה בלבד**, בהתאמה הקרובה ביותר למה שנשמע.\n' +
    'אם אינך בטוח מיהו התלמיד — החזר confidence נמוך. עדיף לא לנחש.\n' +
    'אל תוסיף פרשנות משלך לדיווח, ואל תשפוט את התלמיד. תמלל ותסכם בלבד.\n\n' +
    'רשימת התלמידים:\n' + studentNames.join('\n');

  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64(audio) } }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4000,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
    },
  };
  const r = await fetch(`${GEMINI}?key=${encodeURIComponent(env.GEMINI_KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Gemini: ' + JSON.stringify(d).slice(0, 200));
  const txt = (((d.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('') || '';
  return JSON.parse(txt);
}

/* ─────────────────────────── התאמת תלמיד ─────────────────────────── */

// בהקלטה השם *נאמר*, ולכן כתיב לא יהיה זהה. משווים לפי מילים משותפות
// ולא לפי מחרוזת מדויקת — "דובי מלינוביץ" מול "דב בער (דובי) מלינוביץ".
function matchStudent(said, students) {
  const norm = s => String(s || '').replace(/["'`״׳()]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = s => new Set(norm(s).split(' ').filter(w => w.length > 1));
  const a = words(said);
  let best = null, score = 0;
  for (const s of students) {
    const b = words(s.full);
    let hits = 0;
    for (const w of a) if (b.has(w)) hits++;
    const sc = hits / Math.max(1, Math.min(a.size, b.size));
    if (sc > score) { score = sc; best = s; }
  }
  return score >= 0.5 ? { student: best, score } : { student: null, score };
}

/* ─────────────────────────── הריצה ─────────────────────────── */

async function run(env) {
  const log = [];
  const token = await ymLogin(env);
  const files = await ymList(token);
  log.push(`נמצאו ${files.length} הקלטות בשלוחה ${EXT}`);
  if (!files.length) return log;

  const [students, seen] = await Promise.all([
    sb(env, 'students?select=id,name,family'),
    sb(env, 'voice_reports?select=audio_name'),
  ]);
  const done = new Set((seen || []).map(r => r.audio_name).filter(Boolean));
  const list = students.map(s => ({
    id: s.id,
    full: (s.name || '').includes(s.family || '~') ? s.name : `${s.family || ''} ${s.name || ''}`.trim(),
  }));
  const names = list.map(s => s.full);

  for (const f of files) {
    if (done.has(f.name)) continue;
    try {
      const audio = await ymDownload(token, f.name);
      const mime = /\.mp3$/i.test(f.name) ? 'audio/mp3' : /\.ogg$/i.test(f.name) ? 'audio/ogg' : 'audio/wav';
      const a = await analyze(env, audio, mime, names);
      const m = matchStudent(a.student, list);

      await sb(env, 'voice_reports', {
        method: 'POST',
        // שמות העמודות תואמים לטבלה הקיימת (voice_reports) — היא כבר
        // משמשת להקלטה מהדפדפן, ואין טעם בשתי טבלאות לאותו דבר.
        body: JSON.stringify({
          student_id: m.student ? m.student.id : null,
          teacher_name: a.reporter || null,
          heard_name: a.student || null,
          transcript: a.transcript || null,
          report_text: a.summary || null,
          report_type: a.category || 'אחר',
          severity: a.severity || 'רגילה',
          // ⚠️ תמיד טיוטה. דיווח על תלמיד לא נכנס לכרטיס בלי אישור אנושי,
          // גם כשהמודל בטוח — הוא יכול לשמוע שם דומה ולטעות בתלמיד.
          status: 'draft',
          confidence: a.confidence ?? null,
          source: 'קו טלפון',
          audio_name: f.name,
          audio_path: 'ivr2:/' + EXT + '/' + f.name,
        }),
      });
      log.push(`✓ ${f.name} → ${m.student ? m.student.full : '(תלמיד לא זוהה)'} · ${a.category}`);
    } catch (e) {
      log.push(`✗ ${f.name} — ${e.message}`);
    }
  }
  return log;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env).then(l => console.log(l.join('\n'))).catch(e => console.error(e.message)));
  },
  // הרצה ידנית לבדיקה: /run?key=…  — מוגן בסוד, אחרת כל אחד יכול להפעיל
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname !== '/run') return new Response('ok');
    if (u.searchParams.get('key') !== env.RUN_KEY) return new Response('forbidden', { status: 403 });
    try {
      const l = await run(env);
      return new Response(l.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (e) {
      return new Response('שגיאה: ' + e.message, { status: 500 });
    }
  },
};
