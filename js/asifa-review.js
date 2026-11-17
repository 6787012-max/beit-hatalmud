// asifa-review.js — דף ביקורת תמונות לשלט אסיפת ההורים (17/11/2026).
// גישה רק דרך rpc asifa_review_state / asifa_review_mark / asifa_review_done עם מפתח (?k=). בלי מפתח תקין: כלום.
(function () {
  'use strict';
  const C = window.CV3 || {};
  const root = document.getElementById('root');
  const key = new URLSearchParams(location.search).get('k') || '';
  const sb = (C.SUPABASE_URL && C.SUPABASE_ANON_KEY && window.supabase) ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let S = null, marks = {}, pending = 0;
  const timers = {};

  function blank() { root.innerHTML = ''; document.getElementById('bar').style.display = 'none'; }
  function base() { return C.SUPABASE_URL + '/storage/v1/object/public/asifa-review/' + S.folder + '/'; }
  function count() { return Object.keys(marks).filter(n => marks[n].remove && S.nums.indexOf(+n) >= 0).length; }
  function updBar() {
    document.getElementById('cnt').textContent = count();
    document.getElementById('saveall').textContent = pending ? 'שומר…' : '';
    const d = document.getElementById('done');
    d.textContent = S.done_at ? 'עדכן שסיימתי' : 'סיימתי';
    d.className = 'btn' + (S.done_at ? ' done' : '');
  }
  function setSt(n, cls, txt) {
    const el = document.querySelector('.cell[data-n="' + n + '"] .st'); if (!el) return;
    el.className = 'st ' + cls; el.textContent = txt;
    if (cls === 'ok') setTimeout(() => { if (el.textContent === txt) el.className = 'st'; }, 1500);
  }
  async function save(n) {
    const m = marks[n] || { remove: false, note: '' };
    pending++; updBar();
    try {
      const { data, error } = await sb.rpc('asifa_review_mark', { p_key: key, p_num: n, p_remove: !!m.remove, p_note: m.note || '' });
      if (error || data !== true) throw new Error('x');
      setSt(n, 'ok', 'נשמר');
    } catch (_) { setSt(n, 'err', 'לא נשמר, נסה שוב'); }
    pending--; updBar();
  }
  function toggle(n) {
    const m = marks[n] || (marks[n] = { remove: false, note: '' });
    m.remove = !m.remove;
    document.querySelector('.cell[data-n="' + n + '"]').classList.toggle('rm', m.remove);
    updBar(); save(n);
  }
  function render() {
    let h = '<h1>שלט אסיפת ההורים: מעבר על התמונות</h1>' +
      '<p class="help">נגיעה בתמונה מסמנת אותה להורדה. נגיעה נוספת מבטלת.<br>הכול נשמר לבד.</p>' +
      '<div id="thanks"></div>';
    if (S.sheet) h += '<div class="sheetbox"><img id="sheet" src="' + esc(base() + S.sheet) + '" alt="תצוגת השלט כולו"><small>נגיעה בתמונה מגדילה את השלט כולו</small></div>';
    h += '<div class="grid">';
    S.nums.forEach(n => {
      const m = marks[n] || {};
      h += '<div class="cell' + (m.remove ? ' rm' : '') + '" data-n="' + n + '"><div class="pic"><img loading="lazy" decoding="async" src="' + esc(base() + n + '.jpg') + '" alt="תמונה ' + n + '">' +
        '<span class="num">' + n + '</span><span class="st"></span></div>' +
        '<div class="note"><input type="text" maxlength="200" placeholder="הערה (לא חובה)" value="' + esc(m.note || '') + '"></div></div>';
    });
    root.innerHTML = h + '</div>';
    document.getElementById('bar').style.display = 'flex';
    root.querySelectorAll('.cell').forEach(c => {
      const n = +c.dataset.n;
      c.querySelector('.pic').addEventListener('click', () => toggle(n));
      const inp = c.querySelector('input');
      inp.addEventListener('input', () => {
        (marks[n] || (marks[n] = { remove: true, note: '' })).note = inp.value;
        clearTimeout(timers[n]); timers[n] = setTimeout(() => save(n), 600);
      });
      inp.addEventListener('blur', () => { clearTimeout(timers[n]); if (marks[n]) save(n); });
      c.querySelector('.st').addEventListener('click', () => save(n));
    });
    const sh = document.getElementById('sheet');
    if (sh) sh.addEventListener('click', () => openBig(sh.src));
    showThanks(); updBar();
  }
  function showThanks() {
    const t = document.getElementById('thanks'); if (!t) return;
    t.innerHTML = S.done_at ? '<div class="thanks">תודה רבה! הסימונים נשמרו (' + count() + ' תמונות להורדה). אפשר עדיין לשנות.</div>' : '';
  }
  // תצוגה מוגדלת של השלט
  let zoom = 3;
  function applyZoom() { document.getElementById('big').style.width = (zoom * 100) + 'vw'; }
  function openBig(src) {
    document.getElementById('big').src = src; zoom = 3; applyZoom();
    document.getElementById('ov').classList.add('on');
  }
  document.getElementById('zi').onclick = () => { zoom = Math.min(12, zoom * 1.5); applyZoom(); };
  document.getElementById('zo').onclick = () => { zoom = Math.max(1, zoom / 1.5); applyZoom(); };
  document.getElementById('zc').onclick = () => document.getElementById('ov').classList.remove('on');

  document.getElementById('done').addEventListener('click', async () => {
    try {
      const { data, error } = await sb.rpc('asifa_review_done', { p_key: key, p_done: true });
      if (error || data !== true) throw new Error('x');
      S.done_at = new Date().toISOString(); showThanks(); updBar(); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) { alert('לא נשמר, נסה שוב'); }
  });
  window.addEventListener('beforeunload', e => { if (pending) { e.preventDefault(); e.returnValue = ''; } });

  (async function init() {
    if (!sb || key.length !== 64) { blank(); return; }
    try {
      const { data, error } = await sb.rpc('asifa_review_state', { p_key: key });
      if (error || !data || !Array.isArray(data.nums)) { blank(); return; }
      S = data; marks = {};
      Object.keys(data.marks || {}).forEach(n => { marks[n] = { remove: !!data.marks[n].remove, note: data.marks[n].note || '' }; });
      render();
    } catch (_) { blank(); }
  })();
})();
