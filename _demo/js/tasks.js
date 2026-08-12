// tasks.js — משימות ופרויקטים: לוח קנבן (לביצוע / בתהליך / הושלם) + כרטיסי פרויקטים עם פס-התקדמות.
// כל הנתונים דרך המאגר המרכזי (store.js) — עובד גם בדמו וגם בחי (Supabase). RTL עברית לכל אורך הדף.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const hebDate = iso => { if (!iso) return ''; try { return new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long' }).format(new Date(iso + 'T00:00:00')); } catch (_) { return ''; } };
  const safe = async p => { try { return await p; } catch (_) { return []; } };
  // מזהה: מספר בדמו, מחרוזת (uuid) בחי — שומר את הצורה המתאימה כדי שהשוואות == יעבדו בשני המצבים.
  const idVal = v => (v == null || v === '') ? null : (/^\d+$/.test(String(v)) ? Number(v) : v);

  const ORDER = ['open', 'in_progress', 'done'];
  const COLS = [
    { key: 'open', label: 'לביצוע', ic: 'bi-inbox', color: 'var(--danger)' },
    { key: 'in_progress', label: 'בתהליך', ic: 'bi-hourglass-split', color: 'var(--accent)' },
    { key: 'done', label: 'הושלם', ic: 'bi-check2-circle', color: 'var(--ok)' },
  ];
  const statusHeb = s => s === 'open' ? 'לביצוע' : s === 'in_progress' ? 'בתהליך' : s === 'done' ? 'הושלם' : (s || '');
  // עדיפות: גבוה=אדום, רגיל=אפור, נמוך=כחול
  const prioColor = p => p === 'גבוה' ? 'var(--danger)' : p === 'נמוך' ? '#2b7c98' : 'var(--muted)';
  const prioChipStyle = p => p === 'גבוה'
    ? 'background:color-mix(in srgb,var(--danger) 15%,transparent);color:var(--danger)'
    : p === 'נמוך'
      ? 'background:color-mix(in srgb,#2b7c98 18%,transparent);color:#2b7c98'
      : 'background:color-mix(in srgb,var(--muted) 18%,transparent);color:var(--muted)';

  async function render(page) {
    if (!window.store) return;
    // טעינה מקבילה; מערכים מקומיים ששומרים על מצב ומתעדכנים בזיכרון (mutate + redraw) בלי לרענן מהשרת בכל פעם.
    const projects = await safe(window.store.list('projects'));
    const tasks = await safe(window.store.list('tasks'));
    const students = await safe(window.cv3Students ? window.cv3Students.getStudents() : Promise.resolve([]));
    let staff = await safe(window.store.list('profiles'));      // חי: profiles
    if (!staff || !staff.length) staff = await safe(window.store.list('users')); // דמו/נפילה: users
    staff = staff || [];

    const nameOfStaff = id => { const u = staff.find(x => String(x.id) === String(id)); return u ? u.name : ''; };
    const nameOfStud = id => { const s = students.find(x => String(x.id) === String(id)); return s ? s.name : ''; };
    const projOf = id => projects.find(p => String(p.id) === String(id));
    const projName = id => { const p = projOf(id); return p ? p.name : ''; };
    const byId = id => tasks.find(t => String(t.id) === String(id));
    const isOverdue = t => !!(t.due_date && t.status !== 'done' && t.due_date < today());
    const labelOf = s => (COLS.find(c => c.key === s) || {}).label || '';
    const nextOf = s => ORDER[Math.min(ORDER.indexOf(s) + 1, ORDER.length - 1)];
    const prevOf = s => ORDER[Math.max(ORDER.indexOf(s) - 1, 0)];

    let filterProject = '';
    let filterAssignee = '';
    const filteredTasks = () => tasks.filter(t =>
      (!filterProject || String(t.project_id) === String(filterProject)) &&
      (!filterAssignee || String(t.assignee) === String(filterAssignee)));

    const projOptions = () => projects.map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('');
    const staffOptions = () => staff.map(u => '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>').join('');

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>משימות ופרויקטים</h2>' +
        '<div class="head-actions"><button class="btn-ghost sm" id="tskCsv"><i class="bi bi-download"></i> ייצוא CSV</button></div></div>' +
      '<div class="stat-row" id="tskStats"></div>' +
      '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-collection"></i> פרויקטים</h3>' +
        '<button class="btn-primary sm" id="projAdd"><i class="bi bi-plus-lg"></i> פרויקט חדש</button></div>' +
        '<div id="projRow" style="display:flex;gap:12px;flex-wrap:wrap"></div></div>' +
      '<div class="toolbar" style="grid-template-columns:1fr 1fr auto">' +
        '<select class="inp mb0" id="fProj"><option value="">כל הפרויקטים</option>' + projOptions() + '</select>' +
        '<select class="inp mb0" id="fAssignee"><option value="">כל הצוות</option>' + staffOptions() + '</select>' +
        '<button class="btn-primary sm" id="taskAdd"><i class="bi bi-plus-lg"></i> משימה חדשה</button></div>' +
      '<div class="count-line" id="tskCount"></div>' +
      '<div id="kanban" style="display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:6px"></div>';

    // ---------- סטטיסטיקה (משקפת את התצוגה המסוננת) ----------
    function redrawStats() {
      const rows = filteredTasks();
      const done = rows.filter(t => t.status === 'done').length;
      const openN = rows.length - done;
      const overdue = rows.filter(isOverdue).length;
      const cell = (ic, num, lbl, danger) =>
        '<div class="stat-card"><span class="stat-ic"><i class="bi ' + ic + '"></i></span>' +
        '<span class="stat-num"' + (danger && num ? ' style="color:var(--danger)"' : '') + '>' + num + '</span>' +
        '<span class="stat-lbl">' + lbl + '</span></div>';
      page.querySelector('#tskStats').innerHTML =
        cell('bi-list-task', rows.length, 'סה״כ משימות') +
        cell('bi-inbox', openN, 'משימות פתוחות') +
        cell('bi-exclamation-triangle', overdue, 'באיחור', true) +
        cell('bi-check2-circle', done, 'הושלמו');
    }

    // ---------- כרטיסי פרויקטים ----------
    function redrawProjects() {
      const row = page.querySelector('#projRow');
      if (!projects.length) { row.innerHTML = '<div class="tl-note" style="padding:8px">אין פרויקטים עדיין — הוסף פרויקט חדש</div>'; return; }
      row.innerHTML = projects.map(p => {
        const pts = tasks.filter(t => String(t.project_id) === String(p.id));
        const done = pts.filter(t => t.status === 'done').length;
        const pct = pts.length ? Math.round(done / pts.length * 100) : 0;
        const active = filterProject && String(filterProject) === String(p.id);
        const col = p.color || 'var(--primary)';
        return '<div class="proj-card" data-proj="' + esc(p.id) + '" title="סינון הלוח לפי פרויקט זה" ' +
          'style="flex:1 1 240px;min-width:220px;max-width:340px;background:var(--card);' +
          'border:1px solid ' + (active ? col : 'var(--line)') + ';border-inline-start:4px solid ' + col + ';border-radius:12px;padding:12px 14px;' +
          'box-shadow:' + (active ? '0 0 0 2px ' + col + ' inset, var(--shadow)' : 'var(--shadow)') + ';cursor:pointer">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
            '<strong style="color:var(--primary-dark)">' + esc(p.name) + '</strong>' +
            '<span class="det-badge">' + pts.length + ' משימות</span></div>' +
          (p.description ? '<div class="tl-note" style="font-size:.82rem;margin:4px 0 2px">' + esc(p.description) + '</div>' : '') +
          '<div class="prog" style="margin:8px 0 5px"><div class="prog-bar" style="width:' + pct + '%"></div></div>' +
          '<div style="display:flex;justify-content:space-between;gap:8px;font-size:.74rem;color:var(--muted)">' +
            '<span>' + done + '/' + pts.length + ' הושלמו · ' + pct + '%</span>' +
            (p.due_date ? '<span><i class="bi bi-calendar-event"></i> ' + esc(hebDate(p.due_date)) + '</span>' : '') +
          '</div></div>';
      }).join('');
      row.querySelectorAll('[data-proj]').forEach(c => c.addEventListener('click', () => {
        const id = c.dataset.proj;
        filterProject = String(filterProject) === String(id) ? '' : id;
        const sel = page.querySelector('#fProj'); if (sel) sel.value = filterProject;
        redrawProjects(); redrawBoard(); redrawStats();
      }));
    }

    // ---------- כרטיס משימה ----------
    function taskCard(t) {
      const i = ORDER.indexOf(t.status);
      const over = isOverdue(t);
      const assignee = nameOfStaff(t.assignee);
      const stud = nameOfStud(t.student_id);
      const proj = projName(t.project_id);
      return '<div class="tsk-card" style="background:var(--card);border:1px solid var(--line);border-inline-start:3px solid ' + prioColor(t.priority) + ';' +
        'border-radius:11px;padding:9px 11px;margin-bottom:8px;box-shadow:var(--shadow)">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">' +
          '<strong style="font-size:.9rem;line-height:1.35">' + esc(t.title) + '</strong>' +
          '<span class="chip" style="' + prioChipStyle(t.priority) + ';flex:none">' + esc(t.priority || 'רגיל') + '</span></div>' +
        (t.description ? '<div class="tl-note" style="font-size:.78rem;margin-top:3px">' + esc(t.description) + '</div>' : '') +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:.75rem;color:var(--muted)">' +
          (assignee ? '<span><i class="bi bi-person"></i> ' + esc(assignee) + '</span>' : '') +
          (stud ? '<span><i class="bi bi-mortarboard"></i> ' + esc(stud) + '</span>' : '') +
          (proj ? '<span><i class="bi bi-collection"></i> ' + esc(proj) + '</span>' : '') +
        '</div>' +
        (t.due_date ? '<div style="font-size:.75rem;margin-top:4px;' + (over ? 'color:var(--danger);font-weight:700' : 'color:var(--muted)') + '">' +
          '<i class="bi bi-calendar' + (over ? '-x' : '-event') + '"></i> ' + esc(hebDate(t.due_date)) + (over ? ' · באיחור' : '') + '</div>' : '') +
        '<div style="display:flex;gap:3px;margin-top:8px;justify-content:flex-end">' +
          (i > 0 ? '<button class="mini" data-bak="' + esc(t.id) + '" title="החזר ל' + esc(labelOf(prevOf(t.status))) + '"><i class="bi bi-arrow-right"></i></button>' : '') +
          (i < ORDER.length - 1 ? '<button class="mini" data-adv="' + esc(t.id) + '" title="העבר ל' + esc(labelOf(nextOf(t.status))) + '"><i class="bi bi-arrow-left"></i></button>' : '') +
          '<button class="mini" data-edit="' + esc(t.id) + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
          '<button class="mini danger" data-del="' + esc(t.id) + '" title="מחיקה"><i class="bi bi-trash"></i></button>' +
        '</div></div>';
    }

    // ---------- לוח קנבן ----------
    function redrawBoard() {
      const rows = filteredTasks();
      const kb = page.querySelector('#kanban');
      kb.innerHTML = COLS.map(col => {
        const items = rows.filter(t => t.status === col.key);
        return '<div class="kb-col" style="flex:1 1 0;min-width:230px;background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:10px">' +
          '<div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;padding:2px 4px">' +
            '<span style="width:10px;height:10px;border-radius:50%;background:' + col.color + ';flex:none"></span>' +
            '<strong style="font-size:.92rem;color:var(--primary-dark)"><i class="bi ' + col.ic + '"></i> ' + col.label + '</strong>' +
            '<span class="det-badge" style="margin-inline-start:auto">' + items.length + '</span></div>' +
          '<div class="kb-list">' +
            (items.length ? items.map(taskCard).join('') : '<div class="tl-note" style="text-align:center;padding:16px 6px;font-size:.8rem;opacity:.7">— אין משימות —</div>') +
          '</div></div>';
      }).join('');
      page.querySelector('#tskCount').textContent = rows.length + ' משימות בתצוגה';
      kb.querySelectorAll('[data-adv]').forEach(b => b.addEventListener('click', () => { const t = byId(b.dataset.adv); if (t) move(t, nextOf(t.status)); }));
      kb.querySelectorAll('[data-bak]').forEach(b => b.addEventListener('click', () => { const t = byId(b.dataset.bak); if (t) move(t, prevOf(t.status)); }));
      kb.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { const t = byId(b.dataset.edit); if (t) taskForm(t); }));
      kb.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { const t = byId(b.dataset.del); if (t) delTask(t); }));
    }

    // ---------- פעולות ----------
    async function move(t, status) {
      if (!status || status === t.status) return;
      t.status = status;
      await window.store.update('tasks', t.id, { status });
      redrawBoard(); redrawStats(); redrawProjects();
      window.UI.toast('הועבר ל' + statusHeb(status));
    }

    async function delTask(t) {
      const ok = await window.UI.confirm('למחוק את המשימה "' + esc(t.title) + '"?');
      if (!ok) return;
      await window.store.remove('tasks', t.id);
      const i = tasks.indexOf(t); if (i >= 0) tasks.splice(i, 1);
      redrawBoard(); redrawStats(); redrawProjects();
      window.UI.toast('נמחקה');
    }

    function refreshProjSelect() {
      const sel = page.querySelector('#fProj'); if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '<option value="">כל הפרויקטים</option>' + projOptions();
      sel.value = cur;
    }

    function projectForm() {
      window.UI.modal({
        title: 'פרויקט חדש', saveLabel: 'הוספה',
        bodyHTML:
          '<div class="form-grid">' +
          '<label class="fld fld-wide"><span>שם הפרויקט *</span><input class="inp mb0" id="pr_name" autofocus></label>' +
          '<label class="fld fld-wide"><span>תיאור</span><textarea class="inp mb0" id="pr_desc" rows="2"></textarea></label>' +
          '<label class="fld"><span>תאריך יעד</span><input class="inp mb0" id="pr_due" type="date"></label>' +
          '<label class="fld"><span>צבע</span><input class="inp mb0" id="pr_color" type="color" value="#6c3fc0" style="height:44px;padding:4px"></label>' +
          '</div>',
        onSave: async mel => {
          const name = mel.querySelector('#pr_name').value.trim();
          if (!name) { window.UI.toast('שם חובה', 'err'); return false; }
          const row = {
            name,
            description: mel.querySelector('#pr_desc').value.trim(),
            due_date: mel.querySelector('#pr_due').value || null,
            color: mel.querySelector('#pr_color').value || '#6c3fc0',
            status: 'active',
            created_by: (window.currentUser || {}).id || null,
          };
          const r = await window.store.add('projects', row);
          projects.push((r.data && r.data[0]) || Object.assign({ id: Date.now() }, row));
          refreshProjSelect(); redrawProjects(); redrawStats();
          window.UI.toast('הפרויקט נוסף');
          return true;
        },
      });
    }

    async function taskForm(existing) {
      const t = existing || {};
      const pickHtml = await window.cv3Picker.html('tk', { placeholder: '🔍 שייך תלמיד (רשות)…' });
      const projSel = '<option value="">— ללא פרויקט —</option>' +
        projects.map(p => '<option value="' + esc(p.id) + '"' + (String(t.project_id) === String(p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
      const assSel = '<option value="">— לא משויך —</option>' +
        staff.map(u => '<option value="' + esc(u.id) + '"' + (String(t.assignee) === String(u.id) ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('');
      const prioSel = ['נמוך', 'רגיל', 'גבוה'].map(p => '<option' + ((t.priority || 'רגיל') === p ? ' selected' : '') + '>' + p + '</option>').join('');
      let pick = null;
      const m = window.UI.modal({
        title: existing ? 'עריכת משימה' : 'משימה חדשה', saveLabel: 'שמירה',
        bodyHTML:
          '<div class="form-grid">' +
          '<label class="fld fld-wide"><span>כותרת *</span><input class="inp mb0" id="tk_title" value="' + esc(t.title) + '"></label>' +
          '<label class="fld fld-wide"><span>תיאור</span><textarea class="inp mb0" id="tk_desc" rows="2">' + esc(t.description) + '</textarea></label>' +
          '<label class="fld"><span>פרויקט</span><select class="inp mb0" id="tk_proj">' + projSel + '</select></label>' +
          '<label class="fld"><span>אחראי</span><select class="inp mb0" id="tk_ass">' + assSel + '</select></label>' +
          '<label class="fld"><span>תאריך יעד</span><input class="inp mb0" id="tk_due" type="date" value="' + esc(t.due_date || '') + '"></label>' +
          '<label class="fld"><span>עדיפות</span><select class="inp mb0" id="tk_prio">' + prioSel + '</select></label>' +
          '<div class="fld fld-wide"><span>תלמיד משויך (רשות)</span>' + pickHtml + '</div>' +
          '</div>',
        onSave: async mel => {
          const title = mel.querySelector('#tk_title').value.trim();
          if (!title) { window.UI.toast('כותרת חובה', 'err'); return false; }
          const row = {
            title,
            description: mel.querySelector('#tk_desc').value.trim(),
            project_id: idVal(mel.querySelector('#tk_proj').value),
            assignee: idVal(mel.querySelector('#tk_ass').value),
            student_id: idVal(pick ? pick.value() : ''),
            due_date: mel.querySelector('#tk_due').value || null,
            priority: mel.querySelector('#tk_prio').value,
            status: existing ? existing.status : 'open',
          };
          if (existing) {
            await window.store.update('tasks', existing.id, row);
            Object.assign(existing, row);
            window.UI.toast('המשימה עודכנה');
          } else {
            row.created_by = (window.currentUser || {}).id || null;
            const r = await window.store.add('tasks', row);
            tasks.push((r.data && r.data[0]) || Object.assign({ id: Date.now() }, row));
            window.UI.toast('המשימה נוספה');
          }
          redrawBoard(); redrawStats(); redrawProjects();
          return true;
        },
      });
      pick = window.cv3Picker.wire(m.el, 'tk');
      if (existing && existing.student_id != null) pick.set(existing.student_id);
    }

    // ---------- ייצוא CSV (כל המשימות) ----------
    function exportCsv() {
      const head = ['כותרת', 'פרויקט', 'אחראי', 'תלמיד', 'תאריך יעד', 'עדיפות', 'סטטוס'];
      const lines = [head.join(',')].concat(tasks.map(t =>
        [t.title, projName(t.project_id), nameOfStaff(t.assignee), nameOfStud(t.student_id), t.due_date || '', t.priority || '', statusHeb(t.status)]
          .map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tasks.csv'; a.click();
    }

    // ---------- חיווט ----------
    page.querySelector('#projAdd').addEventListener('click', projectForm);
    page.querySelector('#taskAdd').addEventListener('click', () => taskForm(null));
    page.querySelector('#tskCsv').addEventListener('click', exportCsv);
    page.querySelector('#fProj').addEventListener('change', e => { filterProject = e.target.value; redrawProjects(); redrawBoard(); redrawStats(); });
    page.querySelector('#fAssignee').addEventListener('change', e => { filterAssignee = e.target.value; redrawBoard(); redrawStats(); });

    redrawStats(); redrawProjects(); redrawBoard();
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.tasks = render;
})();
