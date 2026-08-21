// ai-help.js — עוזר חכם (עזרה ראשונית) למערכת בית התלמוד.
// שלב ראשון פשוט: בונה "מאגר ידע" אוטומטי מתוך guide-data.js (מקור האמת של
// ההדרכה, מתעדכן לבד ככל שמעדכנים את ההדרכה), ומאפשר לשאול שאלות חופשיות
// על המערכת. הקריאה ל-Gemini נעשית ישירות מהדפדפן — בדיוק כמו טקסט→שמע
// בקו ימות (נטפרי מאשר את generativelanguage), עם אותו מפתח (window.geminiKey).
(function () {
  'use strict';
  const MODEL = 'gemini-2.5-flash';
  const URL = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // מפתח: מעדיפים את הפונקציה המשותפת מ-yemot.js; נופלים ל-localStorage.
  function key() {
    try { if (typeof window.geminiKey === 'function') return window.geminiKey(); } catch (_) {}
    try { return localStorage.getItem('cv3_gemini_key') || ''; } catch (_) { return ''; }
  }

  // ── בניית מאגר הידע מתוך guide-data (מתעדכן אוטומטית) + עובדות המערכת ──
  function knowledgeBase() {
    const g = window.CV3_GUIDE || { screens: {}, common: {}, roles: {} };
    const L = [];
    L.push('שם המערכת: מכינת בית התלמוד — מערכת ניהול בית ספר לצוות המוסד.');
    L.push('המערכת ריכוזית: כל המידע על התלמידים והמוסד במקום אחד, לפי הרשאות.');

    if (g.roles) {
      L.push('\nתפקידים והרשאות:');
      for (const r in g.roles) {
        const o = g.roles[r] || {};
        let line = '- ' + r;
        if (o.note) line += ': ' + o.note;
        if (Array.isArray(o.screens)) line += ' (מסכים: ' + o.screens.join(', ') + ')';
        else if (o.screens === 'all') line += ' (רואה את כל המסכים)';
        L.push(line);
      }
    }

    const c = g.common;
    if (c) {
      L.push('\n' + (c.title || 'כניסה למערכת') + ': ' + (c.intro || ''));
      (c.steps || []).forEach((s, i) => L.push('  ' + (i + 1) + '. ' + s));
      (c.tips || []).forEach(t => L.push('  דגש: ' + t));
    }

    L.push('\nמסכי המערכת:');
    const sc = g.screens || {};
    for (const id in sc) {
      const e = sc[id];
      L.push('\n[' + (e.title || id) + '] ' + (e.intro || ''));
      (e.steps || []).forEach((s, i) => L.push('  ' + (i + 1) + '. ' + s));
      (e.tips || []).forEach(t => L.push('  דגש: ' + t));
    }
    return L.join('\n');
  }

  const SYS = [
    'אתה עוזר עזרה ראשונית למערכת הניהול של מכינת בית התלמוד.',
    'ענה בעברית פשוטה וברורה בלבד. אסור אנגלית ואסור מונחים טכניים.',
    'ענה רק על סמך המידע על המערכת שמופיע למטה.',
    'אם השאלה אינה קשורה למערכת, או שאין במידע תשובה — אמור בפשטות שאינך בטוח, והצע לפנות למנהל.',
    'תשובות קצרות וממוקדות. כשמסבירים פעולה — תן שלבים קצרים לפי הסדר.',
    '', 'המידע על המערכת:', '', knowledgeBase(),
  ].join('\n');

  const history = []; // { role:'user'|'model', text }

  async function ask(question) {
    const k = key();
    if (!k) throw new Error('אין מפתח זמין לעוזר החכם.');
    const contents = [];
    history.slice(-8).forEach(m => contents.push({ role: m.role, parts: [{ text: m.text }] }));
    contents.push({ role: 'user', parts: [{ text: question }] });
    const body = {
      systemInstruction: { parts: [{ text: SYS }] },
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
    };
    const r = await fetch(URL + '?key=' + encodeURIComponent(k),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error((j && j.error && j.error.message) || 'שגיאת תקשורת');
    const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
    const txt = parts && parts.map(p => p.text || '').join(' ').trim();
    if (!txt) throw new Error('לא התקבלה תשובה');
    history.push({ role: 'user', text: question });
    history.push({ role: 'model', text: txt });
    return txt;
  }

  // ── ממשק צ'אט ─────────────────────────────────────────────────────────
  function bubble(who, text, cls) {
    return '<div class="aih-msg ' + cls + '">' +
      '<div class="aih-who">' + who + '</div>' +
      '<div class="aih-txt">' + esc(text).replace(/\n/g, '<br>') + '</div></div>';
  }

  function open() {
    const bodyHTML =
      '<div id="aihLog" class="aih-log">' +
        bubble('העוזר', 'שלום! אני העוזר החכם של המערכת. אפשר לשאול אותי איך עושים דברים במערכת — למשל "איך רושמים נוכחות?" או "מי יכול לראות מידע רפואי?"', 'bot') +
      '</div>' +
      '<div class="aih-input"><input id="aihQ" type="text" placeholder="כתבו כאן שאלה על המערכת…" autocomplete="off">' +
      '<button id="aihSend" class="btn-primary sm">שליחה</button></div>' +
      '<div class="aih-hint">עזרה ראשונית בלבד — למקרים מורכבים פנו למנהל.</div>';
    const m = window.UI.modal({ title: 'עוזר חכם — בית התלמוד', bodyHTML });
    const log = m.el.querySelector('#aihLog');
    const inp = m.el.querySelector('#aihQ');
    const btn = m.el.querySelector('#aihSend');
    const scroll = () => { log.scrollTop = log.scrollHeight; };

    async function send() {
      const q = (inp.value || '').trim();
      if (!q) return;
      inp.value = '';
      log.insertAdjacentHTML('beforeend', bubble('אני', q, 'me'));
      log.insertAdjacentHTML('beforeend', '<div class="aih-msg bot" id="aihWait"><div class="aih-who">העוזר</div><div class="aih-txt">חושב…</div></div>');
      scroll(); btn.disabled = true; inp.disabled = true;
      try {
        const a = await ask(q);
        const w = log.querySelector('#aihWait'); if (w) w.remove();
        log.insertAdjacentHTML('beforeend', bubble('העוזר', a, 'bot'));
      } catch (e) {
        const w = log.querySelector('#aihWait'); if (w) w.remove();
        log.insertAdjacentHTML('beforeend', bubble('העוזר', 'מצטער, לא הצלחתי לענות כרגע. נסו שוב, או פנו למנהל. (' + (e && e.message ? e.message : 'תקלה') + ')', 'bot'));
      } finally {
        btn.disabled = false; inp.disabled = false; inp.focus(); scroll();
      }
    }
    btn.addEventListener('click', send);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    setTimeout(() => inp.focus(), 50);
  }
  window.cv3AskAI = open;

  // ── כפתור צף (מעל כפתור העזרה), מופיע רק אחרי כניסה ───────────────────
  function style() {
    if (document.getElementById('aihStyle')) return;
    const s = document.createElement('style'); s.id = 'aihStyle';
    s.textContent =
      '.ai-fab{position:fixed;inset-inline-end:20px;bottom:82px;z-index:40;width:52px;height:52px;border:0;border-radius:50%;' +
      'background:var(--accent,#7c3aed);color:#fff;font-size:1.4rem;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);' +
      'display:flex;align-items:center;justify-content:center;transition:transform .15s}' +
      '.ai-fab:hover{transform:scale(1.08)}' +
      '@media(max-width:520px){.ai-fab{width:46px;height:46px;font-size:1.2rem;inset-inline-end:14px;bottom:70px}}' +
      '.aih-log{max-height:48vh;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:4px 2px 10px}' +
      '.aih-msg{max-width:88%;padding:8px 12px;border-radius:14px;line-height:1.6}' +
      '.aih-msg.me{align-self:flex-start;background:var(--primary,#2563eb);color:#fff;border-bottom-inline-start-radius:4px}' +
      '.aih-msg.bot{align-self:flex-end;background:var(--accent-soft,#f1f0fb);border-bottom-inline-end-radius:4px}' +
      '.aih-who{font-size:.72rem;opacity:.7;margin-bottom:2px}' +
      '.aih-input{display:flex;gap:8px;margin-top:6px}' +
      '.aih-input input{flex:1;padding:9px 12px;border:1px solid var(--border,#d1d5db);border-radius:10px;font:inherit}' +
      '.aih-hint{font-size:.75rem;color:var(--muted,#6b7280);margin-top:8px;text-align:center}';
    document.head.appendChild(s);
  }

  function mount() {
    if (document.getElementById('aiFab')) return;
    style();
    const b = document.createElement('button');
    b.id = 'aiFab'; b.className = 'ai-fab'; b.title = 'עוזר חכם — שאלו שאלה על המערכת';
    b.setAttribute('aria-label', 'עוזר חכם');
    b.innerHTML = '<i class="bi bi-robot"></i>';
    b.addEventListener('click', open);
    document.body.appendChild(b);
  }

  function sync() {
    const loggedIn = !!window.currentUser;
    const fab = document.getElementById('aiFab');
    if (loggedIn && !fab) mount();
    if (fab) fab.style.display = loggedIn ? '' : 'none';
  }
  document.addEventListener('DOMContentLoaded', () => { setInterval(sync, 800); });
})();
