// pdf.js — הורדת PDF ישירה, בלי לעבור דרך חלון ההדפסה (2026-08-20, בקשת יוסף).
//
// למה לא להסתמך על "שמור כ-PDF" בחלון ההדפסה: זה שלושה קליקים, ובחלק
// מהמחשבים היעד הזה בכלל לא מופיע. כאן לוחצים כפתור אחד והקובץ יורד.
//
// איך: html2canvas מצייר את האלמנט לקנבס (הדפדפן עצמו מרנדר — ולכן עברית,
// RTL, פונטים ולוגו יוצאים בדיוק כמו על המסך), ו-jsPDF חותך את הקנבס
// לעמודי A4 ומוריד קובץ. שתי הספריות **מקומיות** ב-vendor/ ולא מ-CDN,
// כי נטפרי חוסם CDN-ים.
//
// מגבלה מודעת: הטקסט ב-PDF הוא תמונה ולא טקסט לחיפוש. הדרך היחידה לטקסט
// אמיתי היא הטמעת פונט עברי ב-jsPDF וכתיבה ידנית שורה-שורה — מה שהורס את
// העיצוב. לרשימות ולטפסים להדפסה זו התמורה הנכונה.
(function () {
  'use strict';

  function ready() {
    return !!(window.html2canvas && window.jspdf && window.jspdf.jsPDF);
  }

  // ממתין לטעינת הספריות (הן נטענות בסוף ה-<head>/body; אם כבר כאן — מיידי)
  function waitLibs(ms) {
    const t0 = Date.now();
    return new Promise((res, rej) => {
      (function poll() {
        if (ready()) return res();
        if (Date.now() - t0 > (ms || 8000)) return rej(new Error('ספריות ה-PDF לא נטענו'));
        setTimeout(poll, 120);
      })();
    });
  }


  // html2canvas לא יודע לפרסר צבעים מודרניים. העיצוב כאן בנוי על color-mix(),
  // וכרום מחשב אותו ל-color(srgb …) — ולכן ההמרה נפלה עם
  // "Attempting to parse an unsupported color function". במקום לוותר על color-mix
  // בכל ה-CSS, ממירים בעותק המשוכפל בלבד: מציירים את הצבע על קנבס 1×1 וקוראים
  // את הפיקסל — כלומר הדפדפן עצמו עושה את ההמרה, ואין הבדל ויזואלי.
  const COLOR_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor',
    'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke',
    'textDecorationColor', 'caretColor', 'columnRuleColor'];
  const MODERN = /color\(|color-mix|oklch|oklab|lab\(|lch\(/;
  function sanitizeColors(doc) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    const conv = v => {
      try {
        c2.clearRect(0, 0, 1, 1); c2.fillStyle = '#000'; c2.fillStyle = v;
        c2.fillRect(0, 0, 1, 1);
        const d = c2.getImageData(0, 0, 1, 1).data;
        return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255).toFixed(3) + ')';
      } catch (_) { return 'rgba(0,0,0,0)'; }
    };
    const view = doc.defaultView || window;
    const all = doc.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      let cs; try { cs = view.getComputedStyle(el); } catch (_) { continue; }
      if (!cs) continue;
      for (let j = 0; j < COLOR_PROPS.length; j++) {
        const pr = COLOR_PROPS[j], v = cs[pr];
        if (v && MODERN.test(v)) el.style[pr] = conv(v);
      }
      // גרדיאנטים/צללים עם צבע מודרני — מוותרים עליהם בדפוס במקום ליפול
      if (cs.backgroundImage && MODERN.test(cs.backgroundImage)) el.style.backgroundImage = 'none';
      if (cs.boxShadow && MODERN.test(cs.boxShadow)) el.style.boxShadow = 'none';
    }
  }

  const A4 = { p: [210, 297], l: [297, 210] };   // מ"מ

  /**
   * @param {HTMLElement} el      האלמנט להמרה
   * @param {string} filename     שם הקובץ (בלי סיומת)
   * @param {object} [opts]       { orientation:'portrait'|'landscape', margin:mm, scale, onStatus }
   */
  async function save(el, filename, opts) {
    opts = opts || {};
    const note = opts.onStatus || function () {};
    if (!el) throw new Error('אין מה להמיר');
    note('מכין PDF…');
    await waitLibs();

    // רקע לבן מפורש: אלמנט שקוף יוצא שחור ב-canvas
    const canvas = await window.html2canvas(el, {
      backgroundColor: '#ffffff',
      scale: opts.scale || Math.min(2, window.devicePixelRatio || 1) * 1.5,
      useCORS: true,
      logging: false,
      windowWidth: el.scrollWidth,
      onclone: doc => {
        sanitizeColors(doc);
        // ב-PDF מוציאים את הכל: מה שמוסתר מאחורי "הצג את כל הנתונים" ומה
        // שגלול בתוך סקשן. אחרת הקובץ מציג פחות ממה שיש בכרטיס.
        doc.querySelectorAll('[hidden]').forEach(e => { e.hidden = false; e.style.display = ''; });
        doc.querySelectorAll('.det-scroll').forEach(e => {
          e.style.maxHeight = 'none'; e.style.overflow = 'visible';
          e.style.border = '0'; e.style.background = 'none';
        });
        doc.querySelectorAll('.det-more-btn').forEach(e => { e.style.display = 'none'; });
      },
    });

    const land = opts.orientation === 'landscape';
    const [pw, ph] = land ? A4.l : A4.p;
    const margin = opts.margin == null ? 8 : opts.margin;
    const usableW = pw - margin * 2, usableH = ph - margin * 2;

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: land ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });

    // הקנבס מחולק לפרוסות בגובה עמוד. חותכים על קנבס ביניים במקום למתוח
    // תמונה אחת ארוכה — כך אין דחיסה ואין שורות חתוכות בין העמודים.
    const pxPerMm = canvas.width / usableW;
    const sliceH = Math.floor(usableH * pxPerMm);
    const pages = Math.max(1, Math.ceil(canvas.height / sliceH));
    const cut = document.createElement('canvas');
    const ctx = cut.getContext('2d');

    for (let i = 0; i < pages; i++) {
      const h = Math.min(sliceH, canvas.height - i * sliceH);
      cut.width = canvas.width; cut.height = h;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cut.width, cut.height);
      ctx.drawImage(canvas, 0, i * sliceH, canvas.width, h, 0, 0, canvas.width, h);
      if (i) pdf.addPage();
      pdf.addImage(cut.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, usableW, h / pxPerMm);
      note('מכין PDF… עמוד ' + (i + 1) + ' מתוך ' + pages);
    }
    pdf.save((filename || 'מסמך').replace(/[\\/:*?"<>|]/g, '-') + '.pdf');
    note('');
    return pages;
  }

  // כפתור מוכן לשימוש: מחזיר HTML של כפתור, ו-wire() מחבר אותו
  function button(id, label) {
    return '<button class="btn-ghost sm" id="' + id + '"><i class="bi bi-file-earmark-pdf"></i> ' +
      (label || 'הורד PDF') + '</button>';
  }
  function wire(btn, getEl, getName, opts) {
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const old = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="bi bi-hourglass-split"></i> מכין…';
      try {
        await save(typeof getEl === 'function' ? getEl() : getEl,
          typeof getName === 'function' ? getName() : getName,
          typeof opts === 'function' ? opts() : opts);
      } catch (e) {
        if (window.UI) window.UI.toast('יצירת ה-PDF נכשלה: ' + (e.message || e), 'err');
      } finally {
        btn.disabled = false; btn.innerHTML = old;
      }
    });
  }

  window.cv3Pdf = { save, button, wire, ready };
})();
