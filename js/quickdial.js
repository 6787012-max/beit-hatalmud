// quickdial.js — פאנל "חיוג מהיר" מסרגל הכותרת: טקסט חופשי, או בחירה מרשימת
// אנשי הקשר (staff+profiles, אותו איחוד בדיוק כמו js/team.js) — לחיצה על
// כפתור/שם קוראת ל-cv3Call.dial() החדש, אותו קוד חיוג בדיוק שכרטיס התלמיד
// כבר משתמש בו (js/call.js). כמו כפתור החיוג בכרטיס תלמיד, הבדיקה כאן
// (role==='מנהל') היא UX בלבד — ההרשאה האמיתית נבדקת בצד-שרת ב-call-parent.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function openPanel() {
    if ((window.currentUser || {}).role !== 'מנהל') { window.UI.toast('פעולה זו למנהלים בלבד', 'err'); return; }

    // רשימת {name, phone} אחרי סינון. הטלפון חי רק כאן, בסגירה של ה-IIFE —
    // אף פעם לא נכתב ל-DOM, רק השם. shown הוא תת-הקבוצה המוצגת כרגע (אחרי
    // סינון הטקסט), אינדקס data-i מצביע לתוכה — אותו idiom כמו shown[i]
    // ב-team.js draw().
    let all = null;
    let shown = [];

    const m = window.UI.modal({
      title: 'חיוג מהיר',
      bodyHTML:
        '<div style="display:flex;gap:8px">' +
          '<input class="inp mb0" id="qdFreeInput" type="text" placeholder="הקלד מספר טלפון וחייג" style="flex:1">' +
          '<button class="mini" id="qdFreeBtn" title="חייג"><i class="bi bi-telephone-outbound"></i> חייג</button>' +
        '</div>' +
        '<input class="inp mb0" id="qdFilter" type="text" placeholder="סינון אנשי קשר…" style="margin-top:12px">' +
        '<div class="tm-pick" id="qdList" style="margin-top:10px">' +
          '<div class="tl-note" style="padding:10px">טוען אנשי קשר…</div>' +
        '</div>',
      onClose: () => {},
    });

    const freeInput = m.el.querySelector('#qdFreeInput');
    const freeBtn = m.el.querySelector('#qdFreeBtn');
    const filterInput = m.el.querySelector('#qdFilter');
    const listEl = m.el.querySelector('#qdList');

    // חיוג טקסט חופשי — אותו codepath בדיוק כמו לחיצה על שם ברשימה למטה.
    // הנירמול (ולכן גם בדיקת התקינות) קורה בתוך dial() עצמה.
    async function freeDial() {
      const v = freeInput.value.trim();
      if (!v) return;
      const ok = await window.cv3Call.dial(v);
      if (ok) freeInput.value = '';
    }
    freeBtn.addEventListener('click', freeDial);
    freeInput.addEventListener('keydown', e => { if (e.key === 'Enter') freeDial(); });

    function draw() {
      const q = filterInput.value.trim();
      shown = q ? all.filter(p => p.name.includes(q)) : all;
      listEl.innerHTML = shown.length
        ? shown.map((p, i) => '<button class="qk-item" data-i="' + i + '">' + esc(p.name) + '</button>').join('')
        : '<div class="tl-note" style="padding:10px">לא נמצאו אנשי קשר תואמים</div>';
      listEl.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', async () => {
        const p = shown[Number(b.dataset.i)];
        if (!p) return;
        b.disabled = true;
        // המודאל נשאר פתוח אחרי חיוג מוצלח — כדי לאפשר לחייג כמה אנשים
        // ברצף בלי לפתוח את הפאנל מחדש בכל פעם.
        const ok = await window.cv3Call.dial(p.phone);
        if (!ok) b.disabled = false; // בוטל/נכשל — לאפשר לנסות שוב על אותה שורה
      }));
    }
    filterInput.addEventListener('input', () => { if (all) draw(); });

    // הרשימה נטענת פעם אחת כשהמודאל נפתח — אבל בלי לחסום את חצי הטקסט
    // החופשי, שלא תלוי בה בכלל (freeDial כבר מוכן לפעולה מהרגע שהמודאל נפתח).
    (async () => {
      const d = await window.cv3Team.loadAll();
      const people = window.cv3Team.merge(d);
      all = people
        // מי שכבר לא בסגל — לא מוצג ב"מי אפשר לחייג" (בשונה מטבלת הניהול של
        // team.js, ששומרת גם לא-פעילים לצורך תיעוד).
        .filter(p => !p.inactive)
        .map(p => ({ name: p.name, phone: window.cv3NormPhone ? window.cv3NormPhone(p.phone) : null }))
        .filter(p => p.phone); // בלי מספר תקין — לא ניתן לחיוג, מדלגים
      draw();
    })();
  }

  const btn = document.getElementById('quickDialBtn');
  if (btn) btn.addEventListener('click', openPanel);

  window.cv3QuickDial = { open: openPanel };
})();
