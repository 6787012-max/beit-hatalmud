// tla-autofill.js — "מלא אוטומטית מהאבחונים" בדף ההכנה של התל"א (2026-08-24).
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
    const docs = all.filter(f => f.mimeType !== FOLDER && ids.indexOf(f.folderId) > -1);
    if (!docs.length) {
      const e = new Error('תיקיית "מסמך קביל" של ' + nm(student) + ' ריקה.');
      e.code = 'EMPTY'; throw e;
    }
    return { docs: docs, foldersFound: wanted.map(f => f.name) };
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
    const r = await fetch(API + '?key=' + encodeURIComponent(k),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error((d.error && d.error.message) || ('שגיאה ' + r.status));
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
  const BATCH_MB = 6, BATCH_N = 4;

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
        loaded.push({ name: f.name, mime: g.mime, b64: g.b64, mb: g.b64.length * 0.75 / 1024 / 1024 });
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
    });
    if (cur.length) batches.push(cur);

    const partials = [];
    for (let i = 0; i < batches.length; i++) {
      onStep('מנתח קבוצה ' + (i + 1) + ' מתוך ' + batches.length + '…');
      try {
        partials.push(await runBatch(header, batches[i]));
        batches[i].forEach(it => scanned.push(it.name));
      } catch (_) {
        // הקבוצה נכשלה — מנסים קובץ-קובץ כדי לבודד את הבעייתי
        for (const it of batches[i]) {
          onStep('בודק בנפרד: ' + it.name);
          try { partials.push(await runBatch(header, [it])); scanned.push(it.name); }
          catch (e2) { failed.push({ name: it.name, why: 'המודל לא הצליח לקרוא אותו' }); }
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
      '<div class="taf-head"><i class="bi bi-magic"></i> טיוטה שנוצרה אוטומטית מהאבחונים' +
      '<span class="taf-badge">טעון אישור</span></div>' +
      (warn.length ? '<div class="taf-warn"><b><i class="bi bi-exclamation-triangle"></i> התראות — דורשות בדיקה ידנית</b><ul>' +
        warn.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' : '') +
      '<div class="taf-files"><b>נסרקו (' + res.scanned.length + '):</b> ' +
        esc(res.scanned.join(' · ')) +
        (res.failed.length ? '<div class="taf-failed"><b>נכשלו (' + res.failed.length + '):</b> ' +
          res.failed.map(f => esc(f.name) + ' — ' + esc(f.why)).join(' · ') + '</div>' : '') +
      '</div>' +
      Object.keys(FIELD_MAP).map(k =>
        '<div class="taf-fld"><label>' + esc(labelOf(k)) + '</label>' +
        '<textarea rows="6" data-taf="' + k + '">' + esc(asText(d[FIELD_MAP[k]])) + '</textarea></div>').join('') +
      '<div class="taf-actions">' +
        '<button class="btn-primary sm" data-taf-ok><i class="bi bi-check-lg"></i> אשר ושמור לתיק</button>' +
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
      '.taf-fld{margin-bottom:10px}' +
      '.taf-fld label{display:block;font-weight:600;margin-bottom:4px;font-size:.9rem}' +
      '.taf-fld textarea{width:100%;padding:9px 11px;border:1px solid var(--line,#d1d5db);border-radius:8px;font:inherit;line-height:1.65}' +
      '.taf-actions{display:flex;gap:8px;margin-top:6px}' +
      '.taf-busy{display:flex;align-items:center;gap:10px;padding:14px;color:var(--muted,#6b7280)}';
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
      '<i class="bi bi-magic"></i> מלא אוטומטית מהאבחונים</button>' +
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
        step('נמצאו ' + found.docs.length + ' מסמכים ב-' + found.foldersFound.join(', '));
        const res = await analyze(student, found.docs, step);
        busy.remove();
        const box = paint(host, res);
        box.querySelector('[data-taf-cancel]').addEventListener('click', () => { box.remove(); msg(''); });
        box.querySelector('[data-taf-ok]').addEventListener('click', () => {
          const vals = {};
          box.querySelectorAll('[data-taf]').forEach(t => { vals[t.dataset.taf] = t.value.trim(); });
          onApply(vals);
          box.remove();
          msg('הועתק לשדות — עדיין צריך ללחוץ "שמירת דף ההכנה"');
        });
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

  window.cv3TlaAutofill = { mount, findDiagnosticDocs, analyze, FIELD_MAP };
})();
