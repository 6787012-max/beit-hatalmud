// ai-insights.js — ניתוחי AI על נתוני המערכת (2026-08-21, בקשת יוסף).
//
// שלושה שימושים:
//   1. סיכום AI לכל תלמיד בכרטיס שלו.
//   2. סיכום כללי על המוסד במסך הבית.
//   3. הזנת נתונים לעוזר החכם, כדי שיוכל לענות על שאלות ולבנות טבלאות.
//
// ⚠️ הרשאות: כל הנתונים נאספים דרך `window.store` בשם המשתמש המחובר, כלומר
// עוברים דרך ה-RLS בשרת. מחנך יקבל סיכום רק על מה שמותר לו לראות, בלי שום
// לוגיקה מיוחדת כאן. **אין להשתמש כאן במפתח שירות או בשאילתות עוקפות.**
//
// פרטיות: לניתוח נשלחים שם התלמיד ונתונים מצטברים (נוכחות, מבחנים, מעקב).
// **לא נשלחים** ת"ז, טלפונים, כתובות ותוכן מסמכים רפואיים.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MODEL = 'gemini-2.5-flash';
  const API = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s && s.name) || '';
  // מסמכי החובה בכל תיק (אפיון + החלטת ועדה שנעמי הוסיפה) — זהה ל-student-docs.js
  const NEED = ['ויתור סודיות', 'שאלון הפניה', 'אבחונים ורקע קודם', 'מסמך קביל', 'החלטת ועדה'];

  function key() {
    try { if (typeof window.geminiKey === 'function') return window.geminiKey(); } catch (_) {}
    try { return localStorage.getItem('cv3_gemini_key') || ''; } catch (_) { return ''; }
  }

  async function gemini(prompt, maxTokens) {
    const k = key();
    if (!k) throw new Error('אין מפתח AI מוגדר');
    const res = await fetch(API + '?key=' + encodeURIComponent(k), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens || 700 },
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error((d.error && d.error.message) || ('שגיאה ' + res.status));
    const t = (((d.candidates || [])[0] || {}).content || {}).parts || [];
    const out = t.map(p => p.text || '').join('').trim();
    if (!out) throw new Error('לא התקבלה תשובה');
    return out;
  }

  // ── מטמון: מייצרים מחדש רק כשהנתונים באמת השתנו ──
  // "סיכום בכל פתיחה" לא אמור להיות קריאה לרשת בכל פתיחה: חתימה על הנתונים
  // מספיקה כדי לדעת אם משהו זז מאז הפעם הקודמת.
  function cacheGet(k, sig) {
    try {
      const raw = localStorage.getItem('cv3ai_' + k);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return o && o.sig === sig ? o : null;
    } catch (_) { return null; }
  }
  function cacheSet(k, sig, text) {
    try { localStorage.setItem('cv3ai_' + k, JSON.stringify({ sig: sig, text: text, at: Date.now() })); } catch (_) {}
  }
  const ago = ts => {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'עכשיו';
    if (m < 60) return 'לפני ' + m + ' דק׳';
    const h = Math.round(m / 60);
    return h < 24 ? 'לפני ' + h + ' שעות' : 'לפני ' + Math.round(h / 24) + ' ימים';
  };

  // markdown מינימלי: כותרות, רשימות, מודגש וטבלאות — כדי שהמודל יוכל להחזיר טבלה
  function md(t) {
    const lines = String(t || '').split('\n');
    let html = '', tbl = null;
    const flush = () => {
      if (!tbl) return;
      html += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        tbl.head.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
        tbl.rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>';
      tbl = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (/^\|.*\|$/.test(ln)) {
        const cells = ln.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (/^[\s|:-]+$/.test(ln)) continue;                       // שורת המפריד
        if (!tbl) tbl = { head: cells, rows: [] }; else tbl.rows.push(cells);
        continue;
      }
      flush();
      if (!ln) { html += ''; continue; }
      const b = esc(ln).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      if (/^#{1,3}\s/.test(ln)) html += '<h4 style="margin:10px 0 4px">' + b.replace(/^#+\s*/, '') + '</h4>';
      else if (/^[-•*]\s/.test(ln)) html += '<div style="margin:2px 0">• ' + b.replace(/^[-•*]\s*/, '') + '</div>';
      else html += '<p style="margin:6px 0">' + b + '</p>';
    }
    flush();
    return html;
  }

  // ───────────────────────── איסוף נתונים (מוגבל RLS) ─────────────────────────
  async function studentData(s) {
    const S = window.store;
    const [att, beh, tests, cats, ra, raCats, tla, docs, med] = await Promise.all([
      S.byStudent('attendance', s.id), S.byStudent('behavior_events', s.id),
      S.byStudent('tests', s.id), S.list('categories'),
      S.byStudent('reading_assessments', s.id),
      window.cv3ReadAssess ? window.cv3ReadAssess.cats() : Promise.resolve([]),
      window.cv3Tla ? window.cv3Tla.forStudent(s.id) : Promise.resolve({ plans: [], goals: [] }),
      S.byStudent('student_docs', s.id),
      S.byStudent('medications', s.id),
    ]);
    const c = k => att.filter(a => a.status === k).length;
    const present = c('נוכח'), late = c('איחור'), absent = c('חיסור') + c('נעדר');
    const tot = present + late + absent;
    const catName = id => { const x = cats.find(y => y.id == id); return x ? x.name : ''; };
    const grades = tests.map(t => Number(t.grade)).filter(x => !isNaN(x));
    const last = ra.slice().sort((a, b) => String(b.assessed_on || '').localeCompare(String(a.assessed_on || '')))[0];
    return {
      sig: [att.length, beh.length, tests.length, ra.length, (tla.goals || []).length, docs.length, med.length].join('-'),
      text: [
        'תלמיד: ' + nm(s),
        'נוכחות: ' + (tot ? (present + ' נוכח, ' + late + ' איחורים, ' + absent + ' חיסורים (' +
          Math.round(((present + late) / tot) * 100) + '% הגעה)') : 'אין רישומים'),
        'דיווחי מעקב: ' + (beh.length ? beh.slice(-8).map(e =>
          (catName(e.category_id) || 'דיווח') + (e.note ? ' — ' + e.note : '')).join(' | ') : 'אין'),
        'מבחנים: ' + (grades.length ? (grades.length + ' מבחנים, ממוצע ' +
          Math.round(grades.reduce((a, b) => a + b, 0) / grades.length)) : 'אין'),
        'מעקב קריאה: ' + (last ? raCats.map(k => k.name + ' ' + ((last.scores || {})[k.id] != null ? (last.scores || {})[k.id] : '—')).join(', ') : 'אין'),
        'תל"א: ' + ((tla.plans || []).length ? ((tla.goals || []).length + ' תחומים, סטטוס ' + ((tla.plans[0] || {}).status || '')) : 'אין תוכנית'),
        'רפואי: ' + (med.length ? med.map(m => m.name).join(', ') : 'אין'),
        'תיק מסמכים: ' + (docs.length ? (docs.length + ' פריטים') : 'ריק'),
      ].join('\n'),
    };
  }

  async function orgData() {
    const S = window.store;
    const [students, classes, att, beh, tests, tla, docs] = await Promise.all([
      window.cv3Students ? window.cv3Students.getStudents() : S.list('students'),
      S.list('classes'), S.list('attendance'), S.list('behavior_events'),
      S.list('tests'), S.list('tla_plans'), S.list('student_docs'),
    ]);
    const clsName = id => { const c = classes.find(x => x.id == id); return c ? c.name : 'ללא כיתה'; };
    const byCls = {};
    students.forEach(s => { const k = clsName(s.class_id); (byCls[k] = byCls[k] || []).push(s); });
    const cnt = (arr, k) => arr.filter(a => a.status === k).length;
    const lines = ['מוסד: ' + ((window.CV3 || {}).INSTANCE_NAME || ''),
      'סה"כ תלמידים שאני רואה: ' + students.length + ' ב-' + Object.keys(byCls).length + ' כיתות'];
    Object.keys(byCls).forEach(k => {
      const ids = byCls[k].map(s => s.id);
      const a = att.filter(x => ids.includes(x.student_id));
      const p = cnt(a, 'נוכח'), l = cnt(a, 'איחור'), ab = cnt(a, 'חיסור') + cnt(a, 'נעדר');
      const t = p + l + ab;
      const g = tests.filter(x => ids.includes(x.student_id)).map(x => Number(x.grade)).filter(x => !isNaN(x));
      lines.push('- ' + k + ': ' + ids.length + ' תלמידים' +
        (t ? (', ' + Math.round(((p + l) / t) * 100) + '% הגעה (' + ab + ' חיסורים)') : ', אין נוכחות') +
        (g.length ? (', ממוצע מבחנים ' + Math.round(g.reduce((x, y) => x + y, 0) / g.length)) : '') +
        ', ' + beh.filter(x => ids.includes(x.student_id)).length + ' דיווחי מעקב' +
        ', ' + tla.filter(x => ids.includes(x.student_id)).length + ' תוכניות תל"א');
    });
    const noDocs = students.filter(s => !docs.some(d => d.student_id === s.id)).length;
    lines.push('תלמידים בלי תיק מסמכים: ' + noDocs);
    return { sig: [students.length, att.length, beh.length, tests.length, tla.length, docs.length].join('-'),
             text: lines.join('\n'), students: students, classes: classes };
  }

  // ───────────────────────── סיכום תלמיד ─────────────────────────
  const STU_PROMPT = 'אתה עוזר פדגוגי בישיבה/מכינה. לפניך נתוני תלמיד מתוך מערכת המעקב. ' +
    'כתוב בעברית סיכום קצר (עד 6 שורות) בשלושה חלקים קצרים: **תמונת מצב**, **נקודות לחיזוק**, **המלצה לצוות**. ' +
    'הסתמך אך ורק על הנתונים שמופיעים כאן, בלי להמציא. אם אין מספיק נתונים — אמור זאת במשפט אחד. ' +
    'אל תאבחן ואל תיתן חוות דעת רפואית. כתוב ענייני ומכבד.\n\nנתונים:\n';

  async function renderStudent(host, student) {
    if (!host) return;
    host.innerHTML = '<div class="ld"><i class="bi bi-stars"></i> מנתח…</div>';
    try {
      const d = await studentData(student);
      const ck = 'stu' + student.id;
      let hit = cacheGet(ck, d.sig);
      if (!hit) {
        const txt = await gemini(STU_PROMPT + d.text, 600);
        cacheSet(ck, d.sig, txt);
        hit = cacheGet(ck, d.sig) || { text: txt, at: Date.now() };
      }
      host.innerHTML = md(hit.text) +
        '<div class="tl-note" style="font-size:.72rem;margin-top:6px">נוצר ע"י AI · ' + ago(hit.at) +
        ' · <a href="#" data-airefresh>רענון</a></div>';
      const r = host.querySelector('[data-airefresh]');
      if (r) r.addEventListener('click', e => {
        e.preventDefault();
        try { localStorage.removeItem('cv3ai_' + ck); } catch (_) {}
        renderStudent(host, student);
      });
    } catch (e) {
      host.innerHTML = '<div class="tl-note" style="color:#b91c1c">לא ניתן להפיק סיכום כרגע (' + esc(e.message || e) + ')</div>';
    }
  }

  // ───────────────────────── סיכום מוסד ─────────────────────────
  const ORG_PROMPT = 'אתה עוזר ניהולי במכינה. לפניך תמונת מצב מצטברת מהמערכת. ' +
    'כתוב בעברית סיכום קצר למנהל (עד 7 שורות): **מה תקין**, **מה דורש תשומת לב**, **צעד מומלץ אחד**. ' +
    'הסתמך רק על הנתונים. אם חסרים נתונים — ציין זאת קצר.\n\nנתונים:\n';

  async function renderOrg(host) {
    if (!host) return;
    host.innerHTML = '<div class="ld"><i class="bi bi-stars"></i> מנתח את נתוני המוסד…</div>';
    try {
      const d = await orgData();
      let hit = cacheGet('org', d.sig);
      if (!hit) {
        const txt = await gemini(ORG_PROMPT + d.text, 700);
        cacheSet('org', d.sig, txt);
        hit = cacheGet('org', d.sig) || { text: txt, at: Date.now() };
      }
      host.innerHTML = md(hit.text) +
        '<div class="tl-note" style="font-size:.72rem;margin-top:6px">נוצר ע"י AI לפי ההרשאות שלך · ' + ago(hit.at) +
        ' · <a href="#" data-airefresh>רענון</a></div>';
      const r = host.querySelector('[data-airefresh]');
      if (r) r.addEventListener('click', e => {
        e.preventDefault();
        try { localStorage.removeItem('cv3ai_org'); } catch (_) {}
        renderOrg(host);
      });
    } catch (e) {
      host.innerHTML = '<div class="tl-note" style="color:#b91c1c">לא ניתן להפיק סיכום כרגע (' + esc(e.message || e) + ')</div>';
    }
  }

  // ───────────── הקשר נתונים לעוזר החכם (שאלות וטבלאות) ─────────────
  // נבנה פעם אחת לכל פתיחה של העוזר. שוב — הכל דרך ה-RLS של המשתמש.
  let _ctx = null, _ctxAt = 0;
  async function dataContext() {
    if (_ctx && Date.now() - _ctxAt < 120000) return _ctx;
    const S = window.store;
    const [students, classes, att, tests, docs] = await Promise.all([
      window.cv3Students ? window.cv3Students.getStudents() : S.list('students'),
      S.list('classes'), S.list('attendance'), S.list('tests'), S.list('student_docs'),
    ]);
    const clsName = id => { const c = classes.find(x => x.id == id); return c ? c.name : ''; };
    const rows = students.map(s => {
      const a = att.filter(x => x.student_id === s.id);
      const p = a.filter(x => x.status === 'נוכח').length, l = a.filter(x => x.status === 'איחור').length;
      const ab = a.filter(x => x.status === 'חיסור' || x.status === 'נעדר').length;
      const g = tests.filter(x => x.student_id === s.id).map(x => Number(x.grade)).filter(x => !isNaN(x));
      // אילו מהמסמכים שהאפיון מחייב חסרים — זו השאלה שנשאלת בפועל הכי הרבה
      const mine = docs.filter(d => d.student_id === s.id);
      const miss = NEED.filter(k => !mine.some(d => String(d.kind || '') === k));
      return [nm(s), clsName(s.class_id), (p + l + ab) ? Math.round(((p + l) / (p + l + ab)) * 100) + '%' : '—',
        ab, g.length ? Math.round(g.reduce((x, y) => x + y, 0) / g.length) : '—',
        mine.length, miss.length ? miss.join(' + ') : 'הכל קיים'];
    });
    // הערה חשובה למודל: הנתונים המפורטים (נוכחות/מבחנים/תיק) מגיעים מהשרת אחרי
    // סינון הרשאות. שורה ריקה אצל מורה פירושה "אין לך גישה", לא "אין נתונים".
    _ctx = 'טבלת התלמידים שאתה רשאי לראות ' +
      '(שם | כיתה | % הגעה | חיסורים | ממוצע מבחנים | פריטים בתיק | מסמכי חובה חסרים):\n' +
      rows.map(r => '- ' + r.join(' | ')).join('\n') +
      '\n\nהערה: אם אצל תלמיד מופיע "—" וגם 0 פריטים בתיק, ייתכן שפשוט אין למשתמש ' +
      'הרשאה לנתונים של אותו תלמיד. במקרה כזה כתוב "אין גישה" ולא "אין נתונים".';
    _ctxAt = Date.now();
    return _ctx;
  }

  window.cv3AI = { renderStudent, renderOrg, dataContext, gemini, md, orgData };
})();
