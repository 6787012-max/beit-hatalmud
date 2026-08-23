// sortui.js — מיון וקיבוץ אחידים לכל מסך שמציג רשימת תלמידים (2026-08-23).
//
// למה מודול משותף ולא קוד בכל מסך: לפני זה כל מסך הציג את סדר ההכנסה למסד,
// וכל תיקון נקודתי היה יוצר התנהגות שונה במסך אחר. כאן מוגדרים במקום אחד:
// סדר המיון, שמות האפשרויות, הסרגל, והקיבוץ לפי שיעור — וכל מסך רק מחבר.
//
// ⚠️ העמודה `name` במסד היא "שם פרטי + משפחה" ("דוד אריה אוליאל"), ולכן מיון
// לפיה בלבד הוא מיון לפי שם פרטי. שם המשפחה יושב בעמודה `family`, והוא
// ברירת המחדל — כי זה מה שמצפים לו ברשימת שיעור.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const he = (a, b) => String(a || '').localeCompare(String(b || ''), 'he');
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s && s.name) || '';

  const MODES = [
    ['family', 'שם משפחה (א״ב)'],
    ['first', 'שם פרטי (א״ב)'],
    ['cls', 'כיתה ואז שם משפחה'],
  ];

  const byFamily = (a, b) => he(a.family, b.family) || he(nm(a), nm(b));
  const byFirst = (a, b) => he(nm(a), nm(b));

  /** ממיין עותק של הרשימה. mode: family | first | cls */
  function sort(list, mode, clsName) {
    const arr = (list || []).slice();
    const cmp = mode === 'first' ? byFirst : byFamily;
    if (mode === 'cls') {
      const c = clsName || (s => '');
      return arr.sort((a, b) => he(c(a), c(b)) || cmp(a, b));
    }
    return arr.sort(cmp);
  }

  /** מחלק לקבוצות לפי שיעור, בסדר שמות השיעורים. */
  function groups(list, clsName) {
    const out = [];
    (list || []).forEach(s => {
      const k = clsName(s) || 'ללא שיעור';
      let g = out.find(x => x.cls === k);
      if (!g) out.push(g = { cls: k, items: [] });
      g.items.push(s);
    });
    out.sort((a, b) => he(a.cls, b.cls));
    return out;
  }

  /** HTML של הסרגל. pre = תחילית ייחודית למסך, כדי שלא יתנגשו מזהים. */
  function bar(pre, opts) {
    opts = opts || {};
    return '<select class="inp mb0" id="' + pre + 'Sort" title="מיון הרשימה">' +
      MODES.map(m => '<option value="' + m[0] + '">מיון: ' + m[1] + '</option>').join('') +
      '</select>' +
      (opts.group === false ? '' :
        '<label class="cb" style="white-space:nowrap"><input type="checkbox" id="' + pre +
        'Group"> קיבוץ לפי שיעור</label>');
  }

  /** מחבר את הסרגל ל-redraw. select ו-checkbox משדרים change, לא input. */
  function wire(root, pre, redraw) {
    ['#' + pre + 'Sort', '#' + pre + 'Group'].forEach(sel => {
      const el = root.querySelector(sel);
      if (!el) return;
      el.addEventListener('change', redraw);
      el.addEventListener('input', redraw);
    });
  }

  function mode(root, pre) {
    const el = root.querySelector('#' + pre + 'Sort');
    return el ? el.value : 'family';
  }
  function isGrouped(root, pre) {
    const el = root.querySelector('#' + pre + 'Group');
    return !!(el && el.checked);
  }

  /**
   * בונה את שורות הטבלה: או רשימה שטוחה, או מקובצת לפי שיעור עם כותרת.
   * rowHtml(student, n) מחזיר <tr>; cols = מספר העמודות לכותרת המקבצת.
   */
  function rows(root, pre, list, clsName, rowHtml, cols) {
    const m = mode(root, pre);
    const grouped = isGrouped(root, pre);
    const sorted = sort(list, grouped ? 'cls' : m, clsName);
    if (!grouped) return sorted.map((s, i) => rowHtml(s, i + 1)).join('');
    // המספור מתחיל מ-1 בכל שיעור — כמו רשימת כיתה מודפסת
    return groups(sorted, clsName).map(g =>
      '<tr class="grp"><td colspan="' + (cols || 6) + '"><i class="bi bi-mortarboard"></i> ' +
      esc(g.cls) + ' <span class="det-badge">' + g.items.length + '</span></td></tr>' +
      g.items.map((s, i) => rowHtml(s, i + 1)).join('')).join('');
  }

  window.cv3Sort = { sort, groups, bar, wire, mode, isGrouped, rows, MODES };
})();
