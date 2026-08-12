// calendar.js — לוח שנה חודשי מלא (עברי + לועזי) עם סנכרון אירועים, משימות ואסיפות.
// מחליף את הרנדרר המינימלי מ-tracking.js (calendar.js נטען אחריו ב-index.html ולכן גובר).
// RTL, עברית בלבד, עובד גם בדמו (seed) וגם בחי (Supabase). מוגן מפני נתונים חסרים.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = () => window.store;
  const UI = () => window.UI;

  // ---------- עזרי תאריך ----------
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayIso = () => iso(new Date());
  function fmt(d, opts, loc) {
    try { return new Intl.DateTimeFormat(loc || 'he-u-ca-hebrew', opts).format(d); } catch (_) { return ''; }
  }
  const hebDay = d => fmt(d, { day: 'numeric' });                                   // א׳, ט״ו …
  const hebFull = d => fmt(d, { day: 'numeric', month: 'long', year: 'numeric' });  // א׳ באב תשפ״ו
  const gregFull = d => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, 'he-IL');
  // כותרת חודש: עברי מייצג (אמצע החודש הלועזי) + לועזי מלא
  const hebMonthLabel = (y, m) => fmt(new Date(y, m, 15), { month: 'long', year: 'numeric' });
  const gregMonthLabel = (y, m) => fmt(new Date(y, m, 1), { month: 'long', year: 'numeric' }, 'he-IL');

  // ---------- צבעי צ׳יפים ----------
  const KIND = {
    event: { c: '#2563eb', label: 'אירוע' },
    holiday: { c: '#16a34a', label: 'חג/מועד' },
    meeting: { c: '#ea580c', label: 'אסיפה' },
    reminder: { c: '#7c3aed', label: 'תזכורת' },
  };
  const kindOf = k => KIND[k] || KIND.event;
  const TASK_DONE = '#6b7280', TASK_OVERDUE = '#dc2626', TASK_OPEN = '#0d9488', MEET_C = '#db2777';
  const KIND_OPTS = [['event', 'אירוע'], ['holiday', 'חג/מועד'], ['meeting', 'אסיפה'], ['reminder', 'תזכורת']]
    .map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('');

  // ---------- שליפת נתונים (עם סינון הרשאות לפריטים משויכי-תלמיד) ----------
  async function pull() {
    const s = store(); let evs = [], tks = [], mts = [];
    if (s) {
      try { evs = await s.list('calendar_events'); } catch (_) {}
      try { tks = await s.list('tasks'); } catch (_) {}
      try { mts = await s.list('meetings'); } catch (_) {}
    }
    let ids = null;
    try { ids = window.cv3Students ? await window.cv3Students.accessibleIds() : null; } catch (_) {}
    if (ids) {
      tks = (tks || []).filter(t => t.student_id == null || ids.includes(t.student_id));
      mts = (mts || []).filter(m => m.student_id == null || ids.includes(m.student_id));
    }
    return { evs: evs || [], tks: tks || [], mts: mts || [] };
  }

  // בונה מפת iso→[פריטים] מכל שלושת המקורות
  function indexByDate(data) {
    const map = {};
    const push = (k, o) => { (map[k] = map[k] || []).push(o); };
    const tIso = todayIso();
    (data.evs || []).forEach(e => {
      if (!e.date) return;
      const k = kindOf(e.kind);
      push(e.date, { color: k.c, text: e.title || k.label, time: e.time || '', type: 'event', typeLbl: 'אירוע', raw: e });
    });
    (data.tks || []).forEach(t => {
      if (!t.due_date) return;
      const done = t.status === 'done';
      const overdue = !done && String(t.due_date) < tIso;
      const color = done ? TASK_DONE : overdue ? TASK_OVERDUE : TASK_OPEN;
      push(t.due_date, { color, text: 'משימה: ' + (t.title || ''), time: '', type: 'task', typeLbl: 'משימה', raw: t });
    });
    (data.mts || []).forEach(m => {
      if (!m.date) return;
      push(m.date, { color: MEET_C, text: 'אסיפה' + (m.summary ? ': ' + m.summary : ''), time: '', type: 'meeting', typeLbl: 'אסיפת הורים', raw: m });
    });
    return map;
  }

  // ---------- הרנדרר הראשי ----------
  async function renderCalendar(page) {
    const now = new Date();
    const state = { y: now.getFullYear(), m: now.getMonth() };
    const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
      '<h2>לוח שנה</h2>' +
      '<div class="head-actions">' +
        '<button class="btn-primary sm" id="calAdd"><i class="bi bi-plus-lg"></i> אירוע חדש</button>' +
        '<button class="btn-ghost sm" id="calCsv"><i class="bi bi-download"></i> ייצוא CSV</button>' +
      '</div></div>' +
      // סרגל ניווט חודש
      '<div class="qr-card" style="margin-bottom:12px;padding:12px 16px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;direction:rtl">' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<button class="btn-ghost sm" id="calPrev" title="חודש קודם"><i class="bi bi-chevron-right"></i></button>' +
            '<button class="btn-ghost sm" id="calToday"><i class="bi bi-calendar-event"></i> היום</button>' +
            '<button class="btn-ghost sm" id="calNext" title="חודש הבא"><i class="bi bi-chevron-left"></i></button>' +
          '</div>' +
          '<div style="text-align:center;flex:1;min-width:180px">' +
            '<div id="calHeb" style="font-size:1.25rem;font-weight:800;color:var(--primary-dark)"></div>' +
            '<div id="calGreg" style="color:var(--muted);font-size:.9rem"></div>' +
          '</div>' +
          '<div style="min-width:56px"></div>' +
        '</div>' +
      '</div>' +
      // מקרא צבעים
      '<div id="calLegend" style="display:flex;flex-wrap:wrap;gap:10px;margin:0 2px 10px;font-size:.75rem;color:var(--muted);direction:rtl"></div>' +
      // כותרות ימים
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin:0 0 6px;direction:rtl">' +
        dayNames.map(d => '<div style="text-align:center;font-weight:800;font-size:.78rem;color:var(--muted);padding:3px 0">' + d + '</div>').join('') +
      '</div>' +
      // רשת החודש
      '<div id="calGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;direction:rtl"></div>';

    const gridEl = page.querySelector('#calGrid');
    const hebEl = page.querySelector('#calHeb');
    const gregEl = page.querySelector('#calGreg');

    // מקרא (צבע → משמעות)
    page.querySelector('#calLegend').innerHTML = [
      ['#2563eb', 'אירוע'], ['#16a34a', 'חג/מועד'], ['#ea580c', 'אסיפה'], ['#7c3aed', 'תזכורת'],
      ['#0d9488', 'משימה'], ['#dc2626', 'משימה באיחור'], ['#6b7280', 'משימה שהושלמה'], ['#db2777', 'אסיפת הורים'],
    ].map(p => '<span style="display:inline-flex;align-items:center;gap:5px">' +
      '<span style="width:10px;height:10px;border-radius:3px;background:' + p[0] + ';display:inline-block"></span>' + esc(p[1]) + '</span>').join('');

    async function render() {
      hebEl.textContent = hebMonthLabel(state.y, state.m);
      gregEl.textContent = gregMonthLabel(state.y, state.m);
      const map = indexByDate(await pull());
      const tIso = todayIso();
      const offset = new Date(state.y, state.m, 1).getDay();          // 0=ראשון
      const start = new Date(state.y, state.m, 1 - offset);           // תמיד יום ראשון
      let html = '';
      for (let i = 0; i < 42; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const k = iso(d);
        const inMonth = d.getMonth() === state.m;
        const isToday = k === tIso;
        const items = map[k] || [];
        const chips = items.slice(0, 3).map(it =>
          '<div title="' + esc((it.time ? it.time + ' ' : '') + it.text) + '" style="background:' + it.color + ';color:#fff;font-size:.66rem;line-height:1.3;border-radius:5px;padding:1px 5px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            (it.time ? esc(it.time) + ' ' : '') + esc(it.text) + '</div>').join('');
        const more = items.length > 3 ? '<div style="font-size:.64rem;color:var(--muted);margin-top:2px;font-weight:700">+' + (items.length - 3) + ' נוספים</div>' : '';
        html +=
          '<div data-iso="' + k + '" style="min-height:86px;cursor:pointer;border:1px solid ' + (isToday ? 'var(--primary)' : 'var(--line)') +
            ';border-radius:10px;padding:5px 6px;background:' + (inMonth ? 'var(--card)' : 'var(--bg)') + ';opacity:' + (inMonth ? '1' : '.5') +
            ';box-shadow:' + (isToday ? '0 0 0 2px color-mix(in srgb,var(--primary) 30%,transparent)' : 'none') + ';overflow:hidden">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px">' +
              '<span style="font-weight:800;font-size:.9rem;color:' + (isToday ? 'var(--primary)' : 'var(--ink)') + '">' + d.getDate() + '</span>' +
              '<span style="font-size:.68rem;color:var(--muted)">' + esc(hebDay(d)) + '</span>' +
            '</div>' + chips + more +
          '</div>';
      }
      gridEl.innerHTML = html;
      gridEl.querySelectorAll('[data-iso]').forEach(cell =>
        cell.addEventListener('click', () => openDay(cell.dataset.iso)));
    }

    // מודאל יום: רשימת כל הפריטים + טופס הוספת אירוע-לוח
    async function openDay(dayIso) {
      const d = new Date(dayIso + 'T00:00:00');
      const items = indexByDate(await pull())[dayIso] || [];
      const listHtml = items.length ? items.map(it =>
        '<div class="tl-item" style="margin-bottom:6px">' +
          '<span class="sev-dot" style="background:' + it.color + '"></span>' +
          '<div class="tl-main">' + esc(it.text) + '</div>' +
          '<div class="tl-meta">' + esc(it.time || it.typeLbl) + '</div>' +
          (it.type === 'event' ? '<button class="mini danger" data-del="' + it.raw.id + '"><i class="bi bi-trash"></i></button>' : '') +
        '</div>').join('') : '<div class="empty-state" style="padding:16px"><i class="bi bi-calendar3"></i><div>אין פריטים ביום זה</div></div>';

      const bodyHTML =
        '<div style="margin-bottom:14px">' + listHtml + '</div>' +
        '<h4 style="font-size:.85rem;font-weight:800;color:var(--primary-dark);margin:0 2px 8px"><i class="bi bi-plus-circle"></i> הוספת אירוע ליום זה</h4>' +
        '<div class="form-grid">' +
          '<label class="fld fld-wide"><span>כותרת *</span><input class="inp mb0" id="ce_title" autocomplete="off"></label>' +
          '<label class="fld"><span>שעה</span><input class="inp mb0" id="ce_time" type="time"></label>' +
          '<label class="fld"><span>סוג</span><select class="inp mb0" id="ce_kind">' + KIND_OPTS + '</select></label>' +
          '<label class="fld fld-wide"><span>הערה</span><input class="inp mb0" id="ce_note" autocomplete="off"></label>' +
        '</div>';

      const hf = hebFull(d), gf = gregFull(d);
      const m = UI().modal({
        title: [hf, gf].filter(Boolean).map(esc).join(' · ') || esc(dayIso),
        saveLabel: 'הוסף אירוע', bodyHTML,
        onSave: async (mel) => {
          const title = mel.querySelector('#ce_title').value.trim();
          if (!title) { UI().toast('כותרת חובה', 'err'); return false; }
          const row = {
            title: title, date: dayIso,
            time: mel.querySelector('#ce_time').value || '',
            kind: mel.querySelector('#ce_kind').value || 'event',
            note: mel.querySelector('#ce_note').value.trim(),
            created_by: (window.currentUser && window.currentUser.id) || null,
          };
          const r = await store().add('calendar_events', row);
          if (!r || !r.ok) { UI().toast('שגיאה בשמירה', 'err'); return false; }
          UI().toast('האירוע נוסף'); render(); return true;
        },
      });
      // מחיקת אירוע-לוח (calendar_events בלבד — משימות/אסיפות מנוהלות במסכים שלהן)
      m.el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const ok = await UI().confirm('למחוק את האירוע?'); if (!ok) return;
        await store().remove('calendar_events', Number(b.dataset.del));
        UI().toast('נמחק'); m.close(); render();
      }));
    }

    // ייצוא CSV של אירועי הלוח בחודש המוצג (עם BOM לעברית תקינה באקסל)
    function exportCsv() {
      pull().then(data => {
        const evs = (data.evs || []).filter(e => {
          if (!e.date) return false;
          const dt = new Date(e.date + 'T00:00:00');
          return dt.getFullYear() === state.y && dt.getMonth() === state.m;
        }).sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));
        const head = ['כותרת', 'תאריך', 'שעה', 'סוג', 'הערה'];
        const lines = [head.join(',')].concat(evs.map(e =>
          [e.title, e.date, e.time || '', kindOf(e.kind).label, e.note || '']
            .map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')));
        const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'calendar_' + state.y + '-' + pad(state.m + 1) + '.csv'; a.click();
      });
    }

    // חיווט כפתורים
    page.querySelector('#calPrev').addEventListener('click', () => { state.m--; if (state.m < 0) { state.m = 11; state.y--; } render(); });
    page.querySelector('#calNext').addEventListener('click', () => { state.m++; if (state.m > 11) { state.m = 0; state.y++; } render(); });
    page.querySelector('#calToday').addEventListener('click', () => { const n = new Date(); state.y = n.getFullYear(); state.m = n.getMonth(); render(); });
    page.querySelector('#calAdd').addEventListener('click', () => openDay(todayIso()));
    page.querySelector('#calCsv').addEventListener('click', exportCsv);

    render();
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.calendar = renderCalendar;
})();
