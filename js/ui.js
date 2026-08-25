// ui.js — רכיבי UI משותפים: מודאל, טוסט, אישור. משמש את כל המודולים.
(function () {
  'use strict';
  const elc = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  function modal(opts) {
    opts = opts || {};
    const ov = elc('div', 'modal-ov');
    const card = elc('div', 'modal-card');
    card.innerHTML =
      '<div class="modal-head"><h3>' + (opts.title || '') + '</h3>' +
      '<button class="modal-x" aria-label="סגור"><i class="bi bi-x-lg"></i></button></div>' +
      '<div class="modal-body"></div>' +
      '<div class="modal-foot">' +
      '<button class="btn-ghost" data-act="cancel">ביטול</button>' +
      (opts.onSave ? '<button class="btn-primary sm' + (opts.saveAlways ? ' always-on' : '') + '" data-act="save">' + (opts.saveLabel || 'שמירה') + '</button>' : '') +
      '</div>';
    card.querySelector('.modal-body').innerHTML = opts.bodyHTML || '';
    ov.appendChild(card);
    document.body.appendChild(ov);
    const close = () => { ov.remove(); if (opts.onClose) { try { opts.onClose(); } catch (_) {} } };
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    card.querySelector('.modal-x').addEventListener('click', close);
    card.querySelector('[data-act="cancel"]').addEventListener('click', close);
    const saveBtn = card.querySelector('[data-act="save"]');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      const ok = await opts.onSave(card);
      if (ok !== false) close();
    });
    return { el: card, close };
  }

  function toast(msg, type) {
    let host = document.getElementById('toastHost');
    if (!host) { host = elc('div'); host.id = 'toastHost'; host.className = 'toast-host'; document.body.appendChild(host); }
    const t = elc('div', 'toast ' + (type || 'ok'), msg);
    host.appendChild(t);
    setTimeout(() => { t.classList.add('show'); }, 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  }

  function confirm(msg) {
    return new Promise(resolve => {
      let done = false; const ans = v => { if (!done) { done = true; resolve(v); } };
      modal({
        title: 'אישור', bodyHTML: '<p style="margin:4px 0">' + msg + '</p>',
        saveLabel: 'אישור', onSave: () => { ans(true); return true; }, onClose: () => ans(false),
      });
    });
  }

  // שם מלא — ברשומות המיובאות name הוא כבר שם מלא ומכיל את family.
  // שרשור עיוור יצר "גלזר מיכאל יעקב גלזר" באישור לימודים ובמעקב קריאה.
  function fullName(s) {
    if (!s) return '';
    const nm = String(s.name || '').trim(), fam = String(s.family || '').trim();
    if (!fam) return nm;
    if (!nm) return fam;
    return nm.indexOf(fam) > -1 ? nm : fam + ' ' + nm;
  }

  // ── תאריך עברי ─────────────────────────────────────────────────────────
  // ⚠️ Intl מחזיר יום ושנה כספרות: "11 באלול 5786" במקום "י״א באלול תשפ״ו".
  // תשעה מקומות בקוד קראו ל-Intl ישירות וכולם הציגו ספרות. זהו המקור
  // היחיד לתאריך עברי — אין לקרוא ל-Intl עם he-u-ca-hebrew בקוד חדש.
  function gematria(n) {
    const H = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'],
      [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'],
      [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
    n = Number(n) % 1000;                       // 5786 → 786
    if (n === 15) return 'ט״ו';                 // לא "י״ה" — שם הוי״ה
    if (n === 16) return 'ט״ז';
    let out = '';
    for (const [v, ch] of H) while (n >= v) { out += ch; n -= v; }
    if (!out) return '';
    return out.length > 1 ? out.slice(0, -1) + '״' + out.slice(-1) : out + '׳';
  }

  /** iso → "י״א באלול תשפ״ו". opts.year=false משמיט את השנה. */
  function hebDate(iso, opts) {
    if (!iso) return '';
    const withYear = !opts || opts.year !== false;
    let d;
    try {
      d = (iso instanceof Date) ? iso : new Date(String(iso).slice(0, 10) + 'T00:00:00');
      if (isNaN(d.getTime())) return String(iso);
    } catch (_) { return String(iso); }
    try {
      const parts = new Intl.DateTimeFormat('he-u-ca-hebrew',
        { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(d);
      const get = t => (parts.find(p => p.type === t) || {}).value || '';
      const day = gematria(parseInt(get('day'), 10));
      // formatToParts מחזיר את שם החודש בלי ה-ב׳ (היא מפריד ולא חלק מהחלק),
      // ולכן מוסיפים אותה כאן: "י״א באלול" ולא "י״א אלול".
      let month = get('month');
      if (month && month.charAt(0) !== 'ב') month = 'ב' + month;
      const year = gematria(parseInt(String(get('year')).replace(/\D/g, ''), 10));
      return day + ' ' + month + (withYear && year ? ' ' + year : '');
    } catch (_) { return String(iso); }
  }

  /** שנת הלימודים הנוכחית, למשל תשפ״ו. */
  function hebYear(date) {
    try {
      const y = new Intl.DateTimeFormat('en-u-ca-hebrew', { year: 'numeric' })
        .format(date || new Date());
      return gematria(parseInt(String(y).replace(/\D/g, ''), 10));
    } catch (_) { return ''; }
  }

  // גדילה אוטומטית ל-textarea של הדיווחים. `field-sizing:content` עושה את זה
  // ב-CSS, אבל הוא עוד לא נתמך בכל דפדפן — ובלעדיו שדה עם 8 שורות טקסט מציג
  // 3 ומסתיר את השאר. מאזין אחד ברמת המסמך מכסה גם תוכן שנוצר אחרי הטעינה.
  const AUTO_MAX = 340;   // תואם ל-max-height ב-CSS
  function autoGrow(t) {
    if (!t || t.tagName !== 'TEXTAREA' || !t.classList.contains('ta-auto')) return;
    if (CSS && CSS.supports && CSS.supports('field-sizing', 'content')) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight + 2, AUTO_MAX) + 'px';
  }
  document.addEventListener('input', e => autoGrow(e.target), true);
  document.addEventListener('focusin', e => autoGrow(e.target), true);

  window.UI = { modal, toast, confirm, el: elc, fullName: fullName, autoGrow: autoGrow,
    hebDate: hebDate, hebYear: hebYear, gematria: gematria };
})();
