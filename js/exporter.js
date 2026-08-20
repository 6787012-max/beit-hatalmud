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
        { k: 'address', t: 'כתובת', def: false },
        { k: 'blank', t: 'הערות', def: false, blank: true },
      ],
      async rows(ctx) {
        return ctx.students.map(s => ({
          name: nm(s), cls: ctx.clsName(s.class_id), tz: s.tz, birthdate_heb: s.birthdate_heb,
          birthdate: d10(s.birthdate), parent_name: s.parent_name, parent_phone: s.parent_phone,
          mother_name: s.mother_name, mother_phone: s.mother_phone,
          mother_email: s.mother_email || (s.reg && (s.reg['אימייל אב'] || s.reg['אימייל אם'])),
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
    docs: {
      label: 'תיק מסמכים — מה חסר', icon: 'bi-folder2-open',
      cols: [
        { k: 'idx', t: '#', def: true, w: 40 },
        { k: 'name', t: 'שם התלמיד', def: true },
        { k: 'cls', t: 'כיתה', def: true },
        { k: 'folder', t: 'תיקייה בדרייב', def: true, w: 90 },
      ],
      async rows(ctx) {
        const all = await window.store.list('student_docs');
        return ctx.students.map(s => ({
          name: nm(s), cls: ctx.clsName(s.class_id),
          folder: all.some(d => d.student_id === s.id && d.source === 'drive') ? 'קיימת' : '— חסרה —', _s: s,
        }));
      },
    },
  };

  const SORTS = [
    ['name', 'שם התלמיד (א״ב)'],
    ['cls', 'כיתה ואז שם'],
    ['none', 'סדר המערכת'],
  ];

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
          '<button class="btn-primary sm" id="exPrint"><i class="bi bi-printer"></i> הדפסה</button>' +
        '</div></div>' +
      '<div class="qr-card"><div class="qr-grid" style="grid-template-columns:repeat(4,1fr);gap:10px">' +
        '<label class="fld"><span>מה להפיק</span><select class="inp mb0" id="exSrc">' +
          Object.keys(SOURCES).map(k => '<option value="' + k + '">' + esc(SOURCES[k].label) + '</option>').join('') +
        '</select></label>' +
        '<label class="fld"><span>מיון</span><select class="inp mb0" id="exSort">' +
          SORTS.map(s => '<option value="' + s[0] + '">' + esc(s[1]) + '</option>').join('') + '</select></label>' +
        '<label class="fld"><span>כיוון הדף</span><select class="inp mb0" id="exOrient">' +
          '<option value="portrait">לאורך</option><option value="landscape">לרוחב</option></select></label>' +
        '<label class="fld"><span>גודל טקסט</span><select class="inp mb0" id="exFont">' +
          '<option value="11">קטן</option><option value="13" selected>רגיל</option><option value="15">גדול</option>' +
          '<option value="18">גדול מאוד</option></select></label>' +
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
        '<label class="fld" style="min-width:220px"><span>כותרת</span><input class="inp mb0" id="exTitle" placeholder="לדוגמה: רשימת תלמידים תשפ״ז"></label>' +
      '</div>' +
      '<p class="login-hint" style="margin:10px 0 0"><i class="bi bi-pencil"></i> אפשר לערוך את הגיליון למטה ישירות — לתקן כותרת, למחוק שורה או להוסיף הערה — ואז להדפיס.</p>' +
      '</div>' +
      '<div id="exSheetWrap" class="table-wrap" style="background:#e9edf2;padding:18px;border-radius:12px;overflow:auto"></div>';

    const $ = s => page.querySelector(s);
    let cols = [];

    async function buildCols() {
      const src = SOURCES[$('#exSrc').value];
      cols = typeof src.cols === 'function' ? await src.cols({ }) : src.cols.slice();
      $('#exCols').innerHTML = cols.map((c, i) =>
        '<label class="cb"><input type="checkbox" data-col="' + i + '"' + (c.def ? ' checked' : '') + '> ' + esc(c.t) + '</label>').join('');
      $('#exCols').querySelectorAll('input').forEach(x => x.addEventListener('change', draw));
    }

    function chosenClasses() {
      return [...$('#exCls').querySelectorAll('input:checked')].map(x => Number(x.value));
    }

    async function draw() {
      const srcKey = $('#exSrc').value, src = SOURCES[srcKey];
      const clsIds = chosenClasses();
      const list = students.filter(s => clsIds.includes(Number(s.class_id)));
      const ctx = { students: list, clsName };
      let rows = await src.rows(ctx);

      const sort = $('#exSort').value;
      if (sort === 'name') rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
      else if (sort === 'cls') rows.sort((a, b) => String(a.cls).localeCompare(String(b.cls), 'he') || String(a.name).localeCompare(String(b.name), 'he'));

      const picked = [...$('#exCols').querySelectorAll('input:checked')].map(x => cols[Number(x.dataset.col)]);
      const title = ($('#exTitle').value || '').trim() || src.label;
      const land = $('#exOrient').value === 'landscape';
      const fs = $('#exFont').value;
      const zebra = $('#exZebra').checked, grid = $('#exGrid').checked;

      const head = '<tr>' + picked.map(c =>
        '<th style="' + (c.w ? 'width:' + c.w + 'px;' : '') + '">' + esc(c.t) + '</th>').join('') + '</tr>';
      const body = rows.map((r, i) => '<tr>' + picked.map(c =>
        '<td>' + (c.k === 'idx' ? (i + 1) : (c.blank ? '' : esc(r[c.k] == null ? '' : r[c.k]))) + '</td>').join('') + '</tr>').join('');

      const today = new Date().toLocaleDateString('he-IL');
      $('#exSheetWrap').innerHTML =
        '<div class="ex-sheet' + (land ? ' land' : '') + '" contenteditable="true" spellcheck="false" ' +
          'style="font-size:' + fs + 'px">' +
          ($('#exLogo').checked ? '<div class="ex-head">' +
            '<img src="img/logo.png" alt="" class="ex-logo">' +
            '<div class="ex-titles"><div class="ex-inst">' + esc(inst) + '</div>' +
            '<h1>' + esc(title) + '</h1>' +
            ($('#exDate').checked ? '<div class="ex-date">' + esc(today) + ' · ' + rows.length + ' רשומות</div>' : '') +
            '</div></div>' : '<h1 class="ex-plain">' + esc(title) + '</h1>') +
          '<table class="ex-table' + (zebra ? ' zebra' : '') + (grid ? ' grid' : '') + '">' +
            '<thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
          ($('#exSign').checked ? '<div class="ex-sign"><div>חתימה: ____________________</div><div>תאריך: ____________</div></div>' : '') +
        '</div>';
      page._rows = rows; page._picked = picked; page._title = title;
    }

    ['#exSrc'].forEach(s => $(s).addEventListener('change', async () => { await buildCols(); draw(); }));
    ['#exSort', '#exOrient', '#exFont', '#exTitle'].forEach(s => {
      $(s).addEventListener('input', draw);
      $(s).addEventListener('change', draw);   // select משנה דרך change, לא רק input
    });
    ['#exLogo', '#exZebra', '#exGrid', '#exDate', '#exSign'].forEach(s => $(s).addEventListener('change', draw));
    $('#exCls').querySelectorAll('input').forEach(x => x.addEventListener('change', draw));

    $('#exPrint').addEventListener('click', () => {
      const land = $('#exOrient').value === 'landscape';
      let st = document.getElementById('exPageStyle');
      if (!st) { st = document.createElement('style'); st.id = 'exPageStyle'; document.head.appendChild(st); }
      st.textContent = '@page { size: A4 ' + (land ? 'landscape' : 'portrait') + '; margin: 12mm; }';
      document.body.classList.add('printing-sheet');
      const done = () => document.body.classList.remove('printing-sheet');
      window.addEventListener('afterprint', done, { once: true });
      setTimeout(done, 8000);
      window.print();
    });

    $('#exCsv').addEventListener('click', () => {
      const picked = page._picked || [], rows = page._rows || [];
      if (!rows.length) { window.UI.toast('אין נתונים ליצוא', 'err'); return; }
      const cell = v => { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
      const lines = [picked.map(c => cell(c.t)).join(',')].concat(
        rows.map((r, i) => picked.map(c => cell(c.k === 'idx' ? (i + 1) : (c.blank ? '' : r[c.k]))).join(',')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
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
