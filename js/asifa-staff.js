// asifa-staff.js — כרטיס "אסיפת הורים" במסך הבית של כל איש צוות מחובר (15/11/2026). קריאה בלבד.
// נתונים: rpc asifa_staff_my() — לפי המשתמש המחובר (auth.uid). מי שלא מחובר לא מקבל כלום.
// מוצג רק כשיש אסיפה קרובה. לרב שיש לו פגישות: "הפגישות שלי" + מתג "כל הצוות". לשאר הצוות: כל הצוות.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let data = null, tab = 'me', host = null, seq = 0;

  function fmtPhone(p) {
    const d = String(p || '').replace(/\D/g, '');
    if (!d) return '';
    const n = d.length === 9 ? '0' + d : d;
    return n.length === 10 ? n.slice(0, 3) + '-' + n.slice(3) : n;
  }
  function dateText() {
    try {
      const wd = new Date(data.date + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
      const heb = (window.UI && window.UI.hebDate) ? window.UI.hebDate(data.date) : '';
      return wd + (heb ? ' · ' + heb : '');
    } catch (_) { return data.date; }
  }
  function ravBlock(r, title) {
    let h = '<div style="margin-top:10px"><div style="font-weight:800;color:var(--primary-dark)">' + esc(title || r.name) +
      ' <span class="tl-note" style="font-weight:600">' + esc(r.start) + '–' + esc(r.end) + ' · ' + r.bookings.length + ' פגישות</span></div>';
    if (!r.bookings.length) h += '<div class="tl-note">אין עדיין פגישות.</div>';
    r.bookings.forEach(b => {
      const ph = fmtPhone(b.phone);
      h += '<div style="display:flex;gap:12px;align-items:baseline;border-top:1px solid var(--line);padding:8px 0">' +
        '<span style="font-size:1.15rem;font-weight:800;color:var(--accent);min-width:56px;direction:ltr;text-align:center">' + esc(b.time) + '</span>' +
        '<span style="flex:1;line-height:1.5"><b>' + esc(b.student) + '</b> <span class="tl-note">' + esc(b.class_name) +
        (b.parent_name ? ' · ' + esc(b.parent_name) : '') + '</span>' +
        (ph ? '<br><a href="tel:' + esc(ph.replace(/-/g, '')) + '" style="direction:ltr;unicode-bidi:embed;font-weight:700;color:var(--primary-dark);text-decoration:none">' + esc(ph) + '</a>' : '') +
        '</span></div>';
    });
    return h + '</div>';
  }
  function render() {
    if (!host || !data) return;
    const me = data.me ? data.rabbis.find(r => r.name === data.me) : null;
    if (!me) tab = 'all';
    const btn = (t, label) => '<button class="' + (tab === t ? 'btn-primary' : 'btn-ghost') + ' sm" data-ast="' + t + '">' + label + '</button>';
    host.innerHTML = '<div class="qr-card" style="margin:0 0 14px"><div class="card-h-row"><h3><i class="bi bi-people"></i> ' + esc(data.title) + '</h3>' +
      '<span style="display:flex;gap:6px;flex-wrap:wrap">' + (me ? btn('me', 'הפגישות שלי') : '') + btn('all', 'כל הצוות') +
      '<button class="btn-ghost sm" data-asr="1" title="רענון"><i class="bi bi-arrow-repeat"></i></button></span></div>' +
      '<div class="tl-note">' + esc(dateText()) + ' · צפייה בלבד</div>' +
      (tab === 'me' && me ? ravBlock(me, 'הורים שקבעו איתי') : data.rabbis.map(r => ravBlock(r)).join('')) + '</div>';
    host.querySelectorAll('[data-ast]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.ast; render(); }));
    host.querySelector('[data-asr]').addEventListener('click', () => homeCard(host, true));
  }
  async function homeCard(h, keepTab) {
    if (!h) return;
    host = h;
    const my = ++seq;
    if (!keepTab) { h.innerHTML = ''; tab = 'me'; }
    if (!window.sb || !(window.Auth && window.Auth.currentUser)) { h.innerHTML = ''; return; }
    try {
      const { data: d, error } = await window.sb.rpc('asifa_staff_my');
      if (my !== seq) return;
      if (error || !d || !Array.isArray(d.rabbis)) { h.innerHTML = ''; return; }
      data = d; render();
    } catch (_) { if (my === seq) h.innerHTML = ''; }
  }
  window.cv3AsifaStaff = { homeCard };
})();
