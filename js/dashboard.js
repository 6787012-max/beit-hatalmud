// dashboard.js — חלק 6: דשבורד + דוחות + חיפוש מהיר (Ctrl+K) + ייצוא.
(function () {
  'use strict';
  const DEMO = !window.sb;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function students() { return (window.cv3Students ? await window.cv3Students.getStudents() : []); }

  async function renderReports(page) {
    const [studs, beh, att, tst, catRows] = await Promise.all([
      students(), window.store.list('behavior_events'), window.store.list('attendance'), window.store.list('tests'), window.store.list('categories')
    ]);
    const todayStr = new Date().toISOString().slice(0, 10);
    const ids = window.cv3Students ? await window.cv3Students.accessibleIds() : null;
    const sc = arr => ids ? arr.filter(r => ids.includes(r.student_id)) : arr;
    const behS = sc(beh), attS = sc(att), tstS = sc(tst);
    const stats = { students: studs.length, behavior: behS.length, attendance: attS.filter(a => a.date === todayStr && a.status === 'present').length, tests: tstS.length };
    const cats = catRows.map(c => c.name);
    const vals = catRows.map(c => behS.filter(e => e.category_id === c.id).length);
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>דשבורד ודוחות</h2>' +
      '<div class="head-actions"><button class="btn-ghost sm" id="rpExport"><i class="bi bi-download"></i> ייצוא דוח (Excel/CSV)</button>' +
      '<button class="btn-ghost sm" id="rpPrint"><i class="bi bi-printer"></i> הדפסה / PDF</button></div></div>' +
      '<div class="stat-row">' +
        statCard('bi-people-fill', stats.students, 'תלמידים') +
        statCard('bi-clipboard-check', stats.behavior, 'דיווחי התנהגות') +
        statCard('bi-calendar-check', stats.attendance, 'נוכחות היום') +
        statCard('bi-card-checklist', stats.tests, 'מבחנים') +
      '</div>' +
      '<div class="dash-grid">' +
        '<div class="qr-card"><h3><i class="bi bi-graph-up-arrow"></i> התנהגות לפי קטגוריה</h3><canvas id="behChart" height="150"></canvas></div>' +
        '<div class="qr-card"><h3><i class="bi bi-star"></i> תלמידים לתשומת לב</h3><div id="noteList"></div></div>' +
      '</div>';
    // students to note (demo: those with status not active, or first few)
    // תלמידים עם דיווחי התנהגות אחרונים (ללא כפילויות)
    const recentIds = [...new Set(behS.slice().reverse().map(e => e.student_id))];
    const note = recentIds.map(id => studs.find(s => s.id === id)).filter(Boolean).slice(0, 4);
    page.querySelector('#noteList').innerHTML = note.length ? note.map(s =>
      '<div class="tl-item" style="margin-bottom:6px"><span class="ava">' + esc((s.name || '?').slice(0, 2)) + '</span><div class="tl-main">' + esc(s.name) + '</div></div>').join('')
      : '<div class="empty-state" style="padding:18px">אין התראות</div>';
    page.querySelector('#rpPrint').addEventListener('click', () => window.print());
    // ייצוא דוח דשבורד ל-Excel/CSV (בקשת עמנואל: בדשבורד דוחות לא היה ייצוא)
    const hebDate = iso => { if (!iso) return ''; try { return new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso + 'T00:00:00')); } catch (_) { return ''; } };
    const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
    const catName = id => { const c = catRows.find(x => x.id == id); return c ? c.name : ''; };
    page.querySelector('#rpExport').addEventListener('click', () => {
      const rows = [];
      rows.push(['סיכום דוח דשבורד']);
      rows.push(['תלמידים', stats.students], ['דיווחי התנהגות', stats.behavior], ['נוכחות היום', stats.attendance], ['מבחנים', stats.tests]);
      rows.push([]);
      rows.push(['התנהגות לפי קטגוריה']);
      cats.forEach((c, i) => rows.push([c, vals[i]]));
      rows.push([]);
      rows.push(['פירוט דיווחי התנהגות']);
      rows.push(['תלמיד', 'קטגוריה', 'תאריך', 'תאריך עברי', 'שעה', 'הערה']);
      behS.slice().reverse().forEach(e => rows.push([nameOf(e.student_id), catName(e.category_id), e.event_date || '', hebDate(e.event_date), e.event_time || '', e.note || '']));
      const csv = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dashboard_report.csv'; a.click();
    });
    // chart
    if (window.Chart) {
      const ctx = page.querySelector('#behChart');
      new window.Chart(ctx, {
        type: 'bar',
        data: { labels: cats, datasets: [{ data: vals, backgroundColor: ['#1f8a5b', '#c0392b', '#2b7c98', '#c98a1a'], borderRadius: 6 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, maintainAspectRatio: false },
      });
    } else {
      page.querySelector('#behChart').outerHTML = '<div class="empty-state" style="padding:18px">גרף ייטען כשספריית Chart.js תהיה זמינה</div>';
    }
  }
  function statCard(icon, num, label) {
    return '<div class="stat-card"><div class="stat-ic"><i class="bi ' + icon + '"></i></div>' +
      '<div class="stat-num">' + esc(num) + '</div><div class="stat-lbl">' + esc(label) + '</div></div>';
  }

  // ----- חיפוש מהיר Ctrl+K -----
  function openSearch() {
    const mods = (window.MODULES || []).filter(m => !window.Auth || window.Auth.canAccess(m.id)).map(m => ({ type: 'מסך', label: m.label, go: () => showPage(m.id) }));
    let items = mods.slice();
    students().then(ss => { items = mods.concat(ss.map(s => ({ type: 'תלמיד', label: s.name, go: () => showPage('students') }))); draw(); });
    const m = window.UI.modal({ title: 'חיפוש מהיר', bodyHTML: '<input class="inp mb0" id="qkInput" placeholder="הקלד מסך או תלמיד…" autofocus><div id="qkRes" class="qk-res"></div>' });
    const input = m.el.querySelector('#qkInput');
    function draw() {
      const q = (input.value || '').trim();
      const res = (q ? items.filter(i => i.label.includes(q)) : items).slice(0, 8);
      m.el.querySelector('#qkRes').innerHTML = res.map((i, idx) =>
        '<button class="qk-item" data-i="' + items.indexOf(i) + '"><span class="qk-type">' + i.type + '</span> ' + esc(i.label) + '</button>').join('');
      m.el.querySelectorAll('.qk-item').forEach(btn => btn.addEventListener('click', () => { items[btn.dataset.i].go(); m.close(); }));
    }
    input.addEventListener('input', draw);
    setTimeout(() => input.focus(), 30);
    draw();
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (window.currentUser) openSearch(); }
  });

  const R = window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  R.reports = renderReports;
})();
