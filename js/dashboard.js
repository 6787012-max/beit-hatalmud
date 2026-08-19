// dashboard.js — חלק 6: דשבורד + דוחות + חיפוש מהיר (Ctrl+K) + ייצוא.
// שוכתב 2026-08-19: הדשבורד הציג רק ספירות ו"נוכחות היום", כך שנתוני נוכחות
// מתאריך אחר, מבחנים, מעקב קריאה ותל"א פשוט לא הופיעו. עכשיו: טווח תאריכים,
// סינון כיתה, ודוח לכל מודול — כולל ייצוא CSV של הכל.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = n => (n < 10 ? '0' : '') + n;
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : (s || ''); };
  const daysBack = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
  const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;
  async function students() { return (window.cv3Students ? await window.cv3Students.getStudents() : []); }
  const fullName = s => window.UI.fullName(s) || '—';

  // טווח ברירת-מחדל וסינון נשמרים בין כניסות למסך
  const F = { from: daysBack(30), to: iso(new Date()), classId: '' };
  let CHARTS = [];
  function killCharts() { CHARTS.forEach(c => { try { c.destroy(); } catch (_) {} }); CHARTS = []; }

  async function renderReports(page) {
    const [studs, cls, beh, att, tst, catRows, fnc, tui] = await Promise.all([
      students(),
      window.cv3Students ? window.cv3Students.getClasses() : [],
      window.store.list('behavior_events'), window.store.list('attendance'),
      window.store.list('tests'), window.store.list('categories'),
      window.store.list('functioning'), window.store.list('tuition'),
    ]);
    // מודולים אופציונליים — רק אם נטענו
    const [raCats, raAll, tlaPlans] = await Promise.all([
      window.cv3ReadAssess ? window.store.list('reading_categories') : Promise.resolve([]),
      window.cv3ReadAssess ? window.store.list('reading_assessments') : Promise.resolve([]),
      window.cv3Tla ? window.store.list('tla_plans') : Promise.resolve([]),
    ]);

    const ids = window.cv3Students ? await window.cv3Students.accessibleIds() : null;
    const clsName = cid => { const c = cls.find(x => x.id == cid); return c ? c.name : 'ללא כיתה'; };
    const stById = id => studs.find(x => x.id == id);

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>דשבורד ודוחות</h2>' +
      '<div class="head-actions"><button class="btn-ghost sm" id="rpExport"><i class="bi bi-download"></i> ייצוא דוח מלא (CSV)</button>' +
      '<button class="btn-ghost sm" id="rpPrint"><i class="bi bi-printer"></i> הדפסה / PDF</button></div></div>' +
      '<div class="toolbar rp-bar" style="grid-template-columns:auto auto auto 1fr auto">' +
        '<label class="rp-f"><span>מתאריך</span><input type="date" class="inp mb0" id="rpFrom" value="' + F.from + '"></label>' +
        '<label class="rp-f"><span>עד תאריך</span><input type="date" class="inp mb0" id="rpTo" value="' + F.to + '"></label>' +
        '<label class="rp-f"><span>כיתה</span><select class="inp mb0" id="rpClass"><option value="">כל הכיתות</option>' +
          cls.map(c => '<option value="' + c.id + '"' + (String(F.classId) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') +
        '</select></label>' +
        '<span class="rp-quick"><button class="btn-ghost sm" data-q="7">7 ימים</button>' +
          '<button class="btn-ghost sm" data-q="30">30 יום</button>' +
          '<button class="btn-ghost sm" data-q="365">שנה</button></span>' +
        '<span class="count-line" id="rpRange" style="align-self:center"></span>' +
      '</div><div id="rpBody"></div>';

    const body = page.querySelector('#rpBody');

    function draw() {
      killCharts();
      const from = F.from, to = F.to;
      // תלמידים בתחום ההרשאה + סינון כיתה
      const inScope = studs.filter(s => (!ids || ids.includes(s.id)) && (!F.classId || String(s.class_id) === String(F.classId)));
      const sIds = inScope.map(s => s.id);
      const inRange = (d) => { const v = String(d || '').slice(0, 10); return v >= from && v <= to; };
      const mine = arr => (arr || []).filter(r => sIds.includes(r.student_id));

      const behR = mine(beh).filter(e => inRange(e.event_date));
      const attR = mine(att).filter(a => inRange(a.date));
      const tstR = mine(tst).filter(t => inRange(t.date));
      const fncR = mine(fnc).filter(f => inRange(f.date));
      const raR = mine(raAll).filter(a => inRange(a.assessed_on || a.created_at));
      const tuiR = mine(tui);
      const tlaR = (tlaPlans || []).filter(p => sIds.includes(p.student_id));

      const present = attR.filter(a => a.status === 'present').length;
      const late = attR.filter(a => a.status === 'late').length;
      const absent = attR.filter(a => a.status === 'absent').length;
      const attTotal = attR.length;
      const grades = tstR.map(t => Number(t.grade)).filter(n => !isNaN(n));
      const avgGrade = grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : null;

      page.querySelector('#rpRange').textContent = dmy(from) + ' – ' + dmy(to) + ' · ' + inScope.length + ' תלמידים';

      // ── כרטיסי סיכום ──
      let h = '<div class="stat-row rp-stats">' +
        statCard('bi-people-fill', inScope.length, 'תלמידים') +
        statCard('bi-calendar-check', attTotal ? pct(present + late, attTotal) + '%' : '—', 'נוכחות בטווח') +
        statCard('bi-clock-history', late, 'איחורים') +
        statCard('bi-person-x', absent, 'היעדרויות') +
        statCard('bi-clipboard-check', behR.length, 'דיווחי מעקב') +
        statCard('bi-card-checklist', avgGrade == null ? '—' : avgGrade, 'ממוצע מבחנים') +
        '</div>';

      // ── התראה כשאין נתונים בטווח בכלל ──
      if (!attTotal && !behR.length && !tstR.length && !raR.length) {
        const allDates = mine(att).map(a => a.date).concat(mine(beh).map(e => e.event_date)).filter(Boolean).sort();
        h += '<div class="empty-state" style="padding:22px"><i class="bi bi-inbox"></i>' +
          '<div>אין נתונים בטווח שנבחר.' +
          (allDates.length ? ' רשומות קיימות בין ' + esc(dmy(allDates[0])) + ' ל־' + esc(dmy(allDates[allDates.length - 1])) +
            ' — <button class="btn-ghost sm" id="rpWiden">הרחב את הטווח</button>' : ' עדיין לא הוזנו נתונים במערכת.') +
          '</div></div>';
      }

      // ── גרפים ──
      h += '<div class="dash-grid">' +
        '<div class="qr-card"><h3><i class="bi bi-graph-up-arrow"></i> נוכחות לאורך זמן</h3>' +
          (attR.length ? '<canvas id="attChart" height="150"></canvas>' : '<div class="empty-state" style="padding:16px">אין רישומי נוכחות בטווח</div>') + '</div>' +
        '<div class="qr-card"><h3><i class="bi bi-pie-chart"></i> התפלגות נוכחות</h3>' +
          (attR.length ? '<canvas id="attPie" height="150"></canvas>' : '<div class="empty-state" style="padding:16px">—</div>') + '</div>' +
        '</div>';

      h += '<div class="dash-grid" style="margin-top:14px">' +
        '<div class="qr-card"><h3><i class="bi bi-bar-chart"></i> מעקב לפי קטגוריה</h3>' +
          (behR.length ? '<canvas id="behChart" height="150"></canvas>' : '<div class="empty-state" style="padding:16px">אין דיווחים בטווח</div>') + '</div>' +
        '<div class="qr-card"><h3><i class="bi bi-exclamation-triangle"></i> תלמידים לתשומת לב</h3><div id="noteList"></div></div>' +
        '</div>';

      // ── דוח נוכחות לפי תלמיד ──
      const attByStu = {};
      attR.forEach(a => {
        const k = a.student_id;
        attByStu[k] = attByStu[k] || { present: 0, late: 0, absent: 0 };
        if (attByStu[k][a.status] != null) attByStu[k][a.status]++;
      });
      const attRows = Object.keys(attByStu).map(k => {
        const r = attByStu[k], tot = r.present + r.late + r.absent;
        return { s: stById(k), present: r.present, late: r.late, absent: r.absent, tot: tot, rate: pct(r.present + r.late, tot), onTime: pct(r.present, tot) };
      }).sort((a, b) => a.rate - b.rate || a.onTime - b.onTime);

      h += rpSection('דוח נוכחות לפי תלמיד', 'bi-calendar-check', attRows.length
        ? '<table class="tbl"><thead><tr><th>תלמיד</th><th>כיתה</th><th>נוכח</th><th>איחור</th><th>נעדר</th><th>סה"כ</th>' +
          '<th title="הגיע — כולל איחורים">% הגעה</th><th title="הגיע בזמן, בלי איחורים">% בזמן</th></tr></thead><tbody>' +
          attRows.map(r => '<tr><td>' + esc(fullName(r.s)) + '</td><td>' + esc(r.s ? clsName(r.s.class_id) : '') + '</td>' +
            '<td>' + r.present + '</td><td>' + r.late + '</td><td>' + r.absent + '</td><td>' + r.tot + '</td>' +
            '<td><span class="chip ' + (r.rate >= 90 ? 'ok' : 'off') + '">' + r.rate + '%</span></td>' +
            '<td><span class="chip ' + (r.onTime >= 90 ? 'ok' : 'off') + '">' + r.onTime + '%</span></td></tr>').join('') +
          '</tbody></table>'
        : '<div class="empty-state" style="padding:16px">אין רישומי נוכחות בטווח</div>');

      // ── סיכום לפי כיתה ──
      const byCls = {};
      inScope.forEach(s => {
        const k = s.class_id == null ? '0' : s.class_id;
        byCls[k] = byCls[k] || { students: 0, present: 0, late: 0, absent: 0, beh: 0 };
        byCls[k].students++;
      });
      attR.forEach(a => { const s = stById(a.student_id); const k = s && s.class_id != null ? s.class_id : '0'; if (byCls[k] && byCls[k][a.status] != null) byCls[k][a.status]++; });
      behR.forEach(e => { const s = stById(e.student_id); const k = s && s.class_id != null ? s.class_id : '0'; if (byCls[k]) byCls[k].beh++; });
      const clsRows = Object.keys(byCls).map(k => {
        const r = byCls[k], tot = r.present + r.late + r.absent;
        return { name: k === '0' ? 'ללא כיתה' : clsName(k), students: r.students, tot: tot, rate: pct(r.present + r.late, tot), late: r.late, absent: r.absent, beh: r.beh };
      });
      h += rpSection('סיכום לפי כיתה', 'bi-diagram-3',
        '<table class="tbl"><thead><tr><th>כיתה</th><th>תלמידים</th><th>רישומי נוכחות</th><th>אחוז נוכחות</th><th>איחורים</th><th>היעדרויות</th><th>דיווחי מעקב</th></tr></thead><tbody>' +
        clsRows.map(r => '<tr><td>' + esc(r.name) + '</td><td>' + r.students + '</td><td>' + r.tot + '</td>' +
          '<td>' + (r.tot ? r.rate + '%' : '—') + '</td><td>' + r.late + '</td><td>' + r.absent + '</td><td>' + r.beh + '</td></tr>').join('') +
        '</tbody></table>');

      // ── מבחנים ──
      const tstByStu = {};
      tstR.forEach(t => { const g = Number(t.grade); if (isNaN(g)) return; (tstByStu[t.student_id] = tstByStu[t.student_id] || []).push(g); });
      const tstRows = Object.keys(tstByStu).map(k => {
        const arr = tstByStu[k];
        return { s: stById(k), n: arr.length, avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) };
      }).sort((a, b) => a.avg - b.avg);
      h += rpSection('מבחנים — ממוצע לפי תלמיד', 'bi-card-checklist', tstRows.length
        ? '<table class="tbl"><thead><tr><th>תלמיד</th><th>כיתה</th><th>מבחנים</th><th>ממוצע</th></tr></thead><tbody>' +
          tstRows.map(r => '<tr><td>' + esc(fullName(r.s)) + '</td><td>' + esc(r.s ? clsName(r.s.class_id) : '') + '</td>' +
            '<td>' + r.n + '</td><td><span class="chip ' + (r.avg >= 70 ? 'ok' : 'off') + '">' + r.avg + '</span></td></tr>').join('') +
          '</tbody></table>'
        : '<div class="empty-state" style="padding:16px">אין מבחנים בטווח</div>');

      // ── מעקב קריאה ──
      if (window.cv3ReadAssess) {
        const catAvg = (raCats || []).map(c => {
          const vals = raR.map(a => (a.scores || {})[c.id]).filter(v => v != null).map(Number);
          return { name: c.name, n: vals.length, avg: vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null };
        }).filter(x => x.n);
        h += rpSection('מעקב קריאה — ממוצע לפי קטגוריה', 'bi-book-half', catAvg.length
          ? '<table class="tbl"><thead><tr><th>קטגוריה</th><th>הערכות</th><th>ממוצע (1–10)</th></tr></thead><tbody>' +
            catAvg.map(c => '<tr><td>' + esc(c.name) + '</td><td>' + c.n + '</td><td><strong>' + esc(c.avg) + '</strong></td></tr>').join('') +
            '</tbody></table>'
          : '<div class="empty-state" style="padding:16px">אין הערכות קריאה בטווח</div>');
      }

      // ── תל"א ──
      if (window.cv3Tla) {
        const byStat = {};
        tlaR.forEach(p => { const k = p.status || 'טיוטה'; byStat[k] = (byStat[k] || 0) + 1; });
        const withPlan = new Set(tlaR.map(p => p.student_id)).size;
        h += rpSection('תל"א — תכניות לימודים אישיות', 'bi-journal-bookmark',
          '<div class="det-grid">' +
          '<div class="det-row"><span class="det-lbl">תלמידים עם תל"א</span><span class="det-val">' + withPlan + ' מתוך ' + inScope.length + '</span></div>' +
          Object.keys(byStat).map(k => '<div class="det-row"><span class="det-lbl">' + esc(k) + '</span><span class="det-val">' + byStat[k] + '</span></div>').join('') +
          '</div>');
      }

      // ── שכר לימוד (רק למי שרואה את המסך) ──
      if (!window.Auth || window.Auth.canAccess('tuition')) {
        const paid = tuiR.filter(t => t.status === 'paid');
        const due = tuiR.filter(t => t.status !== 'paid');
        const sum = arr => arr.reduce((a, t) => a + (Number(t.amount) || 0), 0);
        h += rpSection('שכר לימוד', 'bi-cash-coin', tuiR.length
          ? '<div class="det-grid"><div class="det-row"><span class="det-lbl">שולם</span><span class="det-val">' + paid.length + ' · ₪' + sum(paid).toLocaleString() + '</span></div>' +
            '<div class="det-row"><span class="det-lbl">בחוב</span><span class="det-val">' + due.length + ' · ₪' + sum(due).toLocaleString() + '</span></div></div>'
          : '<div class="empty-state" style="padding:16px">אין רישומי שכר לימוד</div>');
      }

      body.innerHTML = h;

      // תלמידים לתשומת לב: אחוז נוכחות נמוך או ריבוי דיווחים
      const behCount = {};
      behR.forEach(e => { behCount[e.student_id] = (behCount[e.student_id] || 0) + 1; });
      const note = attRows.filter(r => r.tot >= 1 && (r.rate < 90 || r.onTime < 80)).slice(0, 5)
        .map(r => ({ s: r.s, why: r.rate < 90 ? 'נוכחות ' + r.rate + '%' : 'דייקנות ' + r.onTime + '% (' + r.late + ' איחורים)' }))
        .concat(Object.keys(behCount).filter(k => behCount[k] >= 3).slice(0, 3)
          .map(k => ({ s: stById(k), why: behCount[k] + ' דיווחים' })));
      const nl = body.querySelector('#noteList');
      if (nl) nl.innerHTML = note.length ? note.map(n =>
        '<div class="tl-item" style="margin-bottom:6px"><span class="ava">' + esc((fullName(n.s) || '?').slice(0, 2)) + '</span>' +
        '<div class="tl-main">' + esc(fullName(n.s)) + '</div><div class="tl-meta">' + esc(n.why) + '</div></div>').join('')
        : '<div class="empty-state" style="padding:18px">אין התראות בטווח</div>';

      const widen = body.querySelector('#rpWiden');
      if (widen) widen.addEventListener('click', () => {
        const allDates = mine(att).map(a => a.date).concat(mine(beh).map(e => e.event_date)).filter(Boolean).sort();
        if (!allDates.length) return;
        F.from = allDates[0]; F.to = allDates[allDates.length - 1];
        page.querySelector('#rpFrom').value = F.from; page.querySelector('#rpTo').value = F.to;
        draw();
      });

      // ── ציור הגרפים ──
      if (window.Chart) {
        const byDate = {};
        attR.forEach(a => {
          const d = String(a.date).slice(0, 10);
          byDate[d] = byDate[d] || { p: 0, l: 0, a: 0 };
          if (a.status === 'present') byDate[d].p++; else if (a.status === 'late') byDate[d].l++; else byDate[d].a++;
        });
        const dates = Object.keys(byDate).sort();
        const attCv = body.querySelector('#attChart');
        if (attCv && dates.length) CHARTS.push(new window.Chart(attCv, {
          type: 'line',
          data: {
            labels: dates.map(dmy),
            datasets: [{ label: 'אחוז נוכחות', data: dates.map(d => pct(byDate[d].p + byDate[d].l, byDate[d].p + byDate[d].l + byDate[d].a)), borderColor: '#1f8a5b', backgroundColor: 'rgba(31,138,91,.15)', fill: true, tension: .3 }],
          },
          options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } }, maintainAspectRatio: false },
        }));
        const pie = body.querySelector('#attPie');
        if (pie && attTotal) CHARTS.push(new window.Chart(pie, {
          type: 'doughnut',
          data: { labels: ['נוכח', 'איחור', 'נעדר'], datasets: [{ data: [present, late, absent], backgroundColor: ['#1f8a5b', '#d68910', '#c0392b'] }] },
          options: { maintainAspectRatio: false },
        }));
        const behCv = body.querySelector('#behChart');
        const usedCats = catRows.filter(c => behR.some(e => e.category_id === c.id));
        if (behCv && usedCats.length) CHARTS.push(new window.Chart(behCv, {
          type: 'bar',
          data: { labels: usedCats.map(c => c.name), datasets: [{ data: usedCats.map(c => behR.filter(e => e.category_id === c.id).length), backgroundColor: ['#1f8a5b', '#c0392b', '#2b7c98', '#c98a1a', '#7d3c98'], borderRadius: 6 }] },
          options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, maintainAspectRatio: false },
        }));
      }

      // נשמר לייצוא
      draw.data = { inScope, attRows, clsRows, tstRows, behR, attR, tstR, raR, tlaR, from, to };
    }

    function statCard(icon, num, label) {
      return '<div class="stat-card"><div class="stat-ic"><i class="bi ' + icon + '"></i></div>' +
        '<div class="stat-num">' + esc(num) + '</div><div class="stat-lbl">' + esc(label) + '</div></div>';
    }
    function rpSection(title, icon, inner) {
      return '<div class="qr-card rp-sec"><h3><i class="bi ' + icon + '"></i> ' + esc(title) + '</h3>' + inner + '</div>';
    }

    page.querySelector('#rpFrom').addEventListener('change', e => { F.from = e.target.value; draw(); });
    page.querySelector('#rpTo').addEventListener('change', e => { F.to = e.target.value; draw(); });
    page.querySelector('#rpClass').addEventListener('change', e => { F.classId = e.target.value; draw(); });
    page.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
      F.from = daysBack(+b.dataset.q); F.to = iso(new Date());
      page.querySelector('#rpFrom').value = F.from; page.querySelector('#rpTo').value = F.to;
      draw();
    }));
    page.querySelector('#rpPrint').addEventListener('click', () => window.print());

    // ── ייצוא CSV של כל הדוחות, לא רק התנהגות ──
    page.querySelector('#rpExport').addEventListener('click', () => {
      const d = draw.data; if (!d) return;
      const catName = id => { const c = catRows.find(x => x.id == id); return c ? c.name : ''; };
      const rows = [];
      rows.push(['דוח מערכת — ' + ((window.CV3 || {}).INSTANCE_NAME || '')]);
      rows.push(['טווח', dmy(d.from) + ' – ' + dmy(d.to)]);
      rows.push(['כיתה', F.classId ? clsName(F.classId) : 'כל הכיתות']);
      rows.push([]);
      rows.push(['נוכחות לפי תלמיד']);
      rows.push(['תלמיד', 'כיתה', 'נוכח', 'איחור', 'נעדר', 'סה"כ', 'אחוז הגעה', 'אחוז בזמן']);
      d.attRows.forEach(r => rows.push([fullName(r.s), r.s ? clsName(r.s.class_id) : '', r.present, r.late, r.absent, r.tot, r.rate + '%', r.onTime + '%']));
      rows.push([]);
      rows.push(['סיכום לפי כיתה']);
      rows.push(['כיתה', 'תלמידים', 'רישומי נוכחות', 'אחוז נוכחות', 'איחורים', 'היעדרויות', 'דיווחי מעקב']);
      d.clsRows.forEach(r => rows.push([r.name, r.students, r.tot, r.tot ? r.rate + '%' : '', r.late, r.absent, r.beh]));
      rows.push([]);
      rows.push(['מבחנים — ממוצע לפי תלמיד']);
      rows.push(['תלמיד', 'כיתה', 'מבחנים', 'ממוצע']);
      d.tstRows.forEach(r => rows.push([fullName(r.s), r.s ? clsName(r.s.class_id) : '', r.n, r.avg]));
      rows.push([]);
      rows.push(['פירוט רישומי נוכחות']);
      rows.push(['תלמיד', 'כיתה', 'תאריך', 'סטטוס', 'הערה']);
      d.attR.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach(a => {
        const s = stById(a.student_id);
        rows.push([fullName(s), s ? clsName(s.class_id) : '', dmy(a.date),
          a.status === 'present' ? 'נוכח' : a.status === 'late' ? 'איחור' : 'נעדר', a.note || '']);
      });
      rows.push([]);
      rows.push(['פירוט דיווחי מעקב']);
      rows.push(['תלמיד', 'קטגוריה', 'תאריך', 'שעה', 'הערה']);
      d.behR.slice().reverse().forEach(e => rows.push([fullName(stById(e.student_id)), catName(e.category_id), dmy(e.event_date), e.event_time || '', e.note || '']));
      rows.push([]);
      rows.push(['פירוט מבחנים']);
      rows.push(['תלמיד', 'נושא', 'ציון', 'תאריך']);
      d.tstR.forEach(t => rows.push([fullName(stById(t.student_id)), t.subject || '', t.grade, dmy(t.date)]));

      const csv = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'report_' + d.from + '_' + d.to + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });

    draw();
  }

  // ----- חיפוש מהיר Ctrl+K -----
  function openSearch() {
    const mods = (window.MODULES || []).filter(m => !window.Auth || window.Auth.canAccess(m.id)).map(m => ({ type: 'מסך', label: m.label, go: () => showPage(m.id) }));
    let items = mods.slice();
    students().then(ss => { items = mods.concat(ss.map(s => ({ type: 'תלמיד', label: fullName(s), go: () => showPage('students') }))); draw(); });
    const m = window.UI.modal({ title: 'חיפוש מהיר', bodyHTML: '<input class="inp mb0" id="qkInput" placeholder="הקלד מסך או תלמיד…" autofocus><div id="qkRes" class="qk-res"></div>' });
    const input = m.el.querySelector('#qkInput');
    function draw() {
      const q = (input.value || '').trim();
      const res = (q ? items.filter(i => i.label.includes(q)) : items).slice(0, 8);
      m.el.querySelector('#qkRes').innerHTML = res.map(i =>
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
