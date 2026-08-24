// exporter.js — "יצוא והדפסה" (2026-08-20, בקשת יוסף).
//
// בונה טבלה מעוצבת ומוכנה לדפוס מכל מקור נתונים במערכת: בוחרים מקור, כיתות,
// עמודות, מיון ועיצוב — והתצוגה המקדימה היא **גיליון A4 אמיתי שניתן לעריכה**
// (contenteditable): אפשר לתקן כותרת, למחוק שורה, להוסיף הערה — ואז להדפיס.
//
// למה לא פשוט window.print() על המסך: המסך מלא בסרגלים ובצבעים שלא נועדו לנייר.
// כאן הגיליון עצמו הוא מה שמודפס (`body.printing-sheet`), בגודל וברוחב הנכונים.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s && s.name) || '';
  const d10 = v => String(v || '').slice(0, 10);

  // ── מקורות הנתונים ──
  // כל מקור מגדיר אילו עמודות אפשר לבחור, ואיך בונים שורה. `def` = מסומן כברירת מחדל.
  const SOURCES = {
    students: {
      label: 'רשימת תלמידים', icon: 'bi-people-fill',
      cols: [
        { k: 'idx', t: '#', def: true, w: 40 },
        { k: 'name', t: 'שם התלמיד', def: true },
        { k: 'cls', t: 'כיתה', def: true },
        { k: 'tz', t: 'ת״ז', def: false },
        { k: 'birthdate_heb', t: 'תאריך לידה (עברי)', def: false },
        { k: 'birthdate', t: 'תאריך לידה', def: false },
        { k: 'parent_name', t: 'שם האב', def: false },
        { k: 'parent_phone', t: 'טלפון אב', def: true },
        { k: 'mother_name', t: 'שם האם', def: false },
        { k: 'mother_phone', t: 'טלפון אם', def: true },
        { k: 'mother_email', t: 'אימייל', def: false },
        // ↓ פירוק הכתובת והטלפון הביתי — כמו בגיליון "כולם טלפונים" של יוסף
        { k: 'city', t: 'עיר', def: false },
        { k: 'street', t: 'רחוב', def: false },
        { k: 'houseno', t: 'מספר', def: false, w: 55 },
        { k: 'homephone', t: 'טלפון בבית', def: false },
        { k: 'address', t: 'כתובת מלאה', def: false },
        { k: 'blank', t: 'הערות', def: false, blank: true },
      ],
      async rows(ctx) {
        const rg = (s, k) => (s.reg && (s.reg[k] != null ? String(s.reg[k]).trim() : '')) || '';
        return ctx.students.map(s => ({
          name: nm(s), cls: ctx.clsName(s.class_id), tz: s.tz, birthdate_heb: s.birthdate_heb,
          birthdate: d10(s.birthdate), parent_name: s.parent_name, parent_phone: s.parent_phone,
          mother_name: s.mother_name, mother_phone: s.mother_phone,
          mother_email: s.mother_email || (s.reg && (s.reg['אימייל אב'] || s.reg['אימייל אם'])),
          city: rg(s, 'עיר'), street: rg(s, 'רחוב'), houseno: rg(s, 'מספר'),
          homephone: rg(s, 'טלפון בבית'),
          address: s.address, _s: s,
        }));
      },
    },
    attendance: {
      label: 'נוכחות', icon: 'bi-calendar-check',
      cols: [
        { k: 'idx', t: '#', def: true, w: 40 },
        { k: 'name', t: 'שם התלמיד', def: true },
        { k: 'cls', t: 'כיתה', def: true },
        { k: 'present', t: 'נוכח', def: true, w: 60 },
        { k: 'late', t: 'איחור', def: true, w: 60 },
        { k: 'absent', t: 'חיסור', def: true, w: 60 },
        { k: 'pct', t: '% הגעה', def: true, w: 70 },
      ],
      async rows(ctx) {
        const all = await window.store.list('attendance');
        return ctx.students.map(s => {
          const r = all.filter(a => a.student_id === s.id);
          const c = k => r.filter(a => a.status === k).length;
          const present = c('נוכח'), late = c('איחור'), absent = c('חיסור') + c('נעדר');
          const tot = present + late + absent;
          return {
            name: nm(s), cls: ctx.clsName(s.class_id), present, late, absent,
            pct: tot ? Math.round(((present + late) / tot) * 100) + '%' : '—', _s: s,
          };
        });
      },
    },
    tests: {
      label: 'מבחנים', icon: 'bi-card-checklist',
      cols: [
        { k: 'idx', t: '#', def: true, w: 40 },
        { k: 'name', t: 'שם התלמיד', def: true },
        { k: 'cls', t: 'כיתה', def: true },
        { k: 'count', t: 'מספר מבחנים', def: true, w: 90 },
        { k: 'avg', t: 'ממוצע', def: true, w: 70 },
        { k: 'last', t: 'אחרון', def: false },
      ],
      async rows(ctx) {
        const all = await window.store.list('tests');
        return ctx.students.map(s => {
          const r = all.filter(t => t.student_id === s.id);
          const g = r.map(t => Number(t.grade)).filter(x => !isNaN(x));
          const last = r.slice().sort((a, b) => String(b.test_date || '').localeCompare(String(a.test_date || '')))[0];
          return {
            name: nm(s), cls: ctx.clsName(s.class_id), count: r.length,
            avg: g.length ? Math.round(g.reduce((a, b) => a + b, 0) / g.length) : '—',
            last: last ? (last.subject + ' ' + (last.grade || '')) : '—', _s: s,
          };
        });
      },
    },
    reading: {
      label: 'מעקב קריאה', icon: 'bi-book-half',
      async cols(ctx) {
        const cats = window.cv3ReadAssess ? await window.cv3ReadAssess.cats() : [];
        return [{ k: 'idx', t: '#', def: true, w: 40 }, { k: 'name', t: 'שם התלמיד', def: true },
          { k: 'cls', t: 'כיתה', def: true }, { k: 'date', t: 'תאריך', def: true, w: 90 }]
          .concat(cats.map(c => ({ k: 'c' + c.id, t: c.name, def: true, w: 70 })));
      },
      async rows(ctx) {
        const all = await window.store.list('reading_assessments');
        return ctx.students.map(s => {
          const r = all.filter(a => a.student_id === s.id)
            .sort((a, b) => String(b.assessed_on || '').localeCompare(String(a.assessed_on || '')))[0];
          const out = { name: nm(s), cls: ctx.clsName(s.class_id), date: r ? d10(r.assessed_on) : '—', _s: s };
          const sc = (r && r.scores) || {};
          for (const k in sc) out['c' + k] = sc[k];
          return out;
        });
      },
    },
    blank: {
      label: 'טבלה ריקה למילוי', icon: 'bi-grid-3x3', blankMode: true,
      // העמודות והשורות נבנות דינמית מהסרגל (blankCols/blankRows) — ראה buildCols/draw
      async cols() { return []; },
      async rows() { return []; },
    },
    passport: {
      // אותם שדות כמו בחוברת הדרכון ובמסך הדרכון — כדי שהמודפס יתאים למה שרואים
      label: 'דרכון — סיכום שבועי', icon: 'bi-passport',
      cols: [
        { k: 'idx', t: '#', def: true, w: 40 },
        { k: 'name', t: 'שם התלמיד', def: true },
        { k: 'cls', t: 'שיעור', def: true, w: 70 },
        { k: 'weeks', t: 'שבועות שהוזנו', def: true, w: 80 },
        { k: 'shacharit', t: 'סה״כ שחרית', def: true, w: 75 },
        { k: 'hours', t: 'סה״כ לימוד', def: true, w: 75 },
        { k: 'written', t: 'ממוצע בכתב', def: true, w: 75 },
        { k: 'oral', t: 'ממוצע בע״פ', def: true, w: 75 },
        { k: 'score', t: 'ניקוד כללי', def: true, w: 70 },
      ],
      async rows(ctx) {
        const P = window.cv3Passport;
        const all = await window.store.list('passport');
        const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
        return ctx.students.map(s => {
          const mine = all.filter(r => r.student_id === s.id);
          const pick = k => mine.map(r => r[k]).filter(x => x != null);
          const sc = P ? mine.map(P.score).filter(x => x != null) : [];
          const sum = k => { const a = pick(k); return a.length ? a.reduce((x, y) => x + y, 0) : null; };
          const hours = sum('study_min');
          return {
            name: nm(s), cls: ctx.clsName(s.class_id), _s: s,
            weeks: mine.length + (P ? '/' + P.WEEKS.length : ''),
            shacharit: sum('shacharit') != null ? sum('shacharit') : '—',
            hours: hours != null ? Math.round(hours / 60) + ' ש׳' : '—',
            written: avg(pick('test_written')) != null ? avg(pick('test_written')) : '—',
            oral: avg(pick('test_oral')) != null ? avg(pick('test_oral')) : '—',
            score: avg(sc) != null ? avg(sc) : '—',
          };
        });
      },
    },
    docs: {
      // נעמי לוי ביקשה "לבדוק מה קיים בחומרים ומה לא" לפני בניית התל"אות.
      // לכן זו מטריצה אמיתית: עמודה לכל מסמך חובה, ולא רק "יש תיקייה".
      label: 'תיק מסמכים — מה קיים ומה חסר', icon: 'bi-folder2-open', slow: true,
      cols: [
        { k: 'idx', t: '#', def: true, w: 40 },
        { k: 'name', t: 'שם התלמיד', def: true },
        { k: 'cls', t: 'כיתה', def: true, w: 70 },
        { k: 'vitur', t: 'ויתור סודיות', def: true, w: 70 },
        { k: 'shaalon', t: 'שאלון הפניה', def: true, w: 70 },
        { k: 'ivhun', t: 'אבחונים', def: true, w: 60 },
        { k: 'kavil', t: 'מסמך קביל', def: true, w: 65 },
        { k: 'vaada', t: 'החלטת ועדה', def: true, w: 70 },
        { k: 'total', t: 'סה״כ בתיק', def: false, w: 60 },
        { k: 'missing', t: 'חסר', def: true },
      ],
      async rows(ctx) {
        const NEED = [['vitur', 'ויתור סודיות'], ['shaalon', 'שאלון הפניה'],
          ['ivhun', 'אבחונים ורקע קודם'], ['kavil', 'מסמך קביל'], ['vaada', 'החלטת ועדה']];
        const D = window.cv3StudentDocs;
        const links = await window.store.list('student_docs');
        // סורקים את הדרייב עצמו — התיקים לא מאונדקסים במסד, רק התיקיות.
        // שישה במקביל: מספיק מהר, בלי להציף את ה-Edge Function.
        const scans = {};
        const list = ctx.students.slice();
        await Promise.all(Array.from({ length: 6 }, async () => {
          while (list.length) {
            const s = list.shift();
            scans[s.id] = D ? await D.scanStudent(s.id) : { ok: false, total: 0, kinds: {} };
          }
        }));
        return ctx.students.map(s => {
          const sc = scans[s.id] || { ok: false, total: 0, kinds: {} };
          const hasFolder = links.some(d => d.student_id === s.id && d.source === 'drive');
          const r = { name: nm(s), cls: ctx.clsName(s.class_id), total: sc.total, _s: s };
          const miss = [];
          NEED.forEach(([k, kind]) => {
            const has = (sc.kinds[kind] || 0) > 0;
            r[k] = has ? '✔' : '✗';
            if (!has) miss.push(kind);
          });
          r.missing = !hasFolder ? '— אין תיקייה בדרייב —'
            : (!sc.ok ? 'לא ניתן לקרוא את התיק'
            : (miss.length ? miss.join(', ') : '— תיק מלא —'));
          return r;
        });
      },
    },
  };

  // ⚠️ העמודה `name` במסד היא "פרטי + משפחה" (למשל "דוד אריה אוליאל"), ולכן
  // מיון לפיה הוא מיון לפי שם פרטי — לא מה שמצפים ברשימת כיתה. ברירת המחדל
  // היא שם משפחה, ומיון לפי שם פרטי נשאר כאפשרות מפורשת.
  const SORTS = [
    ['family', 'שם משפחה (א״ב)'],
    ['cls', 'כיתה ואז שם משפחה'],
    ['name', 'שם פרטי (א״ב)'],
    ['none', 'סדר המערכת'],
  ];
  const famOf = s => String((s && s.family) || '').trim();
  const byFamily = (a, b) =>
    famOf(a._s).localeCompare(famOf(b._s), 'he') ||
    String(a.name || '').localeCompare(String(b.name || ''), 'he');

  async function render(page) {
    const [classes, students] = await Promise.all([
      window.store.list('classes'),
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
    ]);
    const clsName = id => { const c = classes.find(x => x.id == id); return c ? c.name : ''; };
    const inst = (window.CV3 || {}).INSTANCE_NAME || '';

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>יצוא והדפסה</h2>' +
        '<div class="head-actions">' +
          '<button class="btn-ghost sm" id="exCsv"><i class="bi bi-file-earmark-spreadsheet"></i> יצוא לאקסל</button>' +
          '<button class="btn-ghost sm" id="exPdf"><i class="bi bi-file-earmark-pdf"></i> הורד PDF</button>' +
          '<button class="btn-ghost sm" id="exSqueeze" title="מקטין את הטקסט עד שכל התוכן נכנס לעמוד אחד בגודל שנבחר">' +
            '<i class="bi bi-arrows-angle-contract"></i> דחוס לעמוד אחד</button>' +
          '<button class="btn-primary sm" id="exPrint"><i class="bi bi-printer"></i> הדפסה</button>' +
        '</div></div>' +
      '<div class="qr-card"><div class="qr-grid" style="grid-template-columns:repeat(4,1fr);gap:10px">' +
        '<label class="fld"><span>מה להפיק</span><select class="inp mb0" id="exSrc">' +
          Object.keys(SOURCES).map(k => '<option value="' + k + '">' + esc(SOURCES[k].label) + '</option>').join('') +
        '</select></label>' +
        '<label class="fld"><span>מיון</span><select class="inp mb0" id="exSort">' +
          SORTS.map(s => '<option value="' + s[0] + '">' + esc(s[1]) + '</option>').join('') + '</select></label>' +
        '<label class="fld"><span>גודל הדף</span><select class="inp mb0" id="exPaper">' +
          '<option value="a4">A4</option><option value="a3">A3</option></select></label>' +
        '<label class="fld"><span>כיוון הדף</span><select class="inp mb0" id="exOrient">' +
          '<option value="portrait">לאורך</option><option value="landscape">לרוחב</option></select></label>' +
        '<label class="fld"><span>התאמה לדף</span><select class="inp mb0" id="exFit">' +
          '<option value="">ללא — גודל הטקסט שבחרתי</option>' +
          '<option value="width">התאם לרוחב הדף</option>' +
          '<option value="page">התאם למספר עמודים קבוע</option>' +
        '</select></label>' +
        '<label class="fld" id="exPagesWrap" style="display:none"><span>כמה עמודים</span>' +
          '<select class="inp mb0" id="exPages">' +
            [1, 2, 3, 4, 5, 6, 8, 10].map(n => '<option value="' + n + '">' + n + '</option>').join('') +
          '</select></label>' +
        '<label class="fld"><span>גודל טקסט <b id="exFontVal">13</b></span>' +
          '<input class="inp mb0" id="exFont" type="range" min="8" max="24" step="1" value="13" style="padding:6px 0"></label>' +
      '</div>' +
      '<div class="qr-grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">' +
        '<div class="fld"><span>כיתות</span><div class="cb-grid" id="exCls">' +
          classes.map(c => '<label class="cb"><input type="checkbox" value="' + c.id + '" checked> ' + esc(c.name) + '</label>').join('') +
          '</div></div>' +
        '<div class="fld"><span>עמודות</span><div class="cb-grid" id="exCols"></div></div>' +
      '</div>' +
      '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:10px">' +
        '<label class="cb"><input type="checkbox" id="exLogo" checked> לוגו וכותרת</label>' +
        '<label class="cb"><input type="checkbox" id="exZebra" checked> שורות מודגשות</label>' +
        '<label class="cb"><input type="checkbox" id="exGrid" checked> קווי טבלה</label>' +
        '<label class="cb"><input type="checkbox" id="exDate" checked> תאריך בכותרת</label>' +
        '<label class="cb"><input type="checkbox" id="exSign"> שורת חתימה בתחתית</label>' +
        '<label class="cb"><input type="checkbox" id="exSplit"> עמוד נפרד לכל שיעור</label>' +
        '<label class="fld"><span>צדדים</span><select class="inp mb0" id="exSides">' +
          '<option value="one">חד-צדדי</option>' +
          '<option value="two">דו-צדדי — כל שיעור בדף חדש</option>' +
        '</select></label>' +
        '<label class="fld" style="min-width:220px"><span>כותרת</span><input class="inp mb0" id="exTitle" placeholder="לדוגמה: רשימת תלמידים תשפ״ז"></label>' +
      '</div>' +
      '<div id="exBlankBar" style="display:none;border-top:1px dashed var(--line);margin-top:10px;padding-top:10px">' +
        '<div class="qr-grid" style="grid-template-columns:2fr 1fr 1fr 1fr;gap:10px">' +
          '<label class="fld"><span>כותרות העמודות <small style="font-weight:400;color:var(--muted)">— מופרדות בפסיק</small></span>' +
            '<input class="inp mb0" id="exBcols" value="שם התלמיד, נוכחות, הערות"></label>' +
          '<label class="fld"><span>שורות</span><select class="inp mb0" id="exBrowsMode">' +
            '<option value="students">שמות התלמידים</option><option value="empty">שורות ריקות</option></select></label>' +
          '<label class="fld"><span>כמה שורות ריקות</span><input class="inp mb0" id="exBrows" type="number" min="1" max="60" value="20"></label>' +
          '<label class="fld"><span>גובה שורה</span><select class="inp mb0" id="exBh">' +
            '<option value="26">רגיל</option><option value="34" selected>נוח לכתיבה</option><option value="46">גבוה</option></select></label>' +
        '</div>' +
        '<div class="qr-grid" style="grid-template-columns:1fr 1fr 2fr;gap:10px;margin-top:8px">' +
          '<label class="fld"><span>עמודות תאריכים מ־</span><input class="inp mb0" id="exBdate" type="date"></label>' +
          '<label class="fld"><span>כמה ימים</span><input class="inp mb0" id="exBdays" type="number" min="0" max="31" value="0"></label>' +
          '<div class="fld"><span>&nbsp;</span><div class="tl-note" style="font-size:.8rem">מלאו "כמה ימים" כדי לייצר עמודה לכל יום (דף נוכחות). ' +
            'ימי שישי־שבת מסומנים באפור.</div></div>' +
        '</div></div>' +
      '<p class="login-hint" style="margin:10px 0 0"><i class="bi bi-pencil"></i> אפשר לערוך את הגיליון למטה ישירות — לתקן כותרת, למחוק שורה או להוסיף הערה — ואז להדפיס.</p>' +
      '</div>' +
      '<div id="exEdit" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:10px 0 0">' +
        '<span class="tl-note" style="font-size:.8rem">עריכת הטבלה:</span>' +
        '<button class="btn-ghost sm" data-ed="rowAfter"><i class="bi bi-plus-lg"></i> שורה</button>' +
        '<button class="btn-ghost sm" data-ed="colAfter"><i class="bi bi-plus-lg"></i> עמודה</button>' +
        '<button class="btn-ghost sm" data-ed="rowDel"><i class="bi bi-dash-lg"></i> מחק שורה</button>' +
        '<button class="btn-ghost sm" data-ed="colDel"><i class="bi bi-dash-lg"></i> מחק עמודה</button>' +
        '<span class="tl-note" id="exSel" style="font-size:.78rem">לחץ על תא כדי לבחור מיקום</span>' +
        '<span class="tl-note" style="font-size:.75rem;color:#92400e;margin-inline-start:auto"><i class="bi bi-exclamation-triangle"></i> שינוי ההגדרות למעלה בונה את הטבלה מחדש ומאפס עריכות</span>' +
      '</div>' +
      '<div id="exHint" class="login-hint" style="margin:6px 0 0;color:#92400e"></div>' +
      '<div id="exSheetWrap" class="table-wrap" style="background:#e9edf2;padding:18px;border-radius:12px;overflow:auto"></div>';

    const $ = s => page.querySelector(s);
    let cols = [];

    async function buildCols() {
      const src = SOURCES[$('#exSrc').value];
      const blank = !!src.blankMode;
      $('#exBlankBar').style.display = blank ? '' : 'none';
      $('#exCols').closest('.fld').style.display = blank ? 'none' : '';
      cols = typeof src.cols === 'function' ? await src.cols({ }) : src.cols.slice();
      // עמודת שם משפחה זמינה בכל דוח — היא מה שמסתדר לפי א"ב ברשימת כיתה,
      // בעוד שהעמודה "שם התלמיד" היא "פרטי + משפחה".
      if (!blank && !cols.some(c => c.k === 'family')) {
        const at = Math.max(1, cols.findIndex(c => c.k === 'name'));
        cols.splice(at, 0, { k: 'family', t: 'שם משפחה', def: false });
      }
      $('#exCols').innerHTML = cols.map((c, i) =>
        '<label class="cb"><input type="checkbox" data-col="' + i + '"' + (c.def ? ' checked' : '') + '> ' + esc(c.t) + '</label>').join('');
      $('#exCols').querySelectorAll('input').forEach(x => x.addEventListener('change', draw));
    }

    function chosenClasses() {
      return [...$('#exCls').querySelectorAll('input:checked')].map(x => Number(x.value));
    }

    // בונה את הטבלה הריקה: כותרות מהמשתמש + עמודות תאריך אופציונליות,
    // ושורות שהן או שמות התלמידים מהכיתות שנבחרו או שורות ריקות לגמרי.
    function blankPlan(list) {
      const titles = ($('#exBcols').value || '').split(',').map(x => x.trim()).filter(Boolean);
      const picked = titles.map((t, i) => ({ k: 'b' + i, t: t, blank: i > 0 }));
      const days = Math.max(0, Math.min(31, Number($('#exBdays').value) || 0));
      const from = $('#exBdate').value;
      const dateCols = [];
      if (days && from) {
        const base = new Date(from + 'T12:00:00');
        for (let i = 0; i < days; i++) {
          const d = new Date(base.getTime() + i * 86400000);
          const dow = d.getDay();   // 5=שישי 6=שבת
          dateCols.push({ k: 'd' + i, t: d.getDate() + '/' + (d.getMonth() + 1), blank: true, w: 34,
            weekend: dow === 5 || dow === 6 });
        }
      }
      const all = picked.concat(dateCols);
      const useStudents = $('#exBrowsMode').value === 'students';
      const n = useStudents ? list.length : Math.max(1, Math.min(60, Number($('#exBrows').value) || 20));
      const rows = [];
      for (let i = 0; i < n; i++) {
        const r = {};
        if (useStudents && all.length) r[all[0].k] = nm(list[i]);
        rows.push(r);
      }
      return { picked: all, rows: rows };
    }

    async function draw() {
      const srcKey = $('#exSrc').value, src = SOURCES[srcKey];
      // דוח מצב התיקים פונה לדרייב לכל תלמיד — זה לוקח כמה עשרות שניות,
      // ובלי חיווי זה נראה כאילו נתקע (או גרוע מכך — כאילו הדוח הקודם הוא התוצאה).
      if (src.slow) $('#exSheetWrap').innerHTML =
        '<div class="ld" style="padding:40px;text-align:center">' +
        '<i class="bi bi-hourglass-split"></i> סורק את תיקי הדרייב של כל התלמידים… ' +
        'זה עשוי לקחת עד דקה.</div>';
      const clsIds = chosenClasses();
      const list = students.filter(s => clsIds.includes(Number(s.class_id)));
      const ctx = { students: list, clsName };
      if (src.blankMode) {
        const sortB = $('#exSort').value;
        if (sortB === 'name') list.sort((a, b) => String(nm(a)).localeCompare(String(nm(b)), 'he'));
        else if (sortB !== 'none') list.sort((a, b) =>
          String(a.family || '').localeCompare(String(b.family || ''), 'he') ||
          String(nm(a)).localeCompare(String(nm(b)), 'he'));
        const plan = blankPlan(list);
        return paint(plan.rows, plan.picked, src, true);
      }
      let rows = await src.rows(ctx);

      const sort = $('#exSort').value;
      if (sort === 'family') rows.sort(byFamily);
      else if (sort === 'name') rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
      else if (sort === 'cls') rows.sort((a, b) => String(a.cls).localeCompare(String(b.cls), 'he') || byFamily(a, b));

      rows.forEach(r => { if (r.family == null) r.family = (r._s && r._s.family) || ''; });
      const picked = [...$('#exCols').querySelectorAll('input:checked')].map(x => cols[Number(x.dataset.col)]);
      return paint(rows, picked, src, false);
    }

    function paint(rows, picked, src, isBlank) {
      const title = ($('#exTitle').value || '').trim() || src.label;
      const land = $('#exOrient').value === 'landscape';
      const a3 = ($('#exPaper') || {}).value === 'a3';
      const fs = $('#exFont').value;
      const fv = $('#exFontVal'); if (fv) fv.textContent = fs;
      const zebra = $('#exZebra').checked, grid = $('#exGrid').checked;

      const rowH = isBlank ? Number($('#exBh').value || 34) : 0;
      const head = '<tr>' + picked.map(c =>
        '<th' + (c.weekend ? ' class="wk"' : '') + ' style="' + (c.w ? 'width:' + c.w + 'px;' : '') + '">' + esc(c.t) + '</th>').join('') + '</tr>';
      const bodyOf = rs => rs.map((r, i) => '<tr' + (rowH ? ' style="height:' + rowH + 'px"' : '') + '>' + picked.map(c =>
        '<td' + (c.weekend ? ' class="wk"' : '') + '>' +
        (c.k === 'idx' ? (i + 1) : (c.blank ? '' : esc(r[c.k] == null ? '' : r[c.k]))) + '</td>').join('') + '</tr>').join('');

      const today = new Date().toLocaleDateString('he-IL');
      // גיליון אחד = דף A4 אחד. כשמפצלים לפי שיעור בונים כמה גיליונות,
      // כל אחד עם כותרת משלו ומספור שמתחיל מ-1 — בדיוק כמו הגיליונות
      // הנפרדים בקובץ האקסל ("שיעור א", "שיעור ב"...).
      const sheet = (rs, ttl) =>
        '<div class="ex-sheet' + (land ? ' land' : '') + (a3 ? ' a3' : '') + '" contenteditable="true" spellcheck="false" ' +
          'style="font-size:' + fs + 'px">' +
          ($('#exLogo').checked ? '<div class="ex-head">' +
            '<img src="img/logo.png" alt="" class="ex-logo">' +
            '<div class="ex-titles"><div class="ex-inst">' + esc(inst) + '</div>' +
            '<h1>' + esc(ttl) + '</h1>' +
            ($('#exDate').checked ? '<div class="ex-date">' + esc(today) + (isBlank ? '' : ' · ' + rs.length + ' רשומות') + '</div>' : '') +
            '</div></div>' : '<h1 class="ex-plain">' + esc(ttl) + '</h1>') +
          '<table class="ex-table' + (zebra ? ' zebra' : '') + (grid ? ' grid' : '') + '">' +
            '<thead>' + head + '</thead><tbody>' + bodyOf(rs) + '</tbody></table>' +
          ($('#exSign').checked ? '<div class="ex-sign"><div>חתימה: ____________________</div><div>תאריך: ____________</div></div>' : '') +
        '</div>';

      const splitEl = $('#exSplit');
      const split = !isBlank && splitEl && splitEl.checked;
      let html;
      if (split) {
        const groups = [];
        rows.forEach(r => {
          const k = r.cls || 'ללא שיעור';
          let g = groups.find(x => x.k === k);
          if (!g) groups.push(g = { k: k, rs: [] });
          g.rs.push(r);
        });
        groups.sort((a, b) => String(a.k).localeCompare(String(b.k), 'he'));
        html = groups.map(g => sheet(g.rs, title + ' — ' + g.k)).join('');
      } else {
        html = sheet(rows, title);
      }
      $('#exSheetWrap').innerHTML = html;
      fitToPage();
      page._rows = rows; page._picked = picked; page._title = title;
      // עצה קטנה במקום שהמשתמש יגלה לבד שהדף צר מדי
      const hint = page.querySelector('#exHint');
      if (hint) hint.innerHTML = (picked.length > 7 && !land)
        ? '<i class="bi bi-lightbulb"></i> נבחרו ' + picked.length + ' עמודות — כדאי לעבור ל"דף לרוחב" כדי שיהיה מרווח.' : '';
    }

    // ── התאמה אוטומטית לגודל A4 ──────────────────────────────────────────
    // המשתמש ביקש שהטבלה תתפוס את הדף — גם להקטין וגם *להגדיל* אם יש מקום.
    // עובדים על גודל הפונט ולא על transform:scale, כי scale משבש שבירת
    // עמודים בהדפסה ומקטין גם את השוליים; שינוי פונט נשאר טיפוגרפיה אמיתית.
    function fitToPage() {
      const mode = ($('#exFit') || {}).value || '';
      const base = Number($('#exFont').value) || 13;
      const sheets = [...page.querySelectorAll('.ex-sheet')];
      const pw = $('#exPagesWrap'); if (pw) pw.style.display = mode === 'page' ? '' : 'none';
      sheets.forEach(sh => { sh.style.fontSize = base + 'px'; sh.style.minHeight = ''; });
      if (!mode) return;

      sheets.forEach(sh => {
        const tbl = sh.querySelector('.ex-table');
        if (!tbl) return;
        const cs = getComputedStyle(sh);
        const availW = sh.clientWidth - parseFloat(cs.paddingInlineStart || cs.paddingLeft)
                                      - parseFloat(cs.paddingInlineEnd || cs.paddingRight);
        // מדידת הרוחב ה"טבעי" של הטבלה. שלושה דברים חייבים להתבטל זמנית:
        // table-layout:fixed (מותח לרוחב מלא), ו-word-break/overflow-wrap
        // בתאים — הם מאפשרים שבירת מילים ולכן max-content מתכווץ, וכך
        // טבלה עם 15 עמודות "נמדדה" כרחבה מספיק ולא הוקטנה בכלל.
        const cells = tbl.querySelectorAll('th, td');
        const prev = { layout: tbl.style.tableLayout, w: tbl.style.width };
        tbl.style.tableLayout = 'auto'; tbl.style.width = 'max-content';
        cells.forEach(c => {
          c.dataset.pw = c.style.whiteSpace || '';
          c.style.whiteSpace = 'nowrap';
          c.style.wordBreak = 'normal';
          c.style.overflowWrap = 'normal';
        });
        const natural = tbl.scrollWidth || availW;
        cells.forEach(c => {
          c.style.whiteSpace = c.dataset.pw; delete c.dataset.pw;
          c.style.wordBreak = ''; c.style.overflowWrap = '';
        });
        tbl.style.tableLayout = prev.layout; tbl.style.width = prev.w;

        // הגדלה מוגבלת: טבלה של שתי עמודות "יכולה" להגיע ל-40px, וזה נראה
        // כמו שלט ולא כמו רשימה. עד פי 1.6 מהבחירה של המשתמש, ולא מעל 20px.
        let size = base * (availW / Math.max(1, natural));
        size = Math.min(size, base * 1.6, 20);

        if (mode === 'page') {
          // התאמה למספר עמודים שהמשתמש בחר: מחפשים בחיפוש בינארי את גודל
          // הטקסט **הגדול ביותר** שעדיין נכנס ב-N עמודים. חיפוש ולא לולאת
          // הקטנה, כי צריך גם *להגדיל* כשיש מקום — טבלה קצרה ב-2 עמודים
          // אמורה למלא אותם, לא להישאר זעירה בפינה.
          const want = Math.max(1, Number(($('#exPages') || {}).value) || 1);
          const pageH = sh.clientHeight;                 // גובה עמוד אחד
          const fits = px => {
            sh.style.fontSize = px + 'px';
            return sh.scrollHeight <= pageH * want + 2;
          };
          let lo = 4, hi = 28;
          if (!fits(lo)) { size = lo; }                  // אפילו 4px לא נכנס
          else {
            for (let i = 0; i < 22; i++) {
              const mid = (lo + hi) / 2;
              if (fits(mid)) lo = mid; else hi = mid;
            }
            size = lo;
          }
        }
        size = Math.max(4, Math.min(28, size));
        sh.style.fontSize = size.toFixed(1) + 'px';
      });
      const hint = page.querySelector('#exHint');
      if (hint && sheets[0]) {
        const got = Math.round(parseFloat(sheets[0].style.fontSize));
        const sh0 = sheets[0];
        const pages = Math.max(1, Math.ceil(sh0.scrollHeight / (sh0.clientHeight || 1)));
        hint.innerHTML = '<i class="bi bi-aspect-ratio"></i> גודל הטקסט ' +
          (got > base ? 'הוגדל' : got < base ? 'הוקטן' : 'נשאר') + ' מ-' + base + ' ל-' + got +
          (mode === 'page' ? (' · יוצא ' + pages + ' עמודים') : '') +
          (got <= 6 ? ' — קטן מאוד לקריאה, שקלו A3 או יותר עמודים.' : '');
      }
    }

    // ── עריכה מבנית של הטבלה: הוספה/מחיקה של שורות ועמודות בכל מקור נתונים ──
    // הגיליון כבר contenteditable (טקסט), אבל הוספת שורה/עמודה דורשת שינוי DOM אמיתי.
    // המיקום נקבע לפי התא האחרון שנלחץ; בלי בחירה — הפעולה מתבצעת בסוף הטבלה.
    let sel = null;   // {r, c, t} — r=-1 מסמן שורת הכותרת, t = הטבלה שנבחרה
    // עם פיצול לפי שיעור יש כמה טבלאות בדף; העריכה חלה על זו שנלחצה.
    function tbl() { return (sel && sel.t && sel.t.isConnected) ? sel.t : page.querySelector('.ex-table'); }
    function markSel() {
      page.querySelectorAll('.ex-cell-sel').forEach(e => e.classList.remove('ex-cell-sel'));
      const t = tbl(); if (!t || !sel) return;
      const row = sel.r < 0 ? t.tHead.rows[0] : t.tBodies[0].rows[sel.r];
      const cell = row && row.cells[sel.c];
      if (cell) cell.classList.add('ex-cell-sel');
      const lbl = page.querySelector('#exSel');
      if (lbl) lbl.textContent = sel.r < 0 ? ('כותרת · עמודה ' + (sel.c + 1)) : ('שורה ' + (sel.r + 1) + ' · עמודה ' + (sel.c + 1));
    }
    page.addEventListener('click', e => {
      const cell = e.target.closest('.ex-table td, .ex-table th');
      if (!cell) return;
      const row = cell.parentElement;
      const t = cell.closest('.ex-table');
      sel = { r: row.parentElement.tagName === 'THEAD' ? -1 : row.rowIndex - (t.tHead ? 1 : 0), c: cell.cellIndex, t: t };
      markSel();
    });
    page.querySelectorAll('#exEdit [data-ed]').forEach(btn => btn.addEventListener('click', () => {
      const t = tbl(); if (!t) return;
      const body = t.tBodies[0], head = t.tHead.rows[0];
      const nCols = head.cells.length;
      const act = btn.dataset.ed;
      if (act === 'rowAfter') {
        const at = sel && sel.r >= 0 ? sel.r + 1 : body.rows.length;
        const tr = body.insertRow(at);
        // שומרים על גובה השורה שמעל, כדי שטבלה למילוי-יד תישאר אחידה
        const ref = body.rows[at - 1] || body.rows[at + 1];
        if (ref && ref.style.height) tr.style.height = ref.style.height;
        for (let i = 0; i < nCols; i++) tr.insertCell(i);
        sel = { r: at, c: sel ? sel.c : 0 };
      } else if (act === 'colAfter') {
        const at = sel ? sel.c + 1 : nCols;
        const th = document.createElement('th');
        th.textContent = 'עמודה חדשה';
        head.insertBefore(th, head.cells[at] || null);
        [...body.rows].forEach(r => r.insertCell(at > r.cells.length ? r.cells.length : at));
        sel = { r: sel ? sel.r : -1, c: at };
      } else if (act === 'rowDel') {
        if (!sel || sel.r < 0) { window.UI.toast('בחר תא בשורה שברצונך למחוק', 'err'); return; }
        if (body.rows.length <= 1) { window.UI.toast('חייבת להישאר שורה אחת', 'err'); return; }
        body.deleteRow(sel.r); sel = null;
      } else if (act === 'colDel') {
        if (!sel) { window.UI.toast('בחר תא בעמודה שברצונך למחוק', 'err'); return; }
        if (nCols <= 1) { window.UI.toast('חייבת להישאר עמודה אחת', 'err'); return; }
        head.deleteCell(sel.c);
        [...body.rows].forEach(r => { if (r.cells[sel.c]) r.deleteCell(sel.c); });
        sel = null;
      }
      markSel();
    }));

    ['#exSrc'].forEach(s => $(s).addEventListener('change', async () => { await buildCols(); draw(); }));
    ['#exSort', '#exOrient', '#exFont', '#exTitle', '#exSplit', '#exFit', '#exSides', '#exPaper', '#exPages'].forEach(s => {
      $(s).addEventListener('input', draw);
      $(s).addEventListener('change', draw);   // select משנה דרך change, לא רק input
    });
    ['#exLogo', '#exZebra', '#exGrid', '#exDate', '#exSign'].forEach(s => $(s).addEventListener('change', draw));
    $('#exCls').querySelectorAll('input').forEach(x => x.addEventListener('change', draw));
    ['#exBcols', '#exBrows', '#exBdate', '#exBdays'].forEach(k => $(k).addEventListener('input', draw));
    ['#exBrowsMode', '#exBh'].forEach(k => $(k).addEventListener('change', draw));

    // "דחוס הכל לעמוד אחד" — כפתור אחד שעושה את מה שרוב הפעמים רוצים:
    // מבטל פיצול לשיעורים (אחרת זה כמה עמודים ממילא) ומכווץ עד שהכל נכנס.
    $('#exSqueeze').addEventListener('click', () => {
      const sp = $('#exSplit'); if (sp && sp.checked) sp.checked = false;
      $('#exFit').value = 'page';
      const pg = $('#exPages'); if (pg) pg.value = '1';
      draw();
      const sh = page.querySelector('.ex-sheet');
      const got = sh ? Math.round(parseFloat(sh.style.fontSize) || 0) : 0;
      window.UI.toast(got ? ('הכל נדחס לעמוד אחד · גודל טקסט ' + got) : 'נדחס לעמוד אחד');
    });

    $('#exPrint').addEventListener('click', () => {
      const land = $('#exOrient').value === 'landscape';
      let st = document.getElementById('exPageStyle');
      if (!st) { st = document.createElement('style'); st.id = 'exPageStyle'; document.head.appendChild(st); }
      // בהתאמה לעמוד מלא גודל הטקסט כבר לקח את השוליים בחשבון;
      // שוליים גדולים בהדפסה היו מכווצים שוב ומבטלים את ההתאמה.
      const mm = (($('#exFit') || {}).value === 'page') ? 8 : 12;
      const paper = (($('#exPaper') || {}).value === 'a3') ? 'A3' : 'A4';
      st.textContent = '@page { size: ' + paper + ' ' + (land ? 'landscape' : 'portrait') +
        '; margin: ' + mm + 'mm; }';
      document.body.classList.toggle('ex-duplex', (($('#exSides') || {}).value === 'two'));
      document.body.classList.add('printing-sheet');
      const done = () => document.body.classList.remove('printing-sheet');
      window.addEventListener('afterprint', done, { once: true });
      setTimeout(done, 8000);
      window.print();
    });

    // הורדת PDF ישירה — הגיליון עצמו, בכיוון הדף שנבחר
    if (window.cv3Pdf) window.cv3Pdf.wire($('#exPdf'),
      // עם פיצול לפי שיעור יש כמה גיליונות — מייצאים את כולם, לא רק את הראשון
      () => (page.querySelectorAll('.ex-sheet').length > 1 ? $('#exSheetWrap') : page.querySelector('.ex-sheet')),
      () => page._title || 'יצוא',
      () => ({ orientation: $('#exOrient').value === 'landscape' ? 'landscape' : 'portrait',
               paper: (($('#exPaper') || {}).value === 'a3') ? 'a3' : 'a4', margin: 6 }));

    $('#exCsv').addEventListener('click', () => {
      // מייצאים מה-DOM ולא מהנתונים המקוריים — כך העריכות הידניות (שורות/עמודות
      // שנוספו, טקסט שתוקן) נכנסות גם לקובץ, ולא רק להדפסה.
      const tables = [...page.querySelectorAll('.ex-table')];
      if (!tables.length) { window.UI.toast('אין נתונים ליצוא', 'err'); return; }
      const cell = v => { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
      const lines = [];
      tables.forEach((t, i) => {
        // כותרת פעם אחת בלבד; לפני כל שיעור נוסף — שורה עם שם השיעור
        if (i > 0) {
          const h = t.closest('.ex-sheet').querySelector('h1');
          lines.push(''); lines.push(cell(h ? h.innerText : 'המשך'));
        }
        const rs = i === 0 ? [...t.tHead.rows, ...t.tBodies[0].rows] : [...t.tBodies[0].rows];
        rs.forEach(r => lines.push([...r.cells].map(c => cell(c.innerText)).join(',')));
      });
      const blob = new Blob([String.fromCharCode(0xFEFF) + lines.join(String.fromCharCode(10))], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (page._title || 'יצוא') + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    });

    await buildCols();
    draw();
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.exporter = render;
})();
