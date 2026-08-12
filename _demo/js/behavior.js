// behavior.js — חלק 4: מעקב התנהגות (דיווח מהיר + ציר-זמן) + קריאה + כתיבה.
// כל דיווח נשמר דרך window.db (Supabase) או דמו מקומי. audit נרשם בצד-שרת (עתידי).
(function () {
  'use strict';
  const DEMO = !window.sb;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const isAdmin = () => !!(window.currentUser && window.currentUser.role === 'מנהל');
  const hebDate = iso => { if (!iso) return ''; try { return new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso + 'T00:00:00')); } catch (_) { return ''; } };

  const sevClass = s => s === 'גבוהה' ? 'hi' : s === 'נמוכה' ? 'lo' : 'mid';

  // כל הנתונים דרך המאגר המרכזי (store.js)
  async function students() { return (window.cv3Students ? await window.cv3Students.getStudents() : []); }
  async function cats() { return window.store.list('categories'); }
  async function events() {
    let ev = (await window.store.list('behavior_events')).slice().reverse();
    const ids = window.cv3Students ? await window.cv3Students.accessibleIds() : null;
    if (ids) ev = ev.filter(e => ids.includes(e.student_id));
    return ev;
  }
  async function addEvent(row) { const r = await window.store.add('behavior_events', row); return { ok: r.ok, data: r.data }; }
  async function delEvent(id) { return window.store.remove('behavior_events', id); }

  async function classes() { return window.cv3Students ? await window.cv3Students.getClasses() : []; }

  async function renderBehavior(page) {
    const [studs, cs, evs, cls] = await Promise.all([students(), cats(), events(), classes()]);
    const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
    const catOf = id => { const c = cs.find(x => x.id == id); return c ? c.name : ''; };
    const clsOf = sid => { const s = studs.find(x => x.id == sid); const c = s && cls.find(x => x.id == s.class_id); return c ? c.name : 'ללא כיתה'; };
    const catOpts = cs.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const pickAdd = await window.cv3Picker.html('q');
    const pickFilter = await window.cv3Picker.html('f', { placeholder: 'כל התלמידים' });
    const catFilterOpts = cs.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>מעקב תלמידים</h2>' +
      '<div class="head-actions"><button class="btn-ghost sm" id="behCsv"><i class="bi bi-download"></i> ייצוא דוח CSV</button></div></div>' +
      '<div class="qr-card"><h3><i class="bi bi-lightning-charge"></i> רישום חדש</h3>' +
        '<div class="qr-grid" style="grid-template-columns:repeat(3,1fr) auto">' +
          pickAdd +
          '<div style="display:flex;gap:6px"><select class="inp mb0" id="qCat" style="flex:1"><option value="">קטגוריה…</option>' + catOpts + '</select>' +
            (isAdmin() ? '<button class="btn-ghost sm" id="qCatAdd" type="button" title="הוסף קטגוריה"><i class="bi bi-plus-lg"></i></button>' : '') + '</div>' +
          '<div style="display:flex;flex-direction:column;gap:2px"><input class="inp mb0" id="qDate" type="date" value="' + today() + '" title="תאריך">' +
            '<span class="heb-date" id="qDateHeb" style="font-size:.72rem;color:var(--muted,#888);padding-right:2px"></span></div>' +
          '<input class="inp mb0" id="qTime" type="time" title="שעה">' +
          '<input class="inp mb0 fld-wide" id="qNote" placeholder="הערה" style="grid-column:1/-2">' +
          '<button class="btn-primary sm" id="qSave"><i class="bi bi-plus-lg"></i> רישום</button>' +
        '</div></div>' +
      '<div class="toolbar" style="grid-template-columns:1fr auto auto auto">' + pickFilter +
        '<select class="inp mb0" id="fCat"><option value="">כל הקטגוריות</option>' + catFilterOpts + '</select>' +
        '<select class="inp mb0" id="fGroup" title="תצוגה לפי"><option value="">ללא קיבוץ</option><option value="student">לפי תלמיד</option><option value="class">לפי כיתה</option><option value="cat">לפי קטגוריה</option></select>' +
        '<span class="count-line" id="evCount" style="align-self:center"></span></div>' +
      '<div id="timeline"></div>' +
      '<div id="evEmpty" class="empty-state" hidden><i class="bi bi-clipboard-check"></i><div>אין דיווחים עדיין — השתמש בדיווח המהיר למעלה</div></div>';

    const pick = window.cv3Picker.wire(page, 'q');
    const fpick = window.cv3Picker.wire(page, 'f', () => draw());
    // תאריך עברי חי ליד בורר התאריך (בקשת עמנואל)
    const qDateEl = page.querySelector('#qDate'), qDateHeb = page.querySelector('#qDateHeb');
    const syncHeb = () => { if (qDateHeb) qDateHeb.textContent = hebDate(qDateEl.value); };
    if (qDateEl) { qDateEl.addEventListener('change', syncHeb); syncHeb(); }
    // הוספת קטגוריה מהירה — למנהל בלבד (בקשת עמנואל: לחסום למחנך)
    const qCatAddBtn = page.querySelector('#qCatAdd');
    if (qCatAddBtn) qCatAddBtn.addEventListener('click', () => {
      window.UI.modal({
        title: 'קטגוריה חדשה', saveLabel: 'הוסף',
        bodyHTML: '<div class="form-grid"><label class="fld fld-wide"><span>שם הקטגוריה *</span><input class="inp mb0" id="nc_name" autofocus></label></div>',
        onSave: async (mel) => {
          const name = mel.querySelector('#nc_name').value.trim();
          if (!name) { window.UI.toast('שם חובה', 'err'); return false; }
          const r = await window.store.add('categories', { name, kind: 'behavior' });
          const nc = (r.data && r.data[0]) || { id: Date.now(), name, kind: 'behavior' };
          cs.push(nc);
          const sel = page.querySelector('#qCat'), o = document.createElement('option');
          o.value = nc.id; o.textContent = name; sel.appendChild(o); sel.value = String(nc.id);
          window.UI.toast('קטגוריה נוספה'); return true;
        },
      });
    });
    let list = evs;
    const filtered = () => {
      const f = fpick.value(), fc = page.querySelector('#fCat').value;
      return list.filter(e => (!f || String(e.student_id) === f) && (!fc || String(e.category_id) === fc));
    };
    const itemHtml = e =>
      '<div class="tl-item"><span class="sev-dot ' + sevClass(e.severity) + '"></span>' +
      '<div class="tl-main"><strong>' + esc(nameOf(e.student_id)) + '</strong> · ' + esc(catOf(e.category_id)) +
      (e.note ? ' <span class="tl-note">— ' + esc(e.note) + '</span>' : '') + '</div>' +
      '<div class="tl-meta">' + esc(hebDate(e.event_date) || e.event_date) + (e.event_time ? ' · ' + esc(e.event_time) : '') + '</div>' +
      '<button class="mini danger" data-del="' + e.id + '"><i class="bi bi-trash"></i></button></div>';
    const groupKey = (e, g) => g === 'student' ? nameOf(e.student_id) : g === 'class' ? clsOf(e.student_id) : catOf(e.category_id) || 'ללא קטגוריה';
    function draw() {
      const rows = filtered();
      const g = page.querySelector('#fGroup').value;
      if (!g) {
        page.querySelector('#timeline').innerHTML = rows.map(itemHtml).join('');
      } else {
        const groups = {};
        rows.forEach(e => { const k = groupKey(e, g); (groups[k] = groups[k] || []).push(e); });
        page.querySelector('#timeline').innerHTML = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'he'))
          .map(k => '<div class="group-sec"><h4 class="group-title" style="margin:14px 2px 6px;font-size:.95rem;color:var(--primary-dark)">' +
            esc(k) + ' <span style="color:var(--muted);font-weight:400">(' + groups[k].length + ')</span></h4>' +
            groups[k].map(itemHtml).join('') + '</div>').join('');
      }
      page.querySelector('#evCount').textContent = rows.length + ' דיווחים';
      page.querySelector('#evEmpty').hidden = rows.length > 0;
      page.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const ok = await window.UI.confirm('למחוק את הדיווח?'); if (!ok) return;
        await delEvent(Number(b.dataset.del)); list = list.filter(e => e.id != b.dataset.del); draw(); window.UI.toast('נמחק');
      }));
    }
    page.querySelector('#fCat').addEventListener('change', draw);
    page.querySelector('#fGroup').addEventListener('change', draw);
    page.querySelector('#behCsv').addEventListener('click', () => {
      const head = ['תלמיד', 'קטגוריה', 'תאריך', 'שעה', 'הערה'];
      const lines = [head.join(',')].concat(filtered().map(e =>
        [nameOf(e.student_id), catOf(e.category_id), e.event_date, e.event_time || '', e.note || '']
          .map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'behavior_report.csv'; a.click();
    });
    page.querySelector('#qSave').addEventListener('click', async () => {
      const sid = pick.value(), cid = page.querySelector('#qCat').value;
      if (!sid) { window.UI.toast('בחר תלמיד', 'err'); return; }
      const row = { student_id: Number(sid), category_id: cid ? Number(cid) : null, event_date: page.querySelector('#qDate').value || today(), event_time: page.querySelector('#qTime').value, note: page.querySelector('#qNote').value.trim() };
      const r = await addEvent(row); if (!r.ok) { window.UI.toast('שגיאה', 'err'); return; }
      list = [(r.data && r.data[0]) || row].concat(list);
      page.querySelector('#qNote').value = ''; page.querySelector('#qTime').value = ''; page.querySelector('#qCat').selectedIndex = 0;
      draw(); window.UI.toast('דווח בהצלחה');
    });
    draw();
  }

  // מחולל דף-לוג פשוט לקריאה/כתיבה (רמה + תאריך + הערה לתלמיד)
  function makeLog(table, title, icon) {
    return async function (page) {
      const uid = table;   // סיומת ייחודית ל-id-ים (מונע כפילות DOM בין קריאה/כתיבה)
      const studs = await students();
      const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
      const pickHtml = await window.cv3Picker.html('l');
      page.innerHTML =
        '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>' + title + '</h2></div>' +
        '<div class="qr-card"><h3><i class="bi ' + icon + '"></i> רישום חדש</h3><div class="qr-grid">' +
          pickHtml +
          '<input class="inp mb0" id="lLevel-' + uid + '" placeholder="רמה / הישג">' +
          '<input class="inp mb0" id="lNote-' + uid + '" placeholder="הערה (רשות)">' +
          '<button class="btn-primary sm" id="lSave-' + uid + '"><i class="bi bi-plus-lg"></i> הוסף</button>' +
        '</div></div><div id="logList-' + uid + '"></div>' +
        '<div id="logEmpty-' + uid + '" class="empty-state" hidden><i class="bi ' + icon + '"></i><div>אין רישומים עדיין</div></div>';
      const pick = window.cv3Picker.wire(page, 'l');
      let data = await window.store.list(table);
      const _ids = window.cv3Students ? await window.cv3Students.accessibleIds() : null;
      if (_ids) data = data.filter(x => _ids.includes(x.student_id));
      function draw() {
        page.querySelector('#logList-' + uid).innerHTML = data.slice().reverse().map(x =>
          '<div class="tl-item"><span class="sev-dot mid"></span><div class="tl-main"><strong>' + esc(nameOf(x.student_id)) + '</strong> · ' + esc(x.level) +
          (x.note ? ' <span class="tl-note">— ' + esc(x.note) + '</span>' : '') + '</div><div class="tl-meta">' + esc(x.date) + '</div></div>').join('');
        page.querySelector('#logEmpty-' + uid).hidden = data.length > 0;
      }
      page.querySelector('#lSave-' + uid).addEventListener('click', async () => {
        const sid = pick.value(); if (!sid) { window.UI.toast('בחר תלמיד', 'err'); return; }
        const row = { student_id: Number(sid), level: page.querySelector('#lLevel-' + uid).value.trim(), note: page.querySelector('#lNote-' + uid).value.trim(), date: today() };
        const r = await window.store.add(table, row);
        data = data.concat([(r.data && r.data[0]) || row]);
        page.querySelector('#lLevel-' + uid).value = ''; page.querySelector('#lNote-' + uid).value = '';
        draw(); window.UI.toast('נוסף');
      });
      draw();
    };
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.behavior = renderBehavior;
  window.PAGE_RENDERERS.reading = makeLog('reading', 'קידום קריאה', 'bi-book');
  window.PAGE_RENDERERS.writing = makeLog('writing', 'מעקב כתיבה', 'bi-pencil-square');
})();
