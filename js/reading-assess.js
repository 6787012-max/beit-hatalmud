// reading-assess.js — מעקב קריאה מובנה (הוספה 2026-08-17, בקשת עמנואל).
// קטגוריות ניתנות-לעריכה (reading_categories) + הערכות ציון 1-10 (reading_assessments).
// לא נוגע בסקשן "קידום קריאה" (reading) הקיים.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isAdmin = () => !!(window.currentUser && window.currentUser.role === 'מנהל');

  async function cats() {
    const list = await window.store.list('reading_categories');
    return (list || []).filter(c => c.active !== false).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
  }
  async function forStudent(sid) {
    const list = await window.store.byStudent('reading_assessments', sid);
    return (list || []).slice().sort((a, b) => String(b.assessed_on || '').localeCompare(String(a.assessed_on || '')) || b.id - a.id);
  }

  // ── טופס הערכה חדשה (ציון 1-10 לכל קטגוריה) ──
  async function openAssessment(student, onSaved) {
    const cs = await cats();
    if (!cs.length) { window.UI.toast('אין קטגוריות קריאה. הוסף במסך "מעקב קריאה".', 'err'); return; }
    const last = (await forStudent(student.id))[0];
    const prev = (last && last.scores) || {};
    const rows = cs.map(c => {
      let opts = '<option value="">—</option>';
      for (let i = 1; i <= 10; i++) opts += '<option' + (String(prev[c.id]) === String(i) ? ' selected' : '') + '>' + i + '</option>';
      return '<tr><td>' + esc(c.name) + '</td><td><select class="inp mb0 ra-score" data-cid="' + c.id + '">' + opts + '</select></td></tr>';
    }).join('');
    const body = '<div class="ra-form">' +
      '<table class="tbl"><thead><tr><th>קטגוריה</th><th style="width:120px">ציון 1–10</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<label class="fld fld-wide" style="margin-top:10px"><span>הערה</span><textarea class="inp mb0" id="ra_note" rows="2"></textarea></label>' +
      (last ? '<div class="tl-note" style="font-size:.82rem;margin-top:6px">הערכה קודמת: ' + esc(last.assessed_on || '') + '</div>' : '') +
      '</div>';
    window.UI.modal({
      title: 'מעקב קריאה — ' + esc(window.UI.fullName(student)),
      bodyHTML: body, saveLabel: 'אישור',
      onSave: async (m) => {
        const sc = {};
        m.querySelectorAll('.ra-score').forEach(s => { if (s.value) sc[s.dataset.cid] = Number(s.value); });
        if (!Object.keys(sc).length) { window.UI.toast('נא למלא לפחות ציון אחד', 'err'); return false; }
        const note = (m.querySelector('#ra_note').value || '').trim();
        const r = await window.store.add('reading_assessments', { student_id: student.id, scores: sc, note: note || null });
        if (!r.ok) { window.UI.toast('שגיאה: ' + (r.error || ''), 'err'); return false; }
        window.UI.toast('נשמר מעקב קריאה'); if (onSaved) onSaved(); return true;
      },
    });
  }

  // ── סקשן לכרטיס התלמיד (מקבל קטגוריות + הערכות שכבר נטענו) ──
  function cardSection(catsList, assessments) {
    if (!assessments || !assessments.length) return '';
    const last = assessments[0];
    const sc = last.scores || {};
    const items = (catsList || []).map(c => sc[c.id] != null
      ? '<div class="det-row"><span class="det-lbl">' + esc(c.name) + '</span><span class="det-val">' + esc(sc[c.id]) + '/10</span></div>' : '').join('');
    if (!items) return '';
    return '<div class="det-sec"><h4><i class="bi bi-book-half"></i> מעקב קריאה <span class="det-badge">' + esc(last.assessed_on || '') + '</span></h4>' +
      items + (last.note ? '<div class="tl-note" style="font-size:.82rem;padding:4px 2px">' + esc(last.note) + '</div>' : '') + '</div>';
  }

  // ── מסך פר-כיתה: טבלת תלמידים × קטגוריות (ציון אחרון) ──
  async function renderPage(target) {
    target.innerHTML = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>מעקב קריאה</h2>' +
      '<div class="head-actions">' + (isAdmin() ? '<button class="btn-ghost sm" id="raCats"><i class="bi bi-gear"></i> קטגוריות</button>' : '') + '</div></div>' +
      '<div class="toolbar"><select class="inp mb0" id="raClass"><option value="">בחר כיתה…</option></select></div>' +
      '<div id="raGrid" class="table-wrap"></div>';
    const [classes, cs, students] = await Promise.all([
      window.store.list('classes'), cats(),
      (window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students')),
    ]);
    const sel = target.querySelector('#raClass');
    sel.innerHTML = '<option value="">בחר כיתה…</option>' + classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const cg = target.querySelector('#raCats'); if (cg) cg.addEventListener('click', () => editCategories());

    async function drawGrid(classId) {
      const grid = target.querySelector('#raGrid');
      if (!classId) { grid.innerHTML = '<div class="empty-state"><i class="bi bi-book"></i><div>בחר כיתה להצגת מעקב הקריאה</div></div>'; return; }
      const kids = students.filter(s => String(s.class_id) === String(classId));
      const all = await Promise.all(kids.map(async k => ({ s: k, a: (await forStudent(k.id))[0] })));
      const head = '<tr><th>תלמיד</th>' + cs.map(c => '<th>' + esc(c.name) + '</th>').join('') + '<th></th></tr>';
      const rows = all.map(({ s, a }) => {
        const sc = (a && a.scores) || {};
        return '<tr><td>' + esc(window.UI.fullName(s)) + '</td>' +
          cs.map(c => '<td>' + (sc[c.id] != null ? '<b>' + esc(sc[c.id]) + '</b>' : '<span style="color:var(--muted)">—</span>') + '</td>').join('') +
          '<td class="row-act"><button class="mini" data-add="' + s.id + '" title="הערכה חדשה"><i class="bi bi-plus-lg"></i></button></td></tr>';
      }).join('');
      grid.innerHTML = '<table class="tbl"><thead>' + head + '</thead><tbody>' + (rows || '<tr><td colspan="' + (cs.length + 2) + '">אין תלמידים בכיתה</td></tr>') + '</tbody></table>';
      grid.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
        const st = kids.find(k => String(k.id) === b.dataset.add);
        if (st) openAssessment(st, () => drawGrid(classId));
      }));
    }
    sel.addEventListener('change', () => drawGrid(sel.value));
    drawGrid('');
  }

  // ── עורך קטגוריות (מנהל) ──
  async function editCategories() {
    const cs = (await window.store.list('reading_categories')).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
    const rowHtml = c => '<div class="fld" data-id="' + c.id + '" style="display:flex;gap:6px;align-items:center;margin-bottom:6px">' +
      '<input class="inp mb0 rc-name" value="' + esc(c.name) + '" style="flex:1">' +
      '<label style="font-size:.8rem;white-space:nowrap"><input type="checkbox" class="rc-active"' + (c.active !== false ? ' checked' : '') + '> פעיל</label>' +
      '<button class="mini danger rc-del" title="מחיקה"><i class="bi bi-trash"></i></button></div>';
    const body = '<div id="rcList">' + cs.map(rowHtml).join('') + '</div>' +
      '<button class="btn-ghost sm" id="rcAdd" style="margin-top:6px"><i class="bi bi-plus-lg"></i> קטגוריה חדשה</button>';
    window.UI.modal({
      title: 'קטגוריות מעקב קריאה', bodyHTML: body, saveLabel: 'שמירה',
      onSave: async (m) => {
        const items = [...m.querySelectorAll('#rcList .fld')];
        let order = 1;
        for (const el of items) {
          const id = el.dataset.id;
          const name = (el.querySelector('.rc-name').value || '').trim();
          const active = el.querySelector('.rc-active').checked;
          if (!name) continue;
          if (String(id).startsWith('new')) await window.store.add('reading_categories', { name, active, sort_order: order });
          else await window.store.update('reading_categories', Number(id), { name, active, sort_order: order });
          order++;
        }
        window.UI.toast('קטגוריות עודכנו'); return true;
      },
    });
    // wire add/delete inside the just-opened modal
    setTimeout(() => {
      const list = document.querySelector('#rcList');
      const add = document.querySelector('#rcAdd');
      if (add) add.addEventListener('click', () => {
        const wrap = document.createElement('div'); wrap.className = 'fld'; wrap.dataset.id = 'new' + Date.now();
        wrap.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
        wrap.innerHTML = '<input class="inp mb0 rc-name" placeholder="שם קטגוריה" style="flex:1">' +
          '<label style="font-size:.8rem;white-space:nowrap"><input type="checkbox" class="rc-active" checked> פעיל</label>' +
          '<button class="mini danger rc-del" title="הסר"><i class="bi bi-trash"></i></button>';
        list.appendChild(wrap);
        wrap.querySelector('.rc-del').addEventListener('click', () => wrap.remove());
      });
      list && list.querySelectorAll('.rc-del').forEach(b => b.addEventListener('click', async (e) => {
        const row = e.target.closest('.fld'); const id = row.dataset.id;
        if (!String(id).startsWith('new')) { if (!await window.UI.confirm('למחוק קטגוריה זו?')) return; await window.store.remove('reading_categories', Number(id)); }
        row.remove();
      }));
    }, 60);
  }

  window.cv3ReadAssess = { openAssessment, cats, forStudent, cardSection, editCategories };
  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.readassess = renderPage;
})();
