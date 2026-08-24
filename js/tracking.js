// tracking.js — חלק 5: נוכחות, מבחנים, תפקוד, רפואי (מוגבל), שיחות, אסיפות, לוח עברי.
// מחולל גנרי לרשומות-תלמיד + מודולים ייעודיים. נתונים דרך window.db או דמו מקומי.
(function () {
  'use strict';
  const DEMO = !window.sb;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  async function students() { return (window.cv3Students ? await window.cv3Students.getStudents() : []); }
  // כל הנתונים דרך המאגר המרכזי (store.js) — עם סינון הרשאות לרשומות תלמיד
  async function list(table) {
    let rows = await window.store.list(table);
    const ids = window.cv3Students ? await window.cv3Students.accessibleIds() : null;
    if (ids && rows.length && 'student_id' in rows[0]) rows = rows.filter(r => ids.includes(r.student_id));
    return rows;
  }
  async function add(table, row) { const r = await window.store.add(table, row); return { ok: r.ok, data: r.data }; }
  async function del(table, id) { return window.store.remove(table, id); }
  async function upd(table, id, row) { return window.store.update(table, id, row); }

  // ----- מחולל דף רשומות גנרי -----
  function makeRecord(cfg) {
    return async function (page) {
      const studs = await students();
      const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
      const rows = await list(cfg.table);
      const pickHtml = await window.cv3Picker.html(cfg.table);
      // מחולל הרשומות משמש כמה מודולים (מבחנים, רפואי, שיחות, אסיפות, תפקוד),
      // וכולם קיימים ב-DOM במקביל. מזהים קבועים יצרו כפילות ב-HTML, כך ש-
      // document.querySelector('#recSave') החזיר את הכפתור של מסך אחר.
      const uid = cfg.table;
      const fieldsHtml = cfg.fields.map(f =>
        '<input class="inp mb0' + (f.wide ? ' fld-wide' : '') + '" data-f="' + f.k + '" placeholder="' + esc(f.label) + '"' + (f.type === 'number' ? ' type="number"' : '') + '>').join('');
      page.innerHTML =
        '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>' + cfg.title + '</h2>' +
        '<div class="head-actions"><button class="btn-ghost sm" id="recCsv-' + uid + '"><i class="bi bi-download"></i> ייצוא CSV</button></div></div>' +
        (cfg.restricted ? '<div class="demo-note" style="margin:0 2px 12px"><i class="bi bi-shield-lock"></i> מידע רגיש — הגישה מוגבלת לתפקידים מורשים (נאכף ע"י ה-RLS בצד-שרת).</div>' : '') +
        '<div class="qr-card"><h3><i class="bi ' + cfg.icon + '"></i> רישום חדש</h3><div class="qr-grid" style="grid-template-columns:repeat(' + cfg.fields.length + ',1fr) auto">' +
          pickHtml +
          fieldsHtml +
          '<button class="btn-primary sm" id="recSave-' + uid + '"><i class="bi bi-plus-lg"></i> הוסף</button>' +
        '</div></div>' +
        '<div id="recList-' + uid + '"></div>' +
        '<div id="recEmpty-' + uid + '" class="empty-state" hidden><i class="bi ' + cfg.icon + '"></i><div>אין רישומים עדיין</div></div>';
      const pick = window.cv3Picker.wire(page, cfg.table);
      let data = rows;
      function draw() {
        page.querySelector('#recList-' + uid).innerHTML = data.slice().reverse().map(x =>
          '<div class="tl-item"><span class="sev-dot mid"></span><div class="tl-main"><strong>' + esc(nameOf(x.student_id)) + '</strong> · ' +
          cfg.fields.map(f => esc(x[f.k])).filter(Boolean).join(' · ') + '</div><div class="tl-meta">' + esc(x[cfg.dateField || 'date'] || x.date || x.event_date || '') + '</div>' +
          '<button class="mini" data-edit="' + x.id + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
          '<button class="mini danger" data-del="' + x.id + '" title="מחיקה"><i class="bi bi-trash"></i></button></div>').join('');
        page.querySelector('#recEmpty-' + uid).hidden = data.length > 0;
        page.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
          const ok = await window.UI.confirm('למחוק?'); if (!ok) return;
          const dr = await del(cfg.table, Number(b.dataset.del));
          if (!dr || dr.ok === false) { window.UI.toast('המחיקה נכשלה', 'err'); return; }
          data = data.filter(x => x.id != b.dataset.del); draw(); window.UI.toast('נמחק');
        }));
        page.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
          const rec = data.find(x => x.id == b.dataset.edit); if (rec) editRec(rec);
        }));
      }

      // עריכה גנרית: הטופס נבנה מאותו cfg.fields שממנו נבנה טופס ההוספה,
      // ולכן כל המודולים שנשענים על makeRecord (מבחנים, תפקוד, שיחות,
      // אסיפות, רפואי, קריאה, כתיבה) מקבלים עריכה בבת אחת.
      function editRec(rec) {
        const dk = cfg.dateField === null ? null : (cfg.dateField || 'date');
        const stuOpts = studs.map(x => '<option value="' + x.id + '"' + (x.id == rec.student_id ? ' selected' : '') + '>' +
          esc(window.UI.fullName ? window.UI.fullName(x) : x.name) + '</option>').join('');
        window.UI.modal({
          title: 'עריכת רישום — ' + cfg.title, saveLabel: 'שמירה',
          bodyHTML: '<div class="form-grid">' +
            '<label class="fld"><span>תלמיד</span><select class="inp mb0" id="er_stu">' + stuOpts + '</select></label>' +
            (dk ? '<label class="fld"><span>תאריך</span><input class="inp mb0" id="er_date" type="date" value="' +
                  esc(String(rec[dk] || '').slice(0, 10)) + '"></label>' : '') +
            cfg.fields.map(f => '<label class="fld' + (f.wide ? ' fld-wide' : '') + '"><span>' + esc(f.label) + '</span>' +
              '<input class="inp mb0" data-e="' + f.k + '"' + (f.type === 'number' ? ' type="number"' : '') +
              ' value="' + esc(rec[f.k] == null ? '' : rec[f.k]) + '"></label>').join('') +
            '</div>',
          onSave: async (mel) => {
            const row = { student_id: Number(mel.querySelector('#er_stu').value) || null };
            if (!row.student_id) { window.UI.toast('חובה לבחור תלמיד', 'err'); return false; }
            if (dk) row[dk] = mel.querySelector('#er_date').value || null;
            cfg.fields.forEach(f => { row[f.k] = mel.querySelector('[data-e="' + f.k + '"]').value.trim() || null; });
            const r = await upd(cfg.table, rec.id, row);
            if (!r || r.ok === false) { window.UI.toast('השמירה נכשלה', 'err'); return false; }
            Object.assign(rec, row);
            draw(); window.UI.toast('הרישום עודכן');
            return true;
          },
        });
      }
      page.querySelector('#recCsv-' + uid).addEventListener('click', () => {
        const head = ['תלמיד'].concat(cfg.fields.map(f => f.label)).concat(['תאריך']);
        const lines = [head.join(',')].concat(data.map(x =>
          [nameOf(x.student_id)].concat(cfg.fields.map(f => x[f.k])).concat([x[cfg.dateField || 'date'] || x.date || x.event_date || ''])
            .map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')));
        const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = cfg.table + '.csv'; a.click();
      });
      page.querySelector('#recSave-' + uid).addEventListener('click', async () => {
        const sid = pick.value();
        if (!sid) { window.UI.toast('בחר תלמיד', 'err'); return; }
        const row = { student_id: Number(sid) };
        // שם עמודת התאריך משתנה בין טבלאות (test_date/report_date/date); null = אין עמודת תאריך
        if (cfg.dateField !== null) row[cfg.dateField || 'date'] = today();
        cfg.fields.forEach(f => { row[f.k] = page.querySelector('[data-f="' + f.k + '"]').value.trim(); });
        const r = await add(cfg.table, row); if (!r.ok) { window.UI.toast('שגיאה בשמירה', 'err'); return; }
        data = data.concat([row]); cfg.fields.forEach(f => page.querySelector('[data-f="' + f.k + '"]').value = '');
        draw(); window.UI.toast('נוסף');
      });
      draw();
    };
  }

  // ----- נוכחות (P/A/L לכל תלמיד ליום) -----
  async function renderAttendance(page) {
    const studs = await students();
    const classes = window.cv3Students ? await window.cv3Students.getClasses() : [];
    const has = new Set(studs.map(s => s.class_id));
    const clsOpts = classes.filter(c => has.has(c.id)).map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const state = {};      // סטטוס מוצג לכל תלמיד ביום הנבחר
    const rowIds = {};     // מזהה רשומת הנוכחות הקיימת — כדי לעדכן במקום למחוק+להוסיף
    const busy = {};       // נעילה פר-תלמיד נגד לחיצות רצופות
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>נוכחות</h2></div>' +
      // entry-ui: במסך הנוכחות הטבלה והסרגל *הם* טופס ההזנה, ולא תצוגת נתונים.
      // בלי הסימון הזה מצב "הזנה בלבד" (מלמד) הסתיר אותם ומנע ממנו לרשום נוכחות כלל.
      '<div class="toolbar entry-ui">' +
        '<input type="date" class="inp mb0" id="attDate" value="' + today() + '">' +
        '<select class="inp mb0" id="attClass"><option value="">כל הכיתות</option>' + clsOpts + '</select>' +
        '<input type="search" class="inp mb0" id="attSearch" placeholder="🔍 חיפוש תלמיד…">' +
        (window.cv3Sort ? window.cv3Sort.bar('att') : '') +
        '<span class="count-line" id="attSum" style="align-self:center"></span></div>' +
      '<div class="table-wrap entry-ui"><table class="tbl"><thead><tr>' +
        '<th style="width:44px">#</th><th>תלמיד</th><th>נוכחות</th></tr></thead>' +
        '<tbody id="attBody"></tbody></table></div>';
    function visible() {
      const cid = page.querySelector('#attClass').value, q = (page.querySelector('#attSearch').value || '').trim();
      return studs.filter(s => (!cid || String(s.class_id) === cid) && (!q || (s.name || '').includes(q)));
    }
    const clsNameOf = s => { const c = classes.find(x => x.id == s.class_id); return c ? c.name : 'ללא שיעור'; };
    function draw() {
      // מיון וקיבוץ אחידים לכל המסכים — ראה js/sortui.js
      const row = (s, n) => {
        const v = state[s.id] || '';
        const btn = (val, lbl, cls) => '<button class="att-btn ' + cls + (v === val ? ' on' : '') + '" data-sid="' + s.id + '" data-v="' + val + '">' + lbl + '</button>';
        return '<tr><td class="idx">' + n + '</td>' +
          '<td><span class="ava">' + esc((s.name || '?').slice(0, 2)) + '</span> ' + esc(s.name) + '</td>' +
          '<td class="att-cell">' + btn('present', 'נוכח', 'p') + btn('late', 'איחור', 'l') + btn('absent', 'נעדר', 'a') + '</td></tr>';
      };
      page.querySelector('#attBody').innerHTML = window.cv3Sort
        ? window.cv3Sort.rows(page, 'att', visible(), clsNameOf, row, 3)
        : visible().map((s, i) => row(s, i + 1)).join('');
      const c = { present: 0, late: 0, absent: 0 };
      Object.values(state).forEach(v => c[v] != null && c[v]++);
      page.querySelector('#attSum').textContent = 'נוכחים ' + c.present + ' · איחורים ' + c.late + ' · נעדרים ' + c.absent;
      page.querySelectorAll('.att-btn').forEach(b => b.addEventListener('click', async () => {
        const sid = Number(b.dataset.sid), v = b.dataset.v, d = page.querySelector('#attDate').value;
        if (busy[sid]) return;                 // לחיצות רצופות על אותו תלמיד יצרו כפילויות
        busy[sid] = true;
        const prev = state[sid];
        state[sid] = v; draw();
        try {
          // קודם: טעינת כל טבלת הנוכחות בכל לחיצה, ואז מחיקה ואז הוספה. אם
          // ההוספה נכשלה — הרישום הקודם כבר נמחק והתלמיד נשאר בלי נוכחות כלל.
          const existing = rowIds[sid];
          const r = existing
            ? await window.store.update('attendance', existing, { status: v })
            : await add('attendance', { student_id: sid, date: d, status: v });
          if (!r.ok) {
            state[sid] = prev; draw();
            window.UI.toast('השמירה נכשלה — הסימון לא נשמר', 'err');
            return;
          }
          if (!existing) { const nr = r.data && r.data[0]; if (nr && nr.id) rowIds[sid] = nr.id; }
          window.UI.toast('נשמר');
        } finally { busy[sid] = false; }
      }));
    }
    async function loadDate() {
      Object.keys(state).forEach(k => delete state[k]);
      Object.keys(rowIds).forEach(k => delete rowIds[k]);
      const d = page.querySelector('#attDate').value;
      (await list('attendance')).filter(a => a.date === d).forEach(a => {
        state[a.student_id] = a.status; rowIds[a.student_id] = a.id;
      });
      draw();
    }
    page.querySelector('#attDate').addEventListener('change', loadDate);
    page.querySelector('#attClass').addEventListener('change', draw);
    page.querySelector('#attSearch').addEventListener('input', draw);
    if (window.cv3Sort) window.cv3Sort.wire(page, 'att', draw);
    loadDate();
  }

  // ----- לוח שנה עברי (תאריך היום) -----
  async function renderCalendar(page) {
    let heb = '';
    try { heb = window.UI.hebDate(new Date()); } catch (_) {}
    const greg = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>לוח שנה</h2></div>' +
      '<div class="qr-card" style="text-align:center"><h3 style="justify-content:center"><i class="bi bi-calendar3"></i> היום</h3>' +
      '<div style="font-size:1.6rem;font-weight:800;color:var(--primary-dark);margin:6px 0">' + esc(heb) + '</div>' +
      '<div style="color:var(--muted)">' + esc(greg) + '</div>' +
      '<p class="login-hint" style="margin-top:14px">תצוגת חודש מלאה ואירועים יתווספו בהמשך.</p></div>';
  }

  const R = window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  R.tests = makeRecord({ table: 'tests', title: 'מבחנים', icon: 'bi-card-checklist', dateField: 'test_date', fields: [{ k: 'subject', label: 'מקצוע / נושא' }, { k: 'grade', label: 'ציון', type: 'number' }, { k: 'examiner', label: 'שם הבוחן' }] });
  R.functioning = makeRecord({ table: 'functioning', title: 'ציוני תפקוד', icon: 'bi-bar-chart-line', fields: [{ k: 'area', label: 'תחום' }, { k: 'score', label: 'ציון', type: 'number' }] });
  R.conversations = makeRecord({ table: 'conversations', title: 'שיחות עם תלמידים', icon: 'bi-chat-dots', fields: [{ k: 'summary', label: 'סיכום השיחה', wide: true }] });
  R.meetings = makeRecord({ table: 'meetings', title: 'אסיפות הורים', icon: 'bi-people', fields: [{ k: 'attendees', label: 'משתתפים' }, { k: 'summary', label: 'סיכום', wide: true }] });
  // המסך הרפואי עבר ל-js/medical.js: שלוש קטגוריות נפרדות (רגישות / מצב רפואי /
  // תרופה) עם שדות משלהן ומעקב עדכניות. הטבלה השטוחה כאן לא התאימה לזה.

  R.attendance = renderAttendance;
  R.calendar = renderCalendar;
})();
