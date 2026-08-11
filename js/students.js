// students.js — חלק 3: תלמידים וכיתות. רשימה + חיפוש/סינון + הוספה/עריכה/מחיקה + CSV.
// נתונים דרך window.db (Supabase) או דמו מקומי במצב DEMO.
(function () {
  'use strict';
  const DEMO = !window.sb;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // כל הנתונים דרך המאגר המרכזי (store.js) — משותף עם שאר המודולים.
  async function getClasses() { return window.store.list('classes'); }
  async function getStudents() {
    let list = await window.store.list('students');
    if (window.Auth && window.Auth.scopeClasses) { const sc = window.Auth.scopeClasses(); if (sc) list = list.filter(s => sc.includes(s.class_id)); }
    return list;
  }
  async function saveStudent(row) { return row.id ? window.store.update('students', row.id, row) : window.store.add('students', row); }
  async function removeStudent(id) { return window.store.remove('students', id); }

  const classNameOf = (classes, id) => { const c = classes.find(x => x.id === id); return c ? c.name : ''; };

  async function render(page) {
    const [students, classes] = await Promise.all([getStudents(), getClasses()]);
    page.innerHTML =
      '<div class="page-head">' +
        '<button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
        '<h2>תלמידים</h2>' +
        '<div class="head-actions">' +
          '<button class="btn-primary sm" id="stuAdd"><i class="bi bi-plus-lg"></i> תלמיד חדש</button>' +
          '<button class="btn-ghost sm" id="stuCsv"><i class="bi bi-download"></i> ייצוא CSV</button>' +
        '</div>' +
      '</div>' +
      '<div class="toolbar">' +
        '<input type="search" class="inp mb0" id="stuSearch" placeholder="חיפוש תלמיד / הורה / טלפון…">' +
        '<select class="inp mb0" id="stuClass"><option value="">כל הכיתות</option>' +
          classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select>' +
        '<select class="inp mb0" id="stuStatus"><option value="">כל הסטטוסים</option><option value="פעיל">פעיל</option><option value="לא פעיל">לא פעיל</option></select>' +
      '</div>' +
      '<div class="count-line" id="stuCount"></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>שם</th><th>כיתה</th><th>הורה</th><th>טלפון</th><th>סטטוס</th><th></th>' +
      '</tr></thead><tbody id="stuBody"></tbody></table></div>' +
      '<div id="stuEmpty" class="empty-state" hidden><i class="bi bi-people"></i><div>אין תלמידים להצגה</div></div>';

    function draw() {
      const q = (page.querySelector('#stuSearch').value || '').trim();
      const cf = page.querySelector('#stuClass').value;
      const sf = page.querySelector('#stuStatus').value;
      let rows = students;
      if (q) rows = rows.filter(s => [s.name, s.parent_name, s.parent_phone].join(' ').includes(q));
      if (cf) rows = rows.filter(s => String(s.class_id) === cf);
      if (sf) rows = rows.filter(s => (s.status || '') === sf);
      const body = page.querySelector('#stuBody');
      body.innerHTML = rows.map(s =>
        '<tr>' +
        '<td><span class="ava">' + esc((s.name || '?').slice(0, 2)) + '</span> ' + esc(s.name) + '</td>' +
        '<td>' + esc(classNameOf(classes, s.class_id)) + '</td>' +
        '<td>' + esc(s.parent_name) + '</td>' +
        '<td>' + (s.parent_phone ? '<a href="tel:' + esc(s.parent_phone) + '">' + esc(s.parent_phone) + '</a>' : '') + '</td>' +
        '<td><span class="chip ' + (s.status === 'פעיל' ? 'ok' : 'off') + '">' + esc(s.status || '') + '</span></td>' +
        '<td class="row-act"><button class="mini" data-view="' + s.id + '" title="פרטים"><i class="bi bi-eye"></i></button>' +
        '<button class="mini" data-edit="' + s.id + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
        ((window.currentUser || {}).role === 'מנהל' ? '<button class="mini danger" data-del="' + s.id + '" title="מחיקה"><i class="bi bi-trash"></i></button>' : '') + '</td>' +
        '</tr>').join('');
      page.querySelector('#stuCount').textContent = rows.length + ' מתוך ' + students.length + ' תלמידים';
      page.querySelector('#stuEmpty').hidden = rows.length > 0;
      body.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => openDetail(students.find(s => s.id == b.dataset.view))));
      body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(students.find(s => s.id == b.dataset.edit))));
      body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => del(students.find(s => s.id == b.dataset.del))));
    }

    async function openDetail(s) {
      if (!s) return;
      const m = window.UI.modal({ title: 'כרטיס תלמיד', bodyHTML: '<div style="padding:26px;text-align:center;color:var(--muted)"><i class="bi bi-hourglass-split"></i> טוען…</div>' });
      const [cats, beh, att, tst, fnc, med, cnv, mtg, rdg, wrt, tui, tsk] = await Promise.all([
        window.store.list('categories'),
        window.store.byStudent('behavior_events', s.id), window.store.byStudent('attendance', s.id),
        window.store.byStudent('tests', s.id), window.store.byStudent('functioning', s.id),
        window.store.byStudent('medications', s.id), window.store.byStudent('conversations', s.id),
        window.store.byStudent('meetings', s.id), window.store.byStudent('reading', s.id), window.store.byStudent('writing', s.id),
        window.store.byStudent('tuition', s.id), window.store.byStudent('tasks', s.id),
      ]);
      const catName = id => { const c = cats.find(x => x.id == id); return c ? c.name : ''; };
      const row = (lbl, val) => val ? '<div class="det-row"><span class="det-lbl">' + lbl + '</span><span class="det-val">' + esc(val) + '</span></div>' : '';
      const sevc = x => x === 'גבוהה' ? 'hi' : x === 'נמוכה' ? 'lo' : 'mid';
      const li = (main, meta, dot) => '<div class="det-item">' + (dot ? '<span class="sev-dot ' + dot + '"></span>' : '') + '<span class="di-main">' + main + '</span><span class="di-meta">' + esc(meta || '') + '</span></div>';
      const sec = (title, icon, items, fmt) => items.length ? ('<div class="det-sec"><h4><i class="bi ' + icon + '"></i> ' + title + ' <span class="det-badge">' + items.length + '</span></h4>' + items.slice(-4).reverse().map(fmt).join('') + '</div>') : '';
      const attC = { present: 0, late: 0, absent: 0 }; att.forEach(a => attC[a.status] != null && attC[a.status]++);
      // משימות הקשורות לתלמיד — תאריך יעד בעברית + צ'יפ סטטוס (מראה זהה לסקשנים קריאה/כתיבה/מבחנים)
      const hebDate = iso => { if (!iso) return ''; try { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); return isNaN(d.getTime()) ? String(iso) : new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long' }).format(d); } catch (_) { return String(iso); } };
      const taskLbl = st => st === 'done' ? 'הושלם' : st === 'in_progress' ? 'בתהליך' : 'לביצוע';
      const taskChip = st => '<span class="chip ' + (st === 'done' ? 'ok' : 'off') + '">' + taskLbl(st) + '</span>';
      const tasksSec = '<div class="det-sec"><h4><i class="bi bi-kanban"></i> משימות הקשורות <span class="det-badge">' + tsk.length + '</span></h4>' +
        (tsk.length ? tsk.slice(-4).reverse().map(t => li('<strong>' + esc(t.title) + '</strong> ' + taskChip(t.status), hebDate(t.due_date))).join('')
          : '<div class="tl-note" style="padding:6px 2px;font-size:.84rem">אין משימות משויכות</div>') + '</div>';
      m.el.querySelector('.modal-body').innerHTML =
        '<div class="det-head"><span class="ava lg">' + esc((s.name || '?').slice(0, 2)) + '</span>' +
        '<div><div class="det-name">' + esc(s.name) + '</div><span class="chip ' + (s.status === 'פעיל' ? 'ok' : 'off') + '">' + esc(s.status || '') + '</span></div></div>' +
        '<div class="det-grid">' + row('כיתה', classNameOf(classes, s.class_id)) + row('שם הורה', s.parent_name) +
          (s.parent_phone ? '<div class="det-row"><span class="det-lbl">טלפון</span><span class="det-val"><a href="tel:' + esc(s.parent_phone) + '">' + esc(s.parent_phone) + '</a></span></div>' : '') +
          row('הערות', s.notes) + '</div>' +
        '<div class="det-stats">' +
          '<div class="ds"><b>' + beh.length + '</b><span>דיווחים</span></div>' +
          '<div class="ds"><b>' + attC.present + '</b><span>נוכחות</span></div>' +
          '<div class="ds"><b>' + tst.length + '</b><span>מבחנים</span></div>' +
          '<div class="ds"><b>' + (med.length ? '⚠' : '—') + '</b><span>רפואי</span></div>' +
        '</div>' +
        sec('התנהגות', 'bi-clipboard-check', beh, e => li('<strong>' + esc(catName(e.category_id)) + '</strong>' + (e.note ? ' — ' + esc(e.note) : ''), e.event_date, sevc(e.severity))) +
        sec('מבחנים', 'bi-card-checklist', tst, t => li(esc(t.subject) + ' · <strong>' + esc(t.grade) + '</strong>', t.date)) +
        sec('ציוני תפקוד', 'bi-bar-chart-line', fnc, f => li(esc(f.area) + ' · <strong>' + esc(f.score) + '</strong>', f.date)) +
        sec('רפואי', 'bi-capsule', med, x => li('<strong>' + esc(x.name) + '</strong>' + (x.details ? ' — ' + esc(x.details) : ''), x.kind === 'allergy' ? 'אלרגיה' : 'תרופה', 'hi')) +
        sec('שיחות', 'bi-chat-dots', cnv, c => li(esc(c.summary), c.date)) +
        sec('אסיפות הורים', 'bi-people', mtg, x => li(esc(x.summary), x.date)) +
        sec('קריאה', 'bi-book', rdg, x => li('רמה: ' + esc(x.level) + (x.note ? ' — ' + esc(x.note) : ''), x.date)) +
        sec('כתיבה', 'bi-pencil-square', wrt, x => li('רמה: ' + esc(x.level), x.date)) +
        (att.length ? '<div class="det-sec"><h4><i class="bi bi-calendar-check"></i> נוכחות <span class="det-badge">' + att.length + '</span></h4><div class="det-item"><span class="di-main">נוכח ' + att.filter(a => a.status === 'present').length + ' · איחורים ' + att.filter(a => a.status === 'late').length + ' · נעדר ' + att.filter(a => a.status === 'absent').length + '</span></div></div>' : '') +
        sec('שכר לימוד', 'bi-cash-coin', tui, t => li((esc(t.month) || '') + (t.amount ? ' · ₪' + esc(t.amount) : ''), t.status === 'paid' ? 'שולם' : 'חוב', t.status === 'paid' ? 'lo' : 'hi')) +
        tasksSec +
        '<div class="det-actions" style="margin-top:14px">' +
          '<button class="btn-primary sm" data-edit2><i class="bi bi-pencil"></i> עריכת פרטים</button>' +
          '<button class="btn-ghost sm" data-print2><i class="bi bi-printer"></i> הדפסה</button>' +
          '<button class="btn-ghost sm" data-go="behavior"><i class="bi bi-plus-lg"></i> דיווח חדש</button>' +
        '</div>';
      m.el.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => { m.close(); showPage(btn.dataset.go); }));
      const eb = m.el.querySelector('[data-edit2]'); if (eb) eb.addEventListener('click', () => { m.close(); openForm(s); });
      const pb = m.el.querySelector('[data-print2]'); if (pb) pb.addEventListener('click', () => window.print());
    }

    function openForm(existing) {
      const s = existing || {};
      const classOpts = classes.map(c => '<option value="' + c.id + '"' + (s.class_id === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
      const body =
        '<div class="form-grid">' +
        '<label class="fld"><span>שם התלמיד *</span><input class="inp mb0" id="f_name" value="' + esc(s.name) + '"></label>' +
        '<label class="fld"><span>כיתה</span><select class="inp mb0" id="f_class"><option value="">—</option>' + classOpts + '</select></label>' +
        '<label class="fld"><span>שם הורה</span><input class="inp mb0" id="f_pname" value="' + esc(s.parent_name) + '"></label>' +
        '<label class="fld"><span>טלפון הורה</span><input class="inp mb0" id="f_phone" value="' + esc(s.parent_phone) + '"></label>' +
        '<label class="fld"><span>סטטוס</span><select class="inp mb0" id="f_status"><option' + (s.status !== 'לא פעיל' ? ' selected' : '') + '>פעיל</option><option' + (s.status === 'לא פעיל' ? ' selected' : '') + '>לא פעיל</option></select></label>' +
        '<label class="fld fld-wide"><span>הערות</span><textarea class="inp mb0" id="f_notes" rows="2">' + esc(s.notes) + '</textarea></label>' +
        '</div>';
      window.UI.modal({
        title: existing ? 'עריכת תלמיד' : 'תלמיד חדש', bodyHTML: body, saveLabel: 'שמירה',
        onSave: async (m) => {
          const name = m.querySelector('#f_name').value.trim();
          if (!name) { window.UI.toast('נא להזין שם', 'err'); return false; }
          const row = {
            name,
            class_id: m.querySelector('#f_class').value ? Number(m.querySelector('#f_class').value) : null,
            parent_name: m.querySelector('#f_pname').value.trim(),
            parent_phone: m.querySelector('#f_phone').value.trim(),
            status: m.querySelector('#f_status').value,
            notes: m.querySelector('#f_notes').value.trim(),
          };
          if (existing) row.id = existing.id;
          const r = await saveStudent(row);
          if (!r.ok) { window.UI.toast('שגיאה: ' + (r.error || ''), 'err'); return false; }
          window.UI.toast(existing ? 'עודכן' : 'נוסף תלמיד');
          if (existing) Object.assign(existing, row); else students.push((r.data && r.data[0]) || row);
          draw();
          return true;
        },
      });
    }

    async function del(s) {
      if (!s) return;
      const ok = await window.UI.confirm('למחוק את "' + esc(s.name) + '"? הפעולה אינה הפיכה.');
      if (!ok) return;
      const r = await removeStudent(s.id);
      if (!r.ok) { window.UI.toast('שגיאה במחיקה', 'err'); return; }
      const i = students.indexOf(s); if (i >= 0) students.splice(i, 1);
      window.UI.toast('נמחק'); draw();
    }

    function exportCsv() {
      const head = ['שם', 'כיתה', 'הורה', 'טלפון', 'סטטוס'];
      const lines = [head.join(',')].concat(students.map(s =>
        [s.name, classNameOf(classes, s.class_id), s.parent_name, s.parent_phone, s.status].map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'students.csv'; a.click();
    }

    page.querySelector('#stuAdd').addEventListener('click', () => openForm(null));
    page.querySelector('#stuCsv').addEventListener('click', exportCsv);
    ['#stuSearch', '#stuClass', '#stuStatus'].forEach(sel => page.querySelector(sel).addEventListener('input', draw));
    draw();
  }

  async function addClass(name) { const r = await window.store.add('classes', { name }); return { ok: r.ok, id: r.data && r.data[0] && r.data[0].id }; }
  // מזהי התלמידים שהמשתמש הנוכחי מורשה לראות (null = הכל). לסינון רשומות בכל המודולים.
  async function accessibleIds() {
    const sc = (window.Auth && window.Auth.scopeClasses) ? window.Auth.scopeClasses() : null;
    if (!sc) return null;
    const studs = await window.store.list('students');
    return studs.filter(s => sc.includes(s.class_id)).map(s => s.id);
  }
  window.cv3Students = { getStudents: getStudents, getClasses: getClasses, addClass: addClass, accessibleIds: accessibleIds };
  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.students = render;
})();
