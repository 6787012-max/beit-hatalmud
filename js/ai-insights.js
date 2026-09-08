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
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s && s.name) || '';
  // מסמכי החובה בכל תיק (אפיון + החלטת ועדה שנעמי הוסיפה) — זהה ל-student-docs.js
  const NEED = ['ויתור סודיות', 'שאלון הפניה', 'אבחונים ורקע קודם', 'מסמך קביל', 'החלטת ועדה'];

  // עקרונות משיטת "לא ניתן החינוך למלאכי השרת" (הרב אריה אינדורסקי, מכון
  // הורני) — נוספו 2026-09-08 לבקשת יוסף, אותו METHOD_PROMPT שכבר בשימוש
  // ב-cheder-maale-amos/js/ai-report.js. "בשביל מה" ולא "למה", אבחון בין
  // תשומת לב עודפת למאבק כוח, עין טובה, אחריות בצעד קטן מתוך אמון.
  const METHOD_PROMPT = [
    'אתה יועץ חינוכי המלווה מלמדים ומחנכים בישיבה/מכינה, על פי דרך החינוך התורנית',
    '(מבוססת על "לא ניתן החינוך למלאכי השרת", הרב אריה אינדורסקי, מכון הורני).',
    'עקרונות שעליך ליישם בניתוח:',
    '',
    '1. שאל "בשביל מה" ולא "למה" — אל תחפש רק סיבות/גורמים חיצוניים להתנהגות',
    '   חוזרת (עייפות, "קושי", "אופי"). התלמיד בטבעו רוצה להשתייך ולשתף',
    '   פעולה; דפוס חוזר הוא לרוב ניסיון לא-מודע להשיג שייכות בדרך מוטעית.',
    '2. שני סוגי שייכות מוטעית, והרמז לאבחנה הוא התגובה הרגשית של הצוות:',
    '   (א) תשומת לב עודפת — התלמיד "מרוויח" מלהיתפס כחלש/מתקשה, ומקבל',
    '   התעסקות ורחמים מוגברים. (ב) מאבק כוח — התלמיד "מרוויח" מניצחון על',
    '   הסמכות, וגורם לתסכול וחוסר אונים. שער בזהירות לפי הנתונים, בלי לקבוע.',
    '3. אל תניח מגבלה קבועה — קושי נוכחי אינו זהות. התלמיד יכול ורוצה,',
    '   גם אם כרגע נראה אחרת.',
    '4. המלצה מעשית: להעביר אחריות בצעד קטן אחד, מתוך אמון וסמכות רגועה —',
    '   לא כפייה ולא ויתור. תוצאה טבעית/הגיונית עדיפה על עונש מתוך כעס.',
    '5. עין טובה — פתח בנקודת חוזק אמיתית מתוך הנתונים, לפני הקושי.',
    '',
    'אל תפתח בברכה, פנייה אישית או הקדמה — התחל ישר מהכותרת הראשונה,',
    'ואל תסיים במשפט סיכום — עצור אחרי הצעד המעשי.\n\n',
  ].join('\n');

  // מקורות חינוך שמנהל הוסיף (edu-sources.js, 08/09) — מוזרקים לכל פרומפט אחרי
  // ה-METHOD_PROMPT הקבוע, לפני "נתונים:". אם המודול לא נטען/אין מקורות — no-op.
  async function eduSourcesText() {
    try { return window.cv3EduSources ? await window.cv3EduSources.sourcesText() : { text: '', sig: 'es0' }; }
    catch (_) { return { text: '', sig: 'es0' }; }
  }
  function withEduSources(basePrompt, esText) {
    if (!esText) return basePrompt;
    const marker = 'נתונים:\n';
    const idx = basePrompt.lastIndexOf(marker);
    const block = 'מקורות חינוך נוספים שהמנהל הוסיף למערכת — שלב את הרוח וההנחיות שלהם ' +
      'בניתוח, לצד השיטה הקבועה למעלה:\n' + esText + '\n\n';
    return idx === -1 ? (basePrompt + '\n\n' + block) : (basePrompt.slice(0, idx) + block + basePrompt.slice(idx));
  }

  // כל קריאות ה-AI עוברות דרך window.cv3call (ai-proxy.js): המפתח בשרת בלבד.
  async function gemini(prompt, maxTokens) {
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: maxTokens || 1200,
        // ⚠️ gemini-2.5 מוציא טוקני "חשיבה" *מתוך* maxOutputTokens — נמדדו
        // 1,535 טוקני חשיבה על בקשה של 57 טוקן. עם תקרה של 600 התשובה
        // נחתכה (finishReason=MAX_TOKENS) והמשתמש ראה כותרת בלי תוכן.
        // כאן אין צורך בחשיבה: הסיכום נגזר ישירות מהנתונים שנשלחו.
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
    const res = await window.cv3call(MODEL, body);
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) throw new Error((d && d.error && d.error.message) || ('שגיאה ' + res.status));
    const t = (((d.candidates || [])[0] || {}).content || {}).parts || [];
    const out = t.map(p => p.text || '').join('').trim();
    if (!out) throw new Error('לא התקבלה תשובה');
    return out;
  }

  // ── מטמון: מייצרים מחדש רק כשהנתונים באמת השתנו ──
  // "סיכום בכל פתיחה" לא אמור להיות קריאה לרשת בכל פתיחה: חתימה על הנתונים
  // מספיקה כדי לדעת אם משהו זז מאז הפעם הקודמת.
  // גרסת מטמון: סיכומים שנוצרו לפני תיקון טוקני החשיבה נשמרו קטועים.
  // העלאת המספר מבטלת אותם בלי לגעת ב-localStorage של המשתמש.
  // v3: prompt מבוסס-שיטה (METHOD_PROMPT, 08/09) — מבטל סיכומים ישנים בלי
  // הכותרות/העקרונות החדשים, בלי לגעת ב-localStorage של המשתמש.
  const CV = 'v3:';
  function cacheGet(k, sig) {
    try {
      const raw = localStorage.getItem('cv3ai_' + CV + k);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return o && o.sig === sig ? o : null;
    } catch (_) { return null; }
  }
  function cacheSet(k, sig, text) {
    try { localStorage.setItem('cv3ai_' + CV + k, JSON.stringify({ sig: sig, text: text, at: Date.now() })); } catch (_) {}
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
    // הסטטוסים במסד הם קודים באנגלית (present/late/left/absent). קודם נספרו
    // כאן מחרוזות עבריות ("נוכח"/"איחור"), ולכן כל סיכומי הנוכחות שה-AI קיבל
    // היו אפס — והוא "הסיק" שאין נוכחות בכלל. הערכים העבריים נשמרים כגיבוי
    // לרשומות ישנות שהוזנו ידנית.
    const c = ks => att.filter(a => ks.indexOf(a.status) > -1).length;
    const present = c(['present', 'נוכח']), late = c(['late', 'איחור']),
          leftMid = c(['left', 'יצא']), absent = c(['absent', 'חיסור', 'נעדר']);
    const tot = present + late + leftMid + absent;
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
      const p = cnt(a, 'present') + cnt(a, 'נוכח'), l = cnt(a, 'late') + cnt(a, 'איחור') + cnt(a, 'left'),
            ab = cnt(a, 'absent') + cnt(a, 'חיסור') + cnt(a, 'נעדר');
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

  // ───────────────────────── איסוף נתוני כיתה בודדת (חדש 2026-09-08) ─────────────────────────
  // כמו orgData, אבל מסונן לכיתה אחת — כדי לתת המלצה ממוקדת למחנך הכיתה,
  // לא רק תמונה מוסדית כללית. אין מסך "כיתה" עצמאי במערכת (זה תמיד היה
  // שדה סינון בטבלת תלמידים) — אותה תבנית כמו cheder-maale-amos.
  async function classData(classId, className) {
    const S = window.store;
    const [studentsAll, att, beh, tests] = await Promise.all([
      window.cv3Students ? window.cv3Students.getStudents() : S.list('students'),
      S.list('attendance'), S.list('behavior_events'), S.list('tests'),
    ]);
    const students = studentsAll.filter(s => String(s.class_id) === String(classId));
    const ids = students.map(s => s.id);
    const inClass = arr => arr.filter(x => ids.indexOf(x.student_id) > -1);
    const a = inClass(att);
    const c = ks => a.filter(x => ks.indexOf(x.status) > -1).length;
    const present = c(['present', 'נוכח']), late = c(['late', 'איחור']),
          absent = c(['absent', 'חיסור', 'נעדר']);
    const tot = present + late + absent + c(['left', 'יצא']);
    const behC = inClass(beh);
    const highSev = behC.filter(e => e.severity === 'גבוהה').length;
    const grades = inClass(tests).map(t => Number(t.grade)).filter(x => !isNaN(x));
    const byStudent = {};
    behC.forEach(e => { byStudent[e.student_id] = (byStudent[e.student_id] || 0) + 1; });
    const topReported = Object.keys(byStudent).sort((x, y) => byStudent[y] - byStudent[x]).slice(0, 3)
      .map(sid => { const s = students.find(x => String(x.id) === String(sid)); return s ? nm(s) + ' (' + byStudent[sid] + ')' : null; })
      .filter(Boolean);
    return {
      sig: [students.length, a.length, behC.length, inClass(tests).length].join('-'),
      text: [
        'כיתה: ' + (className || ''),
        'מספר תלמידים: ' + students.length,
        'נוכחות כיתתית: ' + (tot ? (Math.round(((present + late) / tot) * 100) + '% הגעה, ' + absent + ' חיסורים סה"כ') : 'אין רישומים'),
        'דיווחי מעקב: ' + behC.length + ' סה"כ, מתוכם ' + highSev + ' בחומרה גבוהה',
        'התלמידים עם הכי הרבה דיווחי מעקב: ' + (topReported.length ? topReported.join(', ') : 'אין ריכוז בולט'),
        'מבחנים: ' + (grades.length ? (grades.length + ' ציונים, ממוצע ' + Math.round(grades.reduce((x, y) => x + y, 0) / grades.length)) : 'אין'),
      ].join('\n'),
    };
  }

  // ───────────────────────── סיכום תלמיד ─────────────────────────
  const STU_PROMPT = METHOD_PROMPT +
    'לפניך נתוני תלמיד יחיד מתוך מערכת המעקב. כתוב בעברית, קצר וממוקד (עד 8 שורות), ' +
    'בשלושה חלקים עם כותרות מודגשות: **מה קורה כאן** (מה כנראה משיג התלמיד — או שאין מספיק ' +
    'נתונים לדעת), **נקודת חוזק**, **צעד אחד מעשי לצוות**. הסתמך אך ורק על הנתונים שמופיעים ' +
    'כאן, בלי להמציא. אל תאבחן ואל תיתן חוות דעת רפואית/פסיכולוגית — זו הכוונה חינוכית בלבד.\n\nנתונים:\n';

  async function renderStudent(host, student) {
    if (!host) return;
    host.innerHTML = '<div class="ld"><i class="bi bi-stars"></i> מנתח…</div>';
    try {
      const d = await studentData(student);
      const es = await eduSourcesText();
      const sig = d.sig + '|' + es.sig;
      const ck = 'stu' + student.id;
      let hit = cacheGet(ck, sig);
      if (!hit) {
        const txt = await gemini(withEduSources(STU_PROMPT, es.text) + d.text, 1000);
        cacheSet(ck, sig, txt);
        hit = cacheGet(ck, sig) || { text: txt, at: Date.now() };
      }
      host.innerHTML = md(hit.text) +
        '<div class="tl-note" style="font-size:.72rem;margin-top:6px">נוצר ע"י AI · ' + ago(hit.at) +
        ' · <a href="#" data-airefresh>רענון</a></div>';
      const r = host.querySelector('[data-airefresh]');
      if (r) r.addEventListener('click', e => {
        e.preventDefault();
        try { localStorage.removeItem('cv3ai_' + CV + ck); } catch (_) {}
        renderStudent(host, student);
      });
    } catch (e) {
      host.innerHTML = '<div class="tl-note" style="color:#b91c1c">לא ניתן להפיק סיכום כרגע (' + esc(e.message || e) + ')</div>';
    }
  }

  // ───────────────────────── סיכום מוסד ─────────────────────────
  const ORG_PROMPT = METHOD_PROMPT +
    'לפניך תמונת מצב מצטברת על כל המוסד (לא תלמיד ותלמיד). התייחס לאקלים הכללי — ' +
    'האם יש ריכוז דיווחים אצל מעטים, מגמת נוכחות, כיתות שבולטות — ולא לתלמיד ספציפי. ' +
    'כתוב בעברית, קצר וממוקד (עד 8 שורות), בשלושה חלקים עם כותרות מודגשות: **מה קורה כאן**, ' +
    '**מה תקין** (נקודת חוזק מוסדית), **צעד אחד מעשי למנהל**. הסתמך רק על הנתונים.\n\nנתונים:\n';

  const CLS_PROMPT = METHOD_PROMPT +
    'לפניך נתונים מצטברים על כיתה אחת בלבד (לא תלמיד יחיד ולא כל המוסד). התייחס לאקלים ' +
    'הכיתתי — האם יש ריכוז דיווחים אצל מעטים, מגמת נוכחות, וכו׳. ' +
    'כתוב בעברית, קצר וממוקד (עד 8 שורות), בשלושה חלקים עם כותרות מודגשות: **מה קורה כאן**, ' +
    '**נקודת חוזק**, **צעד אחד מעשי לצוות**. הסתמך רק על הנתונים.\n\nנתונים:\n';

  async function renderOrg(host) {
    if (!host) return;
    host.innerHTML = '<div class="ld"><i class="bi bi-stars"></i> מנתח את נתוני המוסד…</div>';
    try {
      const d = await orgData();
      const es = await eduSourcesText();
      const sig = d.sig + '|' + es.sig;
      let hit = cacheGet('org', sig);
      if (!hit) {
        const txt = await gemini(withEduSources(ORG_PROMPT, es.text) + d.text, 1000);
        cacheSet('org', sig, txt);
        hit = cacheGet('org', sig) || { text: txt, at: Date.now() };
      }
      host.innerHTML = md(hit.text) +
        '<div class="tl-note" style="font-size:.72rem;margin-top:6px">נוצר ע"י AI לפי ההרשאות שלך · ' + ago(hit.at) +
        ' · <a href="#" data-airefresh>רענון</a></div>';
      const r = host.querySelector('[data-airefresh]');
      if (r) r.addEventListener('click', e => {
        e.preventDefault();
        try { localStorage.removeItem('cv3ai_' + CV + 'org'); } catch (_) {}
        renderOrg(host);
      });
    } catch (e) {
      host.innerHTML = '<div class="tl-note" style="color:#b91c1c">לא ניתן להפיק סיכום כרגע (' + esc(e.message || e) + ')</div>';
    }
  }

  // ───────────────────────── סיכום כיתה (חדש 2026-09-08) ─────────────────────────
  async function renderClass(host, classId, className) {
    if (!host) return;
    host.innerHTML = '<div class="ld"><i class="bi bi-stars"></i> מנתח את נתוני הכיתה…</div>';
    const ck = 'cls' + classId;
    try {
      const d = await classData(classId, className);
      const es = await eduSourcesText();
      const sig = d.sig + '|' + es.sig;
      let hit = cacheGet(ck, sig);
      if (!hit) {
        const txt = await gemini(withEduSources(CLS_PROMPT, es.text) + d.text, 1000);
        cacheSet(ck, sig, txt);
        hit = cacheGet(ck, sig) || { text: txt, at: Date.now() };
      }
      host.innerHTML = md(hit.text) +
        '<div class="tl-note" style="font-size:.72rem;margin-top:6px">נוצר ע"י AI · ' + ago(hit.at) +
        ' · <a href="#" data-airefresh>רענון</a></div>';
      const r = host.querySelector('[data-airefresh]');
      if (r) r.addEventListener('click', e => {
        e.preventDefault();
        try { localStorage.removeItem('cv3ai_' + CV + ck); } catch (_) {}
        renderClass(host, classId, className);
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
      const p = a.filter(x => x.status === 'present' || x.status === 'נוכח').length;
      const l = a.filter(x => x.status === 'late' || x.status === 'left' || x.status === 'איחור').length;
      const ab = a.filter(x => x.status === 'absent' || x.status === 'חיסור' || x.status === 'נעדר').length;
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
    // סיכום מוכן לכל שיעור. ספירה ידנית של 37 שורות היא בדיוק מה שמודל
    // שפה טועה בו, ולכן נותנים לו את המספרים מחושבים מראש.
    const byCls = {};
    rows.forEach(r => { const k = r[1] || 'ללא שיעור'; (byCls[k] = byCls[k] || []).push(r); });
    const clsSummary = Object.keys(byCls).sort((a, b) => a.localeCompare(b, 'he')).map(k => {
      const g = byCls[k];
      const pcts = g.map(r => parseInt(r[2])).filter(x => !isNaN(x));
      const abs = g.map(r => Number(r[3])).filter(x => !isNaN(x));
      const miss = g.filter(r => r[6] !== 'הכל קיים').length;
      return '- ' + k + ': ' + g.length + ' תלמידים' +
        (pcts.length ? ', ממוצע הגעה ' + Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) + '%' : '') +
        (abs.length ? ', סה"כ ' + abs.reduce((a, b) => a + b, 0) + ' חיסורים' : '') +
        ', ' + miss + ' עם מסמכי חובה חסרים';
    }).join('\n');

    _ctx = 'סיכום מוכן לפי שיעור (השתמש בו לשאלות של כמה/ממוצע — הוא כבר מחושב):\n' +
      clsSummary + '\nסה"כ ' + rows.length + ' תלמידים.' + '\n\n' +
      'טבלת התלמידים שאתה רשאי לראות ' +
      '(שם | כיתה | % הגעה | חיסורים | ממוצע מבחנים | פריטים בתיק | מסמכי חובה חסרים):\n' +
      rows.map(r => '- ' + r.join(' | ')).join('\n') +
      '\n\nהערה: אם אצל תלמיד מופיע "—" וגם 0 פריטים בתיק, ייתכן שפשוט אין למשתמש ' +
      'הרשאה לנתונים של אותו תלמיד. במקרה כזה כתוב "אין גישה" ולא "אין נתונים".';
    _ctxAt = Date.now();
    return _ctx;
  }

  window.cv3AI = { renderStudent, renderOrg, renderClass, dataContext, gemini, md, orgData, classData };
})();
