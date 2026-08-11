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

  window.UI = { modal, toast, confirm, el: elc };
})();
