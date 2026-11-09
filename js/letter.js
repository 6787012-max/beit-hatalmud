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
    h = h.replace(/\{\{\s*student_name\s*\}\}/g, () => opts.name
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

  // עוטף תוכן בדף נייר מכתבים. base = נתיב לתיקיית האתר (ברירת מחדל: יחסי).
  function paper(inner, base) {
    const b = base || '';
    return '<div class="lt-paper">' +
      '<img class="lt-top" src="' + b + 'img/letterhead-top.jpg" alt="מכינה בית התלמוד">' +
      '<div class="lt-body">' + inner + '</div>' +
      '<img class="lt-bot" src="' + b + 'img/letterhead-bot.jpg" alt="">' +
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
