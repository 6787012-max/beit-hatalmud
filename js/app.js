// app.js — שלד + ראוטר (חלק 1). בונה את אריחי הבית ואת עמודי ממלאי-המקום,
// מנווט ביניהם, ומראה את מצב המערכת. אין נתונים אמיתיים בשלב זה.
(function () {
  'use strict';

  // רשימת המודולים — כל אחד יקבל אריח + עמוד. part = באיזה חלק בנייה נבנה בפועל.
  const G1 = 'מעקב ולמידה', G2 = 'תלמיד וקהילה', G3 = 'ניהול ודוחות';
  const MODULES = [
    // ★ משימות ופרויקטים — מודגש, מסונכרן עם לוח השנה
    { id: 'tasks',         label: 'משימות ופרויקטים', icon: 'bi-kanban',          group: G1, color: '#6c3fc0', feature: true },
    // מסך מעקב אחד מרכז את הכל — הקטגוריה בוחרת את סוג הרישום (משמעת/כתיבה-קריאה/מוגנות/שיחות...)
    { id: 'behavior',      label: 'מעקב',             icon: 'bi-clipboard-check', group: G1, color: '#c0392b' },
    { id: 'attendance',    label: 'נוכחות',           icon: 'bi-calendar-check',  group: G1, color: '#1f8a5b' },
    { id: 'tests',         label: 'מבחנים',           icon: 'bi-card-checklist',  group: G1, color: '#d68910' },
    { id: 'students',      label: 'תלמידים',          icon: 'bi-people-fill',     group: G2, color: '#2b7c98' },
    { id: 'medical',       label: 'רפואי',            icon: 'bi-capsule',         group: G2, color: '#d35400' },
    { id: 'forms',         label: 'טפסים וחתימות',    icon: 'bi-file-earmark-check', group: G2, color: '#c0398a' },
    { id: 'calendar',      label: 'לוח שנה',          icon: 'bi-calendar3',       group: G2, color: '#117a65' },
    { id: 'reports',       label: 'דשבורד ודוחות',    icon: 'bi-graph-up-arrow',  group: G3, color: '#34495e' },
    { id: 'tuition',       label: 'שכר לימוד',        icon: 'bi-cash-coin',       group: G3, color: '#229954' },
    { id: 'cashbox',       label: 'קופה כללית',       icon: 'bi-wallet2',         group: G3, color: '#16794f' },
    { id: 'yemot',         label: 'קו ימות המשיח',     icon: 'bi-telephone-inbound', group: G3, color: '#0e7490', adminOnly: true },
    { id: 'voicereports',  label: 'דיווחים קוליים',    icon: 'bi-mic-fill',        group: G3, color: '#8e44ad', adminOnly: true },
    { id: 'settings',      label: 'הגדרות והרשאות',   icon: 'bi-gear',            group: G3, color: '#7f8c8d', adminOnly: true },
  ];
  window.MODULES = MODULES;

  const $ = (s, r = document) => r.querySelector(s);

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of kids) if (c != null) e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }

  function buildTiles() {
    const grid = $('#tileGrid');
    grid.innerHTML = '';
    const groups = [];
    MODULES.forEach(m => { let g = groups.find(x => x.name === m.group); if (!g) { g = { name: m.group, items: [] }; groups.push(g); } g.items.push(m); });
    groups.forEach(g => {
      const sec = el('div', { class: 'tile-group' }, el('h3', { class: 'group-title' }, g.name));
      const row = el('div', { class: 'tile-grid-inner' });
      g.items.forEach(m => {
        const tile = el('a', { class: 'tile' + (m.feature ? ' tile-feature' : ''), href: '#' + m.id, 'data-id': m.id, style: '--tc:' + m.color },
          el('span', { class: 'ic', html: '<i class="bi ' + m.icon + '"></i>' }),
          el('span', { class: 't' }, m.label),
          el('span', { class: 'tile-arrow', html: '<i class="bi bi-arrow-left-short"></i>' })
        );
        tile.addEventListener('click', (e) => { e.preventDefault(); showPage(m.id); });
        row.appendChild(tile);
      });
      sec.appendChild(row);
      grid.appendChild(sec);
    });
  }

  function buildPages() {
    const host = $('#pages');
    MODULES.forEach(m => {
      // מצב טעינה ניטרלי בלבד. בעבר היה כאן כרטיס "השלד מוכן — ייבנה בחלק",
      // וכשהרנדרר האסינכרוני של המסך טען את הנתונים הוא דרס אותו — כך שבכניסה
      // ראשונה הבזיק לרגע טקסט "מוכן/ייבנה". עכשיו רואים רק סיבוב טעינה קצר.
      const page = el('section', { class: 'page', id: 'page-' + m.id },
        el('div', { class: 'page-loading' },
          el('span', { class: 'spin', html: '<i class="bi bi-arrow-repeat"></i>' }),
          el('div', {}, 'טוען…')
        )
      );
      host.appendChild(page);
    });
  }

  // תצוגת בית: מורים (מלמד/מחנך) מקבלים בית פשוט ויפה; שאר התפקידים — רשת אריחים.
  function updateHomeMode() {
    const u = window.currentUser, th = $('#teacherHome'), tg = $('#tileGrid'), hero = document.querySelector('.home-hero');
    if (!th || !tg) return;
    const isTeacher = u && (u.role === 'מלמד' || u.role === 'מחנך');
    const hr = $('#homeReports'); if (hr) hr.innerHTML = '';
    if (isTeacher && window.renderTeacherHome) {
      tg.style.display = 'none'; th.style.display = '';
      if (hero) { hero.querySelector('h1').textContent = 'שלום ' + (u.name || ''); hero.querySelector('p').textContent = 'רישום מהיר לתלמידים — פשוט ומהיר.'; }
      window.renderTeacherHome(th);
    } else {
      tg.style.display = ''; th.style.display = 'none'; th.innerHTML = '';
      if (hero) { hero.querySelector('h1').textContent = 'ברוכים הבאים'; hero.querySelector('p').textContent = 'מערכת מעקב — בחרו תחום כדי להתחיל.'; }
      renderHomeReports();
    }
  }
  window.updateHomeMode = updateHomeMode;

  // דיווחים אחרונים + באנר "דיווח חדש" בדף הבית (בקשת עמנואל 20/07).
  const _esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function hebDate(iso) {
    if (!iso) return '';
    try { return new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long' }).format(new Date(iso + 'T00:00:00')); } catch (_) { return ''; }
  }
  async function renderHomeReports() {
    const box = $('#homeReports'); if (!box || !window.store) return;
    box.innerHTML = '<div class="qr-card home-report-banner"><div class="hrb-head">' +
      '<h3 style="margin:0"><i class="bi bi-clipboard-check"></i> דיווחים אחרונים</h3>' +
      '<button class="btn-primary sm" id="homeNewReport"><i class="bi bi-plus-lg"></i> דיווח חדש</button></div>' +
      '<div id="homeReportList"><div class="empty-state" style="padding:12px">טוען…</div></div>' +
      '<div style="text-align:center;margin-top:8px"><a href="#behavior" class="btn-ghost sm" id="homeAllReports">כל הדיווחים ←</a></div></div>';
    const nb = $('#homeNewReport'); if (nb) nb.addEventListener('click', () => showPage('behavior'));
    const al = $('#homeAllReports'); if (al) al.addEventListener('click', (e) => { e.preventDefault(); showPage('behavior'); });
    try {
      const [studs, cats, evs] = await Promise.all([
        (window.cv3Students ? window.cv3Students.getStudents() : Promise.resolve([])),
        window.store.list('categories'), window.store.list('behavior_events')
      ]);
      let rows = evs.slice().reverse();
      const ids = window.cv3Students ? await window.cv3Students.accessibleIds() : null;
      if (ids) rows = rows.filter(e => ids.includes(e.student_id));
      rows = rows.slice(0, 6);
      const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
      const catOf = id => { const c = cats.find(x => x.id == id); return c ? c.name : ''; };
      const list = $('#homeReportList');
      list.innerHTML = rows.length ? rows.map(e =>
        '<div class="tl-item"><span class="sev-dot mid"></span><div class="tl-main"><strong>' + _esc(nameOf(e.student_id)) + '</strong> · ' + _esc(catOf(e.category_id)) +
        (e.note ? ' <span class="tl-note">— ' + _esc(e.note) + '</span>' : '') + '</div>' +
        '<div class="tl-meta">' + _esc(hebDate(e.event_date) || e.event_date || '') + (e.event_time ? ' · ' + _esc(e.event_time) : '') + '</div></div>').join('')
        : '<div class="empty-state" style="padding:12px"><i class="bi bi-clipboard-check"></i><div>אין דיווחים עדיין — הקש "דיווח חדש"</div></div>';
    } catch (e) { console.warn('homeReports', e); const l = $('#homeReportList'); if (l) l.innerHTML = ''; }
  }
  window.renderHomeReports = renderHomeReports;

  function showPage(id) {
    if (id && (window.MODULES || []).some(m => m.id === id) && window.Auth && window.Auth.currentUser && !window.Auth.canAccess(id)) {
      if (window.UI) window.UI.toast('אין לך הרשאה למסך זה', 'err');
      id = 'home';
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + id) || $('#page-home');
    target.classList.add('active');
    if (target.id === 'page-home') updateHomeMode();
    if (window.PAGE_RENDERERS && window.PAGE_RENDERERS[id]) {
      // מציגים מצב טעינה ניטרלי לפני שהרנדרר האסינכרוני מסיים, כך שלא מבליח
      // תוכן ישן ולא כרטיס שלד. הרנדרר דורס את זה כשהנתונים מוכנים.
      target.innerHTML = '<div class="page-loading"><span class="spin"><i class="bi bi-arrow-repeat"></i></span><div>טוען…</div></div>';
      try { window.PAGE_RENDERERS[id](target); } catch (e) { console.warn('renderer error', id, e); }
    }
    if (id && id !== 'home') { try { history.replaceState({}, '', '#' + id); } catch (_) {} }
    else { try { history.replaceState({}, '', location.pathname); } catch (_) {} }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.showPage = showPage;

  function wireDark() {
    const btn = $('#darkBtn');
    const saved = (() => { try { return localStorage.getItem('cv3_dark'); } catch (_) { return null; } })();
    if (saved === '1') document.body.classList.add('dark');
    btn.addEventListener('click', () => {
      const on = document.body.classList.toggle('dark');
      try { localStorage.setItem('cv3_dark', on ? '1' : '0'); } catch (_) {}
    });
  }

  function setStatus() {
    const wrap = $('#statusDot'), txt = $('#statusTxt');
    const c = window.CV3 || {};
    if (c.INSTANCE_NAME) $('#instanceName').textContent = c.INSTANCE_NAME;
    if (!window.db || window.db.DEMO) {
      wrap.classList.remove('ok'); wrap.classList.add('down');
      txt.textContent = 'מצב הדגמה';   // אין חיבור Supabase — תקין לשלד/בדיקה
    } else {
      wrap.classList.add('ok'); wrap.classList.remove('down');
      txt.textContent = 'מחובר';
    }
  }

  // מסך עצירה כשמוסד חי לא הצליח לטעון את שכבת הנתונים. חוסם כניסה בכוונה:
  // בלי זה המערכת מציגה תלמידי דוגמה ושומרת לזיכרון בלבד, והמשתמש מגלה
  // שהנתונים נעלמו רק אחרי שרענן — כלומר אחרי שכבר איבד אותם.
  function showLoadError(reason) {
    document.body.innerHTML =
      '<div class="login-wrap"><div class="login-card">' +
      '<div class="login-logo" style="background:linear-gradient(135deg,#8e2d20,#c0392b)"><i class="bi bi-wifi-off"></i></div>' +
      '<h2>אין חיבור לשרת הנתונים</h2>' +
      '<p class="login-sub">' + String(reason || '') + '</p>' +
      '<p class="login-hint" style="text-align:right">המערכת נעצרה בכוונה ולא נכנסה למצב הדגמה, כדי שלא יוזנו ' +
      'נתונים שייעלמו. בדוק את החיבור לאינטרנט ורענן. אם זה חוזר — פנה ליוסף.</p>' +
      '<button class="btn-primary" style="margin-top:16px" onclick="location.reload()">רענון</button>' +
      '</div></div>';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const cfg = window.CV3 || {};
    if (!cfg.DEMO && (window.CV3_LOAD_ERROR || !window.sb)) {
      showLoadError(window.CV3_LOAD_ERROR || 'שכבת הנתונים לא אותחלה');
      return;
    }
    buildTiles();
    buildPages();
    wireDark();
    setStatus();
    if (window.Auth) window.Auth.init();   // מציג כניסה או בית לפי מצב האימות
    if ('serviceWorker' in navigator) {
      // רישום + ריפוי-עצמי: בודק עדכון בכל טעינה, ומרענן פעם אחת כשה-SW החדש תופס שליטה
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return; reloaded = true; location.reload();
      });
      navigator.serviceWorker.register('sw.js')
        .then(reg => { try { reg.update(); } catch (_) {} })
        .catch(() => {});
    }
  });
})();
