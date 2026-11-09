// ── מכתב להורים על נייר המכינה ─────────────────────────────────────────
// טופס שגופו מתחיל בשורה [מכתב] מוצג כדף מכתב אמיתי: נייר המכתבים של המכינה
// (ראש, אמצע ותחתית — כך שהוא נשאר יפה גם בטלפון), טקסט בגופן דוד, ובספח
// התחתון שם התלמיד כבר כתוב. משמש את דף החתימה (sign.html) ואת התצוגה
// המקדימה וההדפסה במסך הטפסים (form-templates.js).
//
// סימון בגוף הטופס (שורה = פסקה). הכל עובר escape — אין הזרקת HTML:
//   ^שורה        ממורכזת          !שורה      גדולה ומודגשת (אפשר ^! יחד)
//   • פריט       פריט ברשימה      **מודגש**  __קו תחתון__
//   [[2]] … [[|]] … [[/2]]   שתי עמודות (רשימות "יש להביא" / "אין להביא")
//   ---          קו הספח          ___ (3+)   קו ריק למילוי
//   {{student_name}}          שם התלמיד (בקישור האישי של כל הורה)
//   שורה ריקה    רווח
(function () {
  const MARK = '[מכתב]';

  function isLetter(body) {
    return typeof body === 'string' && body.replace(/^\s+/, '').indexOf(MARK) === 0;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function inline(s, opts) {
    let h = esc(s);
    // קווי מילוי לפני קו תחתון — אחרת "______" נקרא כ-__…__
    h = h.replace(/_{3,}/g, m => '<span class="lt-blank" style="min-width:' + (m.length * 0.42).toFixed(1) + 'em"></span>');
    // nameHTML = HTML מוכן מהקורא (בורר "בחרו את שם הבן" בקישור הכללי); name = טקסט
    h = h.replace(/\{\{\s*student_name\s*\}\}/g, () => opts.nameHTML ? opts.nameHTML : opts.name
      ? '<span class="lt-name">' + esc(opts.name) + '</span>'
      : '<span class="lt-blank" style="min-width:7em"></span>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<u>$1</u>');
    return h;
  }

  function render(body, opts) {
    opts = opts || {};
    const lines = String(body || '').replace(/\r/g, '').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length && lines[0].trim() === MARK) lines.shift();
    let out = '', ul = null, cols = null;
    const emit = h => { if (cols) cols[cols.length - 1] += h; else out += h; };
    const flushUl = () => { if (ul) { emit('<ul class="lt-ul">' + ul + '</ul>'); ul = null; } };
    const closeCols = () => {
      if (!cols) return;
      const c = cols; cols = null;
      out += '<div class="lt-cols">' + c.map(x => '<div class="lt-col">' + x + '</div>').join('') + '</div>';
    };
    lines.forEach(raw => {
      const t = raw.trim();
      if (t === '[[2]]') { flushUl(); closeCols(); cols = ['']; return; }
      if (t === '[[|]]') { flushUl(); if (cols) cols.push(''); return; }
      if (t === '[[/2]]') { flushUl(); closeCols(); return; }
      if (!t) { flushUl(); emit('<div class="lt-gap"></div>'); return; }
      if (t === '---') { flushUl(); emit('<div class="lt-tear"></div>'); return; }
      let x = t;
      const cls = [];
      while (/^[\^!]/.test(x)) { cls.push(x.charAt(0) === '^' ? 'lt-c' : 'lt-big'); x = x.slice(1).trim(); }
      const c = cls.length ? ' ' + cls.join(' ') : '';
      if (/^[•·]/.test(x)) {
        ul = (ul || '') + '<li class="lt-li' + c + '">' + inline(x.replace(/^[•·]\s*/, ''), opts) + '</li>';
        return;
      }
      flushUl();
      emit('<p class="lt-p' + c + '">' + inline(x, opts) + '</p>');
    });
    flushUl(); closeCols();
    return out;
  }

  // ── נייר המכתבים — וקטורי לגמרי. התמונה היחידה היא הלוגו (img/logo.png). ──
  // קודם היו כאן שלוש תמונות JPG של הנייר, ונטפרי החליף את התחתונה בדרך (נבדק
  // 09/11/2026: הגיע קובץ אחר בגודל אחר). הלוגו עבר שלם. לכן הגל, הקווים, הרקע
  // והכתובת מצוירים בקוד — אין מה לחסום. הצבעים והמידות נדגמו מנייר המכתבים המקורי.
  const WAVE = 'M0,127 C40,142 90,145 150,134 C210,123 300,112 397,116 C494,112 584,123 644,134 C704,145 754,142 794,127';
  const HEAD_SVG =
    '<svg class="lt-wave" viewBox="0 0 794 222" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M0,0 H794 V127 C754,142 704,145 644,134 C584,123 494,112 397,116 C300,112 210,123 150,134 C90,145 40,142 0,127 Z" fill="#09425b"/>' +
    '<path d="' + WAVE + '" transform="translate(0,3)" fill="none" stroke="#b4b080" stroke-width="4"/>' +
    '<path d="' + WAVE + '" transform="translate(0,7)" fill="none" stroke="#0a435c" stroke-width="4"/>' +
    '<path d="' + WAVE + '" transform="translate(0,12)" fill="none" stroke="#9f7a0a" stroke-width="5"/>' +
    '</svg>';
  // המייל בתוך span בכיוון שמאל-לימין — בלי זה הוא מתהפך ל-"gmail.com@6787012"
  const ADDRESS_HTML = esc('נהר הירדן 106 (פינת נחל רפאים), רמת בית שמש א\' | מייל: ') +
    '<span dir="ltr">6787012@gmail.com</span>';

  // עוטף תוכן בדף נייר מכתבים. base = נתיב לתיקיית האתר (ברירת מחדל: יחסי).
  function paper(inner, base) {
    const b = base || '';
    return '<div class="lt-paper">' +
      '<div class="lt-head">' + HEAD_SVG +
      '<img class="lt-logo" src="' + b + 'img/logo.png" alt="בית התלמוד — מכינה לצעירים, בית שמש"></div>' +
      '<div class="lt-body">' + inner + '</div>' +
      '<div class="lt-foot">' + ADDRESS_HTML + '</div>' +
      '</div>';
  }

  // ספח חתום — כמו טופס שההורה מילא ביד: תשובות, שם החותם, החתימה עצמה ותאריך.
  // o = { items:[[תווית, ערך]], signer, sigLabel, sigHTML (SVG/IMG מוכן), date (YYYY-MM-DD) }
  function signedSlip(o) {
    o = o || {};
    const d = String(o.date || '');
    const date = /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : d;
    return '<div class="lt-slip">' +
      (o.items || []).map(it => '<div class="lt-field"><span>' + esc(it[0]) + ':</span> <b>' + esc(it[1] == null || it[1] === '' ? '—' : it[1]) + '</b></div>').join('') +
      '<div class="lt-field"><span>שם ההורה החותם:</span> <b>' + esc(o.signer || '') + '</b></div>' +
      '<div class="lt-field lt-sigf"><span>' + esc(o.sigLabel || 'חתימת הורים') + ':</span>' +
      (o.sigHTML ? '<div class="lt-sig">' + o.sigHTML + '</div>' : '') + '</div>' +
      '<div class="lt-stamp">✓ נחתם דיגיטלית בתאריך ' + esc(date) + '</div>' +
      '</div>';
  }

  window.cv3Letter = { MARK: MARK, isLetter: isLetter, render: render, paper: paper, signedSlip: signedSlip };
})();
