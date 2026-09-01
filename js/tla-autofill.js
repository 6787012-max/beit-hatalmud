// tla-autofill.js — "הזמנת נתונים אוטומטית" בדף ההכנה של התל"א
// (2026-08-24; הוסר 26/08 והוחזר באותו יום בשם החדש, עם שני שיפורים:
// אפשרות **להוסיף לקיים** במקום לדרוס, וסימון ברור של מה שהמודל לא מצא).
//
// קורא את מסמכי האבחון של התלמיד מהדרייב, מפיק מהם תקציר לארבעת שדות דף
// ההכנה, ומציג אותו **כטיוטה טעונת אישור**. לא נכתב כלום לתיק התלמיד עד
// שאדם לוחץ "אשר ושמור".
//
// ── שלוש הגבלות אמיתיות שעיצבו את המימוש ──
// 1. ה-OAuth הוא drive.file + drive.metadata.readonly. אין חיפוש גלובלי
//    לפי ת"ז; תיקיית התלמיד מגיעה מ-student_docs, וזה גם מה שאוכף הרשאה
//    (ה-Edge Function שואל את הטבלה עם ה-JWT של המשתמש, כך שה-RLS מחליט).
// 2. נטפרי מחזיר 418 על גוף בינארי. לכן ההורדה עוברת דרך ה-Edge Function
//    שמחזיר base64 בתוך JSON — אי אפשר למשוך מגוגל ישירות מהדפדפן.
// 3. Word/Excel אינם קלט חוקי למודל. `action=preview` בשרת ממיר אותם ל-PDF.
//
// פרטיות: אין שום לוג של תוכן המסמכים. ללוג נכנסים רק שמות קבצים ומזהים.
// המידע נשלח אך ורק ל-API של המודל, ולשום יעד אחר.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s && s.name) || '';
  const MODEL = 'gemini-2.5-flash';
  const API = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';

  // ⚠️ **רק "מסמך קביל"** — בקשה מפורשת של נעמי לוי (24/08).
  // קודם נסרקו גם "החלטת ועדה" ו"היסטוריית טיפול", ואצל אוליאל זה הביא
  // 15 קבצים כולל טופס בחירת הורים והיסטוריה ישנה. באבחונים הקבילים יש
  // קובץ או שניים — וזה מה שצריך. גם מייתר את החלוקה לקבוצות.
  const DIAG_FOLDERS = ['מסמך קביל'];
  const MAX_MB = 18;
  // תקרת קבצים לניתוח — האבחונים הרלוונטיים ביותר, לפי דירוג
  const MAX_DOCS = 5;

  const FIELD_MAP = {                       // מפתחות ה-JSON → שדות דף ההכנה
    background: 'רקע_ומגבלות',
    env: 'נתונים_סביבתיים',
    focus: 'מוקדים_לחיזוק',
    strengths: 'מוקדי_כוח',
  };

  const SYS = [
    'אתה עוזר פדגוגי במערכת ניהול חינוך מיוחד.',
    'אתה מקבל טקסט מלא של מסמכי אבחון של תלמיד אחד, ומפיק ממנו',
    'תקציר לארבעה שדות במקטע תל״א דף הכנה.',
    '',
    'כלל ברזל: אתה עובד אך ורק על הטקסט שנמסר לך.',
    'אסור להוסיף מידע, להשלים פערים, להסיק אבחנות או לנחש.',
    '',
    '1. רקע ומגבלות – אבחנה רפואית או התפתחותית, רקע תפקודי, מגבלות מרכזיות.',
    '   אם מופיע נתון של מנת משכל, חובה לציין אותו כאן במפורש,',
    '   כולל סוג המבחן ותאריך הבדיקה אם הם מופיעים.',
    '2. נתונים סביבתיים – רקע משפחתי, גורמי תמיכה, הקשר חברתי,',
    '   מורכבויות סביבתיות משפיעות.',
    '3. מוקדים לחיזוק – קשיים ואתגרים מרכזיים בתחום הלימודי,',
    '   ההתנהגותי, הרגשי או המוטורי, הדורשים מענה והצבת יעדים.',
    '4. מוקדי כוח – חוזקות, יכולות בולטות, תחומי עניין,',
    '   תכונות חיוביות ומשאבים אישיים.',
    '',
    'סגנון: עברית פדגוגית מקצועית ומכבדת בגוף שלישי.',
    'שתיים עד חמש נקודות בכל שדה, כל נקודה עד כעשרים מילים.',
    'בלי הליכים בירוקרטיים, בלי תאריכי ועדות, בלי שמות מטפלים,',
    'בלי ניסוח שיפוטי או מתייג.',
    'נתון חסר: "לא צוין במסמכים שבתיקייה".',
    'מסמכים סותרים: העדף את המאוחר יותר וציין זאת בסוגריים.',
  ].join('\n');

  const SCHEMA = {
    type: 'object',
    properties: {
      'רקע_ומגבלות': { type: 'array', items: { type: 'string' } },
      'מנת_משכל': { type: 'string', nullable: true },
      'נתונים_סביבתיים': { type: 'array', items: { type: 'string' } },
      'מוקדים_לחיזוק': { type: 'array', items: { type: 'string' } },
      'מוקדי_כוח': { type: 'array', items: { type: 'string' } },
      'מסמכים_שנסרקו': { type: 'array', items: { type: 'string' } },
      'התראות': { type: 'array', items: { type: 'string' } },
    },
    required: ['רקע_ומגבלות', 'נתונים_סביבתיים', 'מוקדים_לחיזוק', 'מוקדי_כוח',
               'מסמכים_שנסרקו', 'התראות'],
  };

  /* ───────────────── שכבת דרייב ───────────────── */

  async function drive(action, params, method) {
    const C = window.CV3 || {};
    const { data } = await window.sb.auth.getSession();
    const tok = data && data.session && data.session.access_token;
    if (!tok) throw new Error('אין חיבור פעיל — יש להיכנס מחדש');
    const qs = new URLSearchParams(Object.assign({ action }, params || {})).toString();
    const r = await fetch(C.SUPABASE_URL + '/functions/v1/drive?' + qs,
      { method: method || 'POST', headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tok } });
    let d = null; try { d = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((d && d.error) || ('שגיאה ' + r.status));
    return d;
  }

  /**
   * מאתר את מסמכי האבחון של התלמיד.
   * מחזיר { docs, failed, scanned, foldersFound } — ולא זורק על תיקייה
   * חסרה, כי "אין מסמך קביל" הוא מצב לגיטימי שצריך להציג למשתמש.
   */
  async function findDiagnosticDocs(student) {
    const links = await window.store.byStudent('student_docs', student.id);
    const drives = (links || []).filter(r => r.source === 'drive');
    if (!drives.length) {
      const e = new Error('לא נמצאה תיקיית דרייב משויכת לתלמיד ' + nm(student) + '.');
      e.code = 'NO_FOLDER'; throw e;
    }
    const d = await drive('list', { studentId: student.id });
    const all = d.files || [];
    const FOLDER = 'application/vnd.google-apps.folder';
    const subs = all.filter(f => f.mimeType === FOLDER);

    // מזהי התיקיות האבחוניות, לפי שם. התאמה גמישה — "מסמך קביל" מול
    // "מסמכים קבילים" ודומיהם.
    const norm = s => String(s || '').replace(/["'`״׳]/g, '').replace(/\s+/g, ' ').trim();
    const wanted = subs.filter(f => DIAG_FOLDERS.some(w => norm(f.name).indexOf(norm(w)) > -1));
    if (!wanted.length) {
      const e = new Error('לא נמצאה תיקיית "מסמך קביל" בתיק של ' + nm(student) + '.');
      e.code = 'NO_DIAG_FOLDER'; e.have = subs.map(f => f.name); throw e;
    }
    const ids = wanted.map(f => f.id);
    let docs = all.filter(f => f.mimeType !== FOLDER && ids.indexOf(f.folderId) > -1);
    // נעמי ציפתה לקובץ או שניים, אבל אצל אוליאל יש 11 קבצים ב"מסמך קביל" —
    // ביניהם דוח קופת חולים ושאלונים. מדרגים לפי רלוונטיות אבחונית ולוקחים
    // את המובילים: פחות רעש, פחות נפח, ותשובה מהירה בהרבה.
    const RANK = [
      [/אבחון|פסיכודיאגנוסט|אינטליגנצי|דידקט|נוירו|קוגניטיב/, 0],
      [/דוח|הערכה|סיכום|חוות ?דעת/, 1],
      [/שאלון|טופס/, 2],
    ];
    const rankOf = n => { for (const [re, r] of RANK) if (re.test(n)) return r; return 3; };
    docs.sort((a, b) => rankOf(a.name) - rankOf(b.name) ||
      String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
    const skipped = docs.slice(MAX_DOCS).map(f => f.name);
    docs = docs.slice(0, MAX_DOCS);
    if (!docs.length) {
      const e = new Error('תיקיית "מסמך קביל" של ' + nm(student) + ' ריקה.');
      e.code = 'EMPTY'; throw e;
    }
    return { docs: docs, foldersFound: wanted.map(f => f.name), skipped: skipped };
  }

  const isOffice = m => /officedocument|msword|ms-excel|vnd\.google-apps\.(document|spreadsheet)/.test(m || '');
  const canModelRead = m => /^application\/pdf$|^image\//.test(m || '') || /^text\//.test(m || '');

  /** מוריד קובץ ומחזיר base64 + mime שהמודל יכול לקרוא. */
  async function grab(student, f) {
    // Word/Sheets/Docs → PDF בשרת. preview עושה בדיוק את זה.
    const act = (isOffice(f.mimeType) || !canModelRead(f.mimeType)) ? 'preview' : 'download';
    const d = await drive(act, { studentId: student.id, fileId: f.id });
    if (!d || !d.dataB64) throw new Error('לא התקבל תוכן');
    const size = (d.size || 0) / 1024 / 1024;
    if (size > MAX_MB) throw new Error('גדול מדי (' + size.toFixed(1) + 'MB)');
    const mime = d.mimeType || f.mimeType;
    if (!canModelRead(mime)) throw new Error('סוג קובץ שאינו נתמך (' + mime + ')');
    // ⚠️ קובץ פגום אחד מפיל את *כל* הקריאה למודל ("The document has no
    // pages"), ואז 15 מסמכים תקינים הולכים לאיבוד. בודקים כאן את חתימת
    // הקובץ ומוציאים את הפגום לרשימת הכשלים במקום לשלוח אותו.
    const head = atob(String(d.dataB64).slice(0, 32));
    const bytes = [];
    for (let i = 0; i < Math.min(8, head.length); i++) bytes.push(head.charCodeAt(i));
    const isPdf = head.slice(0, 4) === '%PDF';
    const isJpg = bytes[0] === 0xFF && bytes[1] === 0xD8;
    const isPng = bytes[0] === 0x89 && head.slice(1, 4) === 'PNG';
    if (/pdf/.test(mime) && !isPdf) throw new Error('קובץ PDF פגום או ריק');
    if (/^image\/jpe?g/.test(mime) && !isJpg) throw new Error('תמונה פגומה');
    if (/^image\/png/.test(mime) && !isPng) throw new Error('תמונה פגומה');
    if ((d.size || 0) < 512) throw new Error('קובץ ריק');
    return { b64: d.dataB64, mime: mime };
  }

  /* ───────────────── קריאה למודל ───────────────── */

  // קריאה למודל דרך פרוקסי ה-Edge Function `ai` — למשתמשים שהסינון שלהם
  // חוסם את generativelanguage.googleapis.com מהדפדפן. אותו מפתח, אותו גוף;
  // רק הצינור שונה. דורש התחברות (הפונקציה מאמתת את ה-JWT).
  async function viaProxy(key, body, ctrl) {
    const cfg = window.CV3 || {};
    const base = cfg.SUPABASE_URL || '';
    let jwt = '';
    try {
      const s = window.sb && window.sb.auth && (await window.sb.auth.getSession());
      jwt = (s && s.data && s.data.session && s.data.session.access_token) || '';
    } catch (_) {}
    if (!base || !jwt) throw new Error('אין חיבור Supabase');
    return fetch(base + '/functions/v1/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
        'apikey': cfg.SUPABASE_ANON_KEY || '', 'Authorization': 'Bearer ' + jwt },
      body: JSON.stringify({ model: MODEL, key: key, body: body }),
      signal: ctrl && ctrl.signal,
    });
  }

  async function callModel(parts) {
    const k = (typeof window.geminiKey === 'function') ? window.geminiKey() : '';
    if (!k) throw new Error('אין מפתח AI מוגדר');
    const body = {
      systemInstruction: { parts: [{ text: SYS }] },
      contents: [{ parts: parts }],
      generationConfig: {
        temperature: 0.1, maxOutputTokens: 8000,
        responseMimeType: 'application/json', responseSchema: SCHEMA,
      },
    };
    // 429/503 = עומס או מגבלת קצב, לא תקלה אמיתית. בלי ריטריי, ריצה עם
    // כמה קבצים גורמת ל"כל הקבצים נכשלו" — וזה בדיוק מה שנעמי קיבלה.
    let r, d;
    for (let attempt = 0; ; attempt++) {
      // ⏱ timeout מפורש. בלעדיו קריאה שנתקעת משאירה את המסך על "מנתח
      // קבוצה 1 מתוך 1" לנצח, בלי שגיאה ובלי דרך לדעת מה קרה.
      const ctrl = new AbortController();
      const tmr = setTimeout(() => ctrl.abort(), 180000);
      try {
        r = await fetch(API + '?key=' + encodeURIComponent(k),
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: ctrl.signal });
      } catch (netErr) {
        clearTimeout(tmr);
        // כשל רשת בקריאה ישירה = כנראה סינון שחוסם את גוגל אצל המשתמש
        // (קרה לנעמי 1.9.26). מנסים דרך פרוקסי ה-Edge Function — Supabase
        // מאושר אצל כולם, אחרת לא היו מצליחים בכלל להתחבר למערכת.
        if (netErr.name !== 'AbortError') {
          try { r = await viaProxy(k, body, ctrl); } catch (_proxyErr) { r = null; }
        }
        if (!r) {
          if (attempt >= 2) throw new Error(netErr.name === 'AbortError'
            ? 'הניתוח לקח יותר מ-3 דקות ונעצר'
            : 'אין תקשורת עם שירות הניתוח');
          await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
          continue;
        }
      }
      clearTimeout(tmr);
      d = await r.json().catch(() => ({}));
      if (r.ok) break;
      const retryable = r.status === 429 || r.status === 500 || r.status === 503;
      if (!retryable || attempt >= 3) {
        throw new Error((d.error && d.error.message) || ('שגיאה ' + r.status));
      }
      await new Promise(res => setTimeout(res, 2500 * (attempt + 1)));
    }
    const txt = ((((d.candidates || [])[0] || {}).content || {}).parts || [])
      .map(p => p.text || '').join('').trim();
    if (!txt) throw new Error('לא התקבלה תשובה מהמודל');
    try {
      return JSON.parse(txt);
    } catch (_) {
      // ניסיון תיקון אחד — לפעמים חוזר עטוף בסימוני קוד
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch (_2) {} }
      throw new Error('התשובה מהמודל אינה JSON תקין');
    }
  }

  /* ───────────────── ניתוח בקבוצות ───────────────── */
  // 15 מסמכים בקריאה אחת חורגים מחלון הקלט, והמודל מחזיר שגיאה מבלבלת
  // ("The document has no pages") שנראית כמו קובץ פגום. לכן: קבוצות
  // קטנות, ואיחוד בקריאה נוספת. קבוצה שנכשלת נבדקת קובץ-קובץ, כך
  // שקובץ בעייתי בודד מזוהה בשמו במקום להפיל את כולם.
  // ⚠️ **הגודל נמדד ב-base64 ולא גולמי.** base64 מנפח ב-33%, ובגרסה הקודמת
  // הספירה היתה על הגולמי — ארבעה אבחונים של 2.5MB הפכו ל-3.4MB בגוף
  // הבקשה, וה-API החזיר 400 על כל האצווה. אצל אוליאל זה הפיל את כל ההרצה.
  // 2.5MB לאצווה משאיר מרווח בטוח גם לכותרת ולסכימה.
  const BATCH_MB = 2.5, BATCH_N = 3;

  function emptyOut() {
    return { 'רקע_ומגבלות': [], 'מנת_משכל': null, 'נתונים_סביבתיים': [],
             'מוקדים_לחיזוק': [], 'מוקדי_כוח': [], 'מסמכים_שנסרקו': [], 'התראות': [] };
  }

  async function runBatch(header, items) {
    const parts = [{ text: header }];
    items.forEach(it => {
      parts.push({ text: '\n=== קובץ: ' + it.name + ' ===\n' });
      parts.push({ inline_data: { mime_type: it.mime, data: it.b64 } });
    });
    return callModel(parts);
  }

  async function analyze(student, docs, onStep) {
    const header = 'ת.ז: ' + (student.tz || '—') + '\nשם: ' + nm(student) +
      '\nכיתה: ' + (student._cls || '') + '\n\nמסמכי האבחון:\n';
    const failed = [], scanned = [], loaded = [];

    for (let i = 0; i < docs.length; i++) {
      const f = docs[i];
      onStep('קורא (' + (i + 1) + '/' + docs.length + '): ' + f.name);
      try {
        const g = await grab(student, f);
        // mb = הנפח בפועל בגוף הבקשה (base64), לא גודל הקובץ המקורי
        loaded.push({ name: f.name, mime: g.mime, b64: g.b64, mb: g.b64.length / 1024 / 1024 });
      } catch (e) {
        failed.push({ name: f.name, why: e.message || String(e) });
      }
    }
    if (!loaded.length) {
      const why = failed.length ? (' — ' + failed.map(f => f.name + ': ' + f.why).join(' · ')) : '';
      const e = new Error('לא הצלחתי לקרוא אף מסמך' + why);
      e.code = 'ALL_FAILED'; e.failed = failed; throw e;
    }

    // חלוקה לקבוצות לפי נפח ומספר
    const batches = [];
    let cur = [], mb = 0;
    loaded.forEach(it => {
      if (cur.length && (cur.length >= BATCH_N || mb + it.mb > BATCH_MB)) { batches.push(cur); cur = []; mb = 0; }
      cur.push(it); mb += it.mb;
      // מסמך בודד שחורג מהתקרה נשלח לבדו — אין טעם לצרף לו עוד
      if (it.mb >= BATCH_MB) { batches.push(cur); cur = []; mb = 0; }
    });
    if (cur.length) batches.push(cur);

    const partials = [];
    for (let i = 0; i < batches.length; i++) {
      onStep('מנתח קבוצה ' + (i + 1) + ' מתוך ' + batches.length + '…');
      try {
        partials.push(await runBatch(header, batches[i]));
        batches[i].forEach(it => scanned.push(it.name));
      } catch (batchErr) {
        // הקבוצה נכשלה — מנסים קובץ-קובץ כדי לבודד את הבעייתי.
        // הסיבה נשמרת: "המודל לא הצליח לקרוא אותו" הסתיר גם 400 על נפח,
        // גם מפתח שפג, וגם קובץ פגום — שלושה דברים שונים לגמרי.
        console.warn('[tla-autofill] batch failed: ' + (batchErr.message || batchErr));
        for (const it of batches[i]) {
          onStep('בודק בנפרד: ' + it.name);
          try { partials.push(await runBatch(header, [it])); scanned.push(it.name); }
          catch (e2) { failed.push({ name: it.name, why: (e2.message || 'המודל לא הצליח לקרוא אותו').slice(0, 120) }); }
        }
      }
    }
    if (!partials.length) {
      const e = new Error('אף מסמך לא ניתן לניתוח.'); e.code = 'ALL_FAILED'; e.failed = failed; throw e;
    }

    // מיזוג: קבוצה אחת — כמו שהיא. יותר מאחת — קריאת איחוד.
    let out;
    if (partials.length === 1) {
      out = partials[0];
    } else {
      onStep('מאחד ' + partials.length + ' ניתוחים…');
      const merged = emptyOut();
      partials.forEach(pp => {
        Object.keys(merged).forEach(k => {
          if (Array.isArray(merged[k]) && Array.isArray(pp[k])) merged[k] = merged[k].concat(pp[k]);
        });
        if (!merged['מנת_משכל'] && pp['מנת_משכל']) merged['מנת_משכל'] = pp['מנת_משכל'];
      });
      try {
        out = await callModel([{ text:
          'לפניך כמה ניתוחים חלקיים של אותו תלמיד, שנעשו על קבוצות מסמכים נפרדות.\n' +
          'אחד אותם לניתוח יחיד: הסר כפילויות, שמור על הניסוח, ואל תוסיף מידע חדש.\n' +
          'שמור על אותו מבנה JSON.\n\n' + JSON.stringify(merged) }]);
      } catch (_) {
        out = merged;      // האיחוד נכשל — עדיף מיזוג פשוט מכלום
        out['התראות'] = (out['התראות'] || []).concat(['האיחוד האוטומטי נכשל — ייתכנו כפילויות']);
      }
    }

    // ולידציה: מנת משכל חייבת להופיע גם ברקע ומגבלות
    const iq = out['מנת_משכל'];
    if (iq && String(iq).trim() && String(iq).trim() !== 'null') {
      const arr = out['רקע_ומגבלות'] || (out['רקע_ומגבלות'] = []);
      const num = String(iq).match(/\d+/);
      const has = arr.some(x => num ? String(x).indexOf(num[0]) > -1 : String(x).indexOf(iq) > -1);
      if (!has) arr.unshift('מנת משכל: ' + iq);
    }
    out['מסמכים_שנסרקו'] = scanned;
    return { data: out, failed: failed, scanned: scanned };
  }

  /* ───────────────── ממשק ───────────────── */

  const asText = v => Array.isArray(v) ? v.map(x => '• ' + x).join('\n') : String(v || '');

  function paint(host, res) {
    const d = res.data;
    const warn = (d['התראות'] || []).filter(Boolean);
    const box = document.createElement('div');
    box.className = 'taf-result';
    box.innerHTML =
      '<div class="taf-head"><i class="bi bi-cloud-download"></i> נתונים שהוזמנו מהאבחונים' +
      '<span class="taf-badge">טעון אישור</span></div>' +
      (warn.length ? '<div class="taf-warn"><b><i class="bi bi-exclamation-triangle"></i> התראות — דורשות בדיקה ידנית</b><ul>' +
        warn.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' : '') +
      '<div class="taf-files"><b>נסרקו (' + res.scanned.length + '):</b> ' +
        esc(res.scanned.join(' · ')) +
        (res.failed.length ? '<div class="taf-failed"><b>נכשלו (' + res.failed.length + '):</b> ' +
          res.failed.map(f => esc(f.name) + ' — ' + esc(f.why)).join(' · ') + '</div>' : '') +
        ((res.skipped && res.skipped.length) ? '<div style="margin-top:4px"><b>לא נסרקו</b> (נבחרו האבחונים הרלוונטיים ביותר): ' +
          esc(res.skipped.join(' · ')) + '</div>' : '') +
      '</div>' +
      Object.keys(FIELD_MAP).map(k => {
        const v = asText(d[FIELD_MAP[k]]);
        // שדה שהמודל לא מצא לו מקור מסומן במפורש. קודם הוא פשוט הוצג ריק,
        // ואי אפשר היה לדעת אם לא נמצא כלום או שהריצה נכשלה באמצע.
        return '<div class="taf-fld"><label>' + esc(labelOf(k)) +
          (v ? '' : ' <span class="taf-none">לא נמצא באבחונים</span>') + '</label>' +
          '<textarea rows="6" data-taf="' + k + '">' + esc(v) + '</textarea></div>';
      }).join('') +
      '<div class="taf-actions">' +
        '<button class="btn-primary sm" data-taf-ok data-mode="replace"><i class="bi bi-check-lg"></i> החלף את התוכן</button>' +
        '<button class="btn-ghost sm" data-taf-ok data-mode="append"><i class="bi bi-plus-lg"></i> הוסף למה שכבר כתוב</button>' +
        '<button class="btn-ghost sm" data-taf-cancel>ביטול</button>' +
      '</div>';
    host.appendChild(box);
    return box;
  }
  const labelOf = k => ({ background: 'רקע ומגבלות', env: 'נתונים סביבתיים',
    focus: 'מוקדים לחיזוק', strengths: 'מוקדי כח' }[k] || k);

  function style() {
    if (document.getElementById('tafStyle')) return;
    const s = document.createElement('style'); s.id = 'tafStyle';
    s.textContent =
      '.taf-result{border:2px dashed var(--accent,#7c3aed);border-radius:12px;padding:14px;margin:12px 0;background:#fbfaff}' +
      '.taf-head{font-weight:700;color:var(--accent,#7c3aed);display:flex;align-items:center;gap:8px;margin-bottom:10px}' +
      '.taf-badge{background:#fde68a;color:#78350f;border-radius:20px;padding:2px 10px;font-size:.75rem;font-weight:700}' +
      '.taf-warn{background:#fffbeb;border:1px solid #fcd34d;border-inline-start:4px solid #f59e0b;' +
      'border-radius:8px;padding:10px 12px;margin-bottom:12px;color:#78350f;font-size:.9rem}' +
      '.taf-warn ul{margin:6px 0 0;padding-inline-start:18px}' +
      '.taf-files{font-size:.82rem;color:var(--muted,#6b7280);margin-bottom:12px;line-height:1.6}' +
      '.taf-failed{color:#b91c1c;margin-top:4px}' +
      '.taf-none{font-weight:400;font-size:.78rem;color:#b45309;background:#fff7ed;' +
      'border-radius:20px;padding:1px 8px;margin-inline-start:6px}' +
      '.taf-fld{margin-bottom:10px}' +
      '.taf-fld label{display:block;font-weight:600;margin-bottom:4px;font-size:.9rem}' +
      '.taf-fld textarea{width:100%;padding:9px 11px;border:1px solid var(--line,#d1d5db);border-radius:8px;font:inherit;line-height:1.65}' +
      '.taf-actions{display:flex;gap:8px;margin-top:6px}' +
      '.taf-busy{display:flex;align-items:center;gap:10px;padding:14px;color:var(--muted,#6b7280)}' +
      '.taf-log{margin-top:12px;max-height:320px;overflow:auto;font-size:.86rem}' +
      '.taf-bar{height:8px;background:var(--line,#e5e7eb);border-radius:6px;overflow:hidden;margin-bottom:6px}' +
      '.taf-bar i{display:block;height:100%;background:var(--accent,#7c3aed);transition:width .3s}' +
      '.taf-now{font-weight:600;margin-bottom:8px}' +
      '.taf-row{padding:3px 0;border-bottom:1px solid var(--line,#eee)}' +
      '.taf-row.bad{color:#b91c1c}' +
      '.taf-done{background:#dcfce7;color:#166534;padding:8px 12px;border-radius:8px;margin-bottom:8px}';
    document.head.appendChild(s);
  }

  /**
   * מחבר את הכפתור. onApply(values) נקרא רק בלחיצה על "אשר ושמור".
   */
  function mount(host, student, onApply) {
    style();
    const bar = document.createElement('div');
    bar.className = 'tla-bar';
    bar.innerHTML = '<button class="btn-ghost sm" id="tafRun">' +
      '<i class="bi bi-cloud-download"></i> הזמנת נתונים אוטומטית</button>' +
      '<span class="count-line" id="tafMsg"></span>';
    host.insertBefore(bar, host.firstChild);
    const msg = t => { bar.querySelector('#tafMsg').textContent = t || ''; };
    const btn = bar.querySelector('#tafRun');

    btn.addEventListener('click', async () => {
      host.querySelectorAll('.taf-result').forEach(e => e.remove());
      btn.disabled = true;
      const busy = document.createElement('div');
      busy.className = 'taf-busy';
      busy.innerHTML = '<i class="bi bi-hourglass-split"></i><span id="tafStep">מאתר מסמכים…</span>';
      host.insertBefore(busy, bar.nextSibling);
      const step = t => { const e = busy.querySelector('#tafStep'); if (e) e.textContent = t; };
      try {
        const found = await findDiagnosticDocs(student);
        step('נמצאו ' + found.docs.length + ' מסמכים ב"מסמך קביל"' +
          (found.skipped && found.skipped.length ? ' (עוד ' + found.skipped.length + ' דולגו)' : ''));
        const res = await analyze(student, found.docs, step);
        res.skipped = found.skipped || [];
        busy.remove();
        const box = paint(host, res);
        box.querySelector('[data-taf-cancel]').addEventListener('click', () => { box.remove(); msg(''); });
        box.querySelectorAll('[data-taf-ok]').forEach(b => b.addEventListener('click', () => {
          const vals = {};
          box.querySelectorAll('[data-taf]').forEach(t => { vals[t.dataset.taf] = t.value.trim(); });
          onApply(vals, b.dataset.mode);
          box.remove();
          msg('הועתק לשדות — עדיין צריך ללחוץ "שמירת דף ההכנה"');
        }));
        msg('');
      } catch (e) {
        busy.remove();
        const hints = {
          NO_FOLDER: 'צריך לשייך לתלמיד תיקייה בדרייב דרך "תיק מסמכים".',
          NO_DIAG_FOLDER: 'התיקיות שקיימות: ' + ((e.have || []).join(', ') || 'אין תיקיות משנה') + '.',
          EMPTY: 'צריך להעלות לשם את מסמכי האבחון.',
          ALL_FAILED: (e.failed || []).map(f => f.name + ' — ' + f.why).join(' · '),
        };
        const extra = hints[e.code] ? ('<div style="margin-top:6px;font-size:.85rem;opacity:.85">' + esc(hints[e.code]) + '</div>') : '';
        const err = document.createElement('div');
        err.className = 'taf-warn';
        err.style.borderColor = '#fca5a5'; err.style.background = '#fef2f2'; err.style.color = '#7f1d1d';
        err.innerHTML = '<b><i class="bi bi-x-octagon"></i> ' + esc(e.message || 'שגיאה') + '</b>' + extra;
        host.insertBefore(err, bar.nextSibling);
        setTimeout(() => err.remove(), 15000);
        // ללוג נכנס רק סוג התקלה — לא תוכן מסמכים
        console.warn('[tla-autofill] ' + (e.code || 'ERR'));
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ───────────── הרצה על כל התלמידים ───────────── */
  // ⚠️ התוצאה נשמרת כטיוטה ב-tla_profile_drafts, **לא** בתיק. אף שדה
  // בכרטיס לא משתנה עד שאדם פותח, קורא, ומאשר. זה נכון גם בהרצה בודדת
  // וגם כאן — אחרת 37 תיקים היו מתמלאים בטקסט שאיש לא קרא.
  async function runForStudent(student) {
    const found = await findDiagnosticDocs(student);
    const res = await analyze(student, found.docs, () => {});
    const row = {
      student_id: student.id,
      data: res.data,
      scanned: res.scanned,
      failed: res.failed,
      skipped: found.skipped || [],
      status: 'draft',
    };
    const cur = (await window.store.list('tla_profile_drafts'))
      .find(d => d.student_id === student.id);
    if (cur) await window.store.update('tla_profile_drafts', cur.id, row);
    else await window.store.add('tla_profile_drafts', row);
    return res;
  }

  /**
   * מריץ על רשימת תלמידים, אחד-אחד. onProgress(i, total, name, status).
   * סדרתי בכוונה: הרצה מקבילה מגיעה למגבלת הקצב של המודל, ואז *הכל* נכשל.
   */
  async function runAll(students, onProgress, shouldStop) {
    const done = [], failed = [];
    for (let i = 0; i < students.length; i++) {
      if (shouldStop && shouldStop()) break;
      const s = students[i];
      onProgress(i + 1, students.length, nm(s), 'עובד…');
      try {
        const r = await runForStudent(s);
        done.push({ name: nm(s), scanned: r.scanned.length });
        onProgress(i + 1, students.length, nm(s), 'נוצרה טיוטה (' + r.scanned.length + ' מסמכים)');
      } catch (e) {
        failed.push({ name: nm(s), why: e.message || String(e) });
        onProgress(i + 1, students.length, nm(s), 'נכשל: ' + (e.message || ''));
      }
      // נשימה בין תלמידים — מוריד את הסיכוי למגבלת קצב
      await new Promise(r => setTimeout(r, 1500));
    }
    return { done: done, failed: failed };
  }

  async function draftFor(studentId) {
    const all = await window.store.list('tla_profile_drafts');
    return all.find(d => d.student_id === studentId && d.status === 'draft') || null;
  }

  /* ───────────── מסך ההרצה הקבוצתית ───────────── */
  async function batchModal() {
    style();
    const [students, classes, drafts] = await Promise.all([
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
      window.store.list('classes'),
      window.store.list('tla_profile_drafts'),
    ]);
    const has = id => drafts.some(d => d.student_id === id && d.status === 'draft');
    const clsName = id => { const c = classes.find(x => x.id == id); return c ? c.name : 'ללא שיעור'; };
    const m = window.UI.modal({
      title: 'הזמנת נתונים אוטומטית לכל התלמידים', saveLabel: 'התחל',
      bodyHTML:
        '<p style="margin:0 0 10px">המערכת תעבור תלמיד-תלמיד, תקרא את האבחונים ' +
        'שב"מסמך קביל", ותכין <b>טיוטה</b> לדף ההכנה.</p>' +
        '<div class="taf-warn" style="margin-bottom:10px">' +
        '<b><i class="bi bi-info-circle"></i> חשוב לדעת</b><ul>' +
        '<li>שום דבר <b>לא</b> נכנס לתיק התלמיד. כל טיוטה טעונה אישור בנפרד.</li>' +
        '<li>ההרצה אורכת כדקה עד שתיים לתלמיד. אין לסגור את החלון באמצע.</li>' +
        '<li>תלמיד ללא אבחונים ב"מסמך קביל" יסומן ככישלון — וזה מידע שימושי.</li>' +
        '</ul></div>' +
        '<label class="fld fld-wide"><span>על מי להריץ</span><select class="inp mb0" id="tb_scope">' +
          '<option value="new">רק מי שאין לו טיוטה (' + students.filter(s => !has(s.id)).length + ')</option>' +
          '<option value="all">כל התלמידים (' + students.length + ')</option>' +
          classes.map(c => '<option value="c' + c.id + '">' + esc(c.name) + ' (' +
            students.filter(s => s.class_id == c.id).length + ')</option>').join('') +
        '</select></label>' +
        '<div id="tb_log" class="taf-log" hidden></div>',
      onSave: async (el) => {
        const v = el.querySelector('#tb_scope').value;
        const list = v === 'all' ? students
          : v === 'new' ? students.filter(s => !has(s.id))
          : students.filter(s => String(s.class_id) === v.slice(1));
        if (!list.length) { window.UI.toast('אין תלמידים לפי הבחירה', 'err'); return false; }

        const log = el.querySelector('#tb_log');
        log.hidden = false;
        el.querySelector('#tb_scope').disabled = true;
        const save = el.querySelector('[data-act="save"]');
        let stop = false;
        save.textContent = 'עצור';
        save.onclick = e => { e.preventDefault(); e.stopPropagation(); stop = true; save.textContent = 'עוצר…'; };

        const line = (i, n, name, st) => {
          const p = Math.round((i / n) * 100);
          log.innerHTML = '<div class="taf-bar"><i style="width:' + p + '%"></i></div>' +
            '<div class="taf-now">' + i + '/' + n + ' · ' + esc(name) + ' — ' + esc(st) + '</div>' +
            log.dataset.hist;
          log.dataset.hist = (st.indexOf('עובד') === 0 ? '' :
            '<div class="taf-row' + (st.indexOf('נכשל') === 0 ? ' bad' : '') + '">' +
            esc(name) + ' — ' + esc(st) + '</div>') + (log.dataset.hist || '');
        };
        log.dataset.hist = '';
        const res = await runAll(list, line, () => stop);
        log.innerHTML = '<div class="taf-done"><b>הסתיים.</b> נוצרו ' + res.done.length +
          ' טיוטות' + (res.failed.length ? ', ' + res.failed.length + ' נכשלו' : '') + '.</div>' +
          (res.failed.length ? '<div class="taf-failed">' +
            res.failed.map(f => esc(f.name) + ' — ' + esc(f.why)).join('<br>') + '</div>' : '') +
          log.dataset.hist;
        save.textContent = 'סגור';
        save.onclick = () => m.close();
        return false;                       // לא סוגרים — שיראו את הסיכום
      },
    });
  }

  /* ───────────── פאנל הטיוטות הממתינות ───────────── */
  // ⚠️ 10 מתוך 13 הטיוטות שייכות לתלמידים שאין להם עדיין תכנית תל"א,
  // ולכן אין דף הכנה לפתוח והן היו בלתי נגישות. הפאנל הזה מציג את כולן
  // במסך התל"א, ואישור יוצר את התכנית אם היא חסרה.
  async function draftsPanel(host, onChange) {
    style();
    const [drafts, students, classes] = await Promise.all([
      window.store.list('tla_profile_drafts'),
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
      window.store.list('classes'),
    ]);
    const open = (drafts || []).filter(d => d.status === 'draft');
    const old = host.querySelector('#tafPanel');
    if (old) old.remove();
    if (!open.length) return;

    const stuOf = id => students.find(s => s.id === id);
    const clsOf = s => { const c = classes.find(x => x.id == (s || {}).class_id); return c ? c.name : ''; };
    open.sort((x, y) => {
      const A = stuOf(x.student_id) || {}, B = stuOf(y.student_id) || {};
      return String(clsOf(A)).localeCompare(String(clsOf(B)), 'he') ||
             String(A.family || '').localeCompare(String(B.family || ''), 'he');
    });

    const box = document.createElement('div');
    box.id = 'tafPanel';
    box.className = 'qr-card';
    box.style.borderInlineStart = '4px solid var(--accent,#7c3aed)';
    box.innerHTML =
      '<h3><i class="bi bi-cloud-download"></i> נתונים שהוזמנו — ממתינים לאישור ' +
      '<span class="det-badge">' + open.length + '</span></h3>' +
      '<p class="tl-note" style="margin:.2rem 0 .7rem;font-size:.86rem">' +
      'נוצרו אוטומטית מהאבחונים. שום דבר לא נכנס לתיק עד אישור.</p>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th style="width:44px">#</th><th>תלמיד</th><th>שיעור</th><th>מסמכים</th>' +
      '<th>מנת משכל</th><th>התראות</th><th></th></tr></thead><tbody>' +
      open.map((d, i) => {
        const s = stuOf(d.student_id) || {};
        const iq = (d.data && d.data['מנת_משכל']) || '';
        const w = ((d.data && d.data['התראות']) || []).length;
        return '<tr><td class="idx">' + (i + 1) + '</td>' +
          '<td><b>' + esc(nm(s)) + '</b></td><td>' + esc(clsOf(s)) + '</td>' +
          '<td>' + ((d.scanned || []).length) + '</td>' +
          '<td>' + esc(iq && iq !== 'null' ? iq : '—') + '</td>' +
          '<td>' + (w ? '<span class="chip off">' + w + '</span>' : '—') + '</td>' +
          '<td class="row-act"><button class="btn-ghost sm" data-tafopen="' + d.id + '">' +
          '<i class="bi bi-eye"></i> בדיקה ואישור</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    // מעל הרשימה עצמה, מתחת לסרגל הסינון — לא בראש הדף
    const anchor = host.querySelector('#tlaList');
    host.insertBefore(box, anchor || host.firstChild);

    box.querySelectorAll('[data-tafopen]').forEach(b => b.addEventListener('click', () => {
      const d = open.find(x => String(x.id) === b.dataset.tafopen);
      reviewModal(d, stuOf(d.student_id), onChange);
    }));
  }

  /** חלון בדיקה לטיוטה בודדת. אישור יוצר תכנית תל"א אם אין. */
  function reviewModal(d, student, onChange) {
    const res = { data: d.data, scanned: d.scanned || [], failed: d.failed || [], skipped: d.skipped || [] };
    const m = window.UI.modal({
      title: 'טיוטת דף הכנה — ' + nm(student),
      bodyHTML: '<div id="tafHost"></div>',
      saveLabel: null,
    });
    m.el.classList.add('modal-wide');
    const host = m.el.querySelector('#tafHost');
    const box = paint(host, res);
    box.querySelector('[data-taf-cancel]').textContent = 'דחיית הטיוטה';
    box.querySelector('[data-taf-cancel]').addEventListener('click', async () => {
      if (!await window.UI.confirm('לדחות את הטיוטה? היא תימחק.')) return;
      await window.store.update('tla_profile_drafts', d.id, { status: 'rejected' });
      m.close(); if (onChange) onChange();
    });
    box.querySelector('[data-taf-ok]').addEventListener('click', async () => {
      const vals = {};
      box.querySelectorAll('[data-taf]').forEach(t => { vals[t.dataset.taf] = t.value.trim(); });
      const btn = box.querySelector('[data-taf-ok]');
      btn.disabled = true; btn.textContent = 'שומר…';
      try {
        // תכנית תל"א חסרה — יוצרים אחת, אחרת אין לאן לשמור את הפרופיל
        const plans = await window.store.byStudent('tla_plans', student.id);
        let plan = (plans || [])[0];
        if (!plan) {
          const year = window.UI.hebYear ? window.UI.hebYear() : '';
          const r = await window.store.add('tla_plans', {
            student_id: student.id, year_label: year, status: 'טיוטה',
            profile: vals, slots: [],
          });
          plan = r && r.data && r.data[0];
          if (!plan) throw new Error('יצירת התל"א נכשלה');
        } else {
          const prof = Object.assign({}, plan.profile || {}, vals);
          const u = await window.store.update('tla_plans', plan.id, { profile: prof });
          if (!u || u.ok === false) throw new Error('השמירה נכשלה');
        }
        await window.store.update('tla_profile_drafts', d.id,
          { status: 'applied', applied_at: new Date().toISOString() });
        window.UI.toast('נשמר לדף ההכנה של ' + nm(student));
        m.close(); if (onChange) onChange();
      } catch (e) {
        window.UI.toast(e.message || 'נכשל', 'err');
        btn.disabled = false; btn.textContent = 'אשר ושמור לתיק';
      }
    });
  }

  window.cv3TlaAutofill = { mount, findDiagnosticDocs, analyze, FIELD_MAP,
    runForStudent: runForStudent, runAll: runAll, draftFor: draftFor,
    paint: paint, batchModal: batchModal, draftsPanel: draftsPanel };
})();
