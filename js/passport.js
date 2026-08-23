// passport.js — "דרכון": מעקב שבועי לפי פרשה (2026-08-23, בקשת יוסף).
//
// מחליף את הקובץ "מעקב דרכון אלול חורף תשפו 22 שבועות.xlsx" — שם היה גיליון
// נפרד לכל פרשה, בלי מספור, בלי סיכומים, ובלי דרך לראות מגמה של תלמיד.
// כאן: מסך אחד עם שתי תצוגות —
//   • **שבוע** — הזנה מהירה לכל התלמידים בפרשה אחת (כמו הגיליון, רק ממוין ומסוכם).
//   • **סיכום** — כל 22 השבועות במבט אחד, ממוצע וניקוד לכל תלמיד.
//
// ארבעת השדות זהים לחוברת הדרכון עצמה (C:\projects\darkon-hatzlacha):
//   שחרית בזמן · לימוד בשב"ק · מבחן גמרא עיון · שקו"ט גמרא בע"פ
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s && s.name) || '';

  // לוח 22 השבועות — זהה ללוח שנדפס בדרכון (ט׳ אלול תשפ״ו → כ״ט שבט תשפ״ז).
  // מוחזק כאן ולא במסד: הוא קבוע לשנה, והצמדה למסד רק תזמין אי-התאמה מול החוברת.
  const WEEKS = [
    ['כי תצא', 'ט׳ אלול'], ['כי תבוא', 'ט״ז אלול'], ['נצבים־וילך', 'כ״ג אלול'],
    ['ראש השנה', 'א׳ תשרי'], ['האזינו', 'ח׳ תשרי'],
    ['נח', 'ו׳ חשון'], ['לך־לך', 'י״ג חשון'], ['וירא', 'כ׳ חשון'], ['חיי שרה', 'כ״ז חשון'],
    ['תולדות', 'ד׳ כסליו'], ['ויצא', 'י״א כסליו'], ['וישלח', 'י״ח כסליו'], ['וישב', 'כ״ה כסליו'],
    ['מקץ', 'ב׳ טבת'], ['ויגש', 'ט׳ טבת'], ['ויחי', 'ט״ז טבת'], ['שמות', 'כ״ג טבת'],
    ['וארא', 'א׳ שבט'], ['בא', 'ח׳ שבט'], ['בשלח', 'ט״ו בשבט'], ['יתרו', 'כ״ב שבט'],
    ['משפטים', 'כ״ט שבט'],
  ];
  // שבת ראשונה (כי תצא) — ממנה נגזר "השבוע הנוכחי" כדי שהמסך ייפתח במקום הנכון
  const WEEK1 = new Date(2026, 7, 29);      // 29/08/2026, ט׳ אלול תשפ״ו

  const FIELDS = [
    { k: 'shacharit',    t: 'שחרית בזמן',   sub: 'ימים 0–6',   max: 7,    w: 96 },
    { k: 'study_min',    t: 'לימוד בשב״ק',  sub: 'דקות',       max: 1440, w: 96 },
    { k: 'test_written', t: 'מבחן בכתב',    sub: 'גמרא עיון',  max: 100,  w: 96 },
    { k: 'test_oral',    t: 'מבחן בע״פ',    sub: 'שקו״ט',      max: 100,  w: 96 },
  ];

  function currentWeek() {
    const days = Math.floor((Date.now() - WEEK1.getTime()) / 86400000);
    return Math.max(1, Math.min(WEEKS.length, Math.floor(days / 7) + 1));
  }

  const num = v => { const n = Number(v); return isFinite(n) ? n : null; };
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;

  // ניקוד שבועי אחיד 0–100: כל שדה נורמל לטווח שלו ומשוקלל שווה בשווה.
  // שדה שלא הוזן פשוט לא נספר — כך שבוע בלי מבחן לא "מעניש" את התלמיד.
  function score(r) {
    if (!r) return null;
    const parts = [];
    if (r.shacharit != null) parts.push(Math.min(100, (r.shacharit / 6) * 100));
    if (r.study_min != null) parts.push(Math.min(100, (r.study_min / 120) * 100));
    if (r.test_written != null) parts.push(r.test_written);
    if (r.test_oral != null) parts.push(r.test_oral);
    return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  }
  const chip = v => v == null ? '<span style="color:var(--muted)">—</span>'
    : '<span class="chip ' + (v >= 85 ? 'ok' : 'off') + '">' + v + '</span>';

  async function render(page) {
    const [students, classes, rows] = await Promise.all([
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
      window.store.list('classes'),
      window.store.list('passport'),
    ]);
    const clsOf = s => { const c = classes.find(x => x.id == s.class_id); return c ? c.name : 'ללא שיעור'; };
    const byKey = {};                                   // student_id|week → שורה
    (rows || []).forEach(r => { byKey[r.student_id + '|' + r.week_no] = r; });

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
      '<h2>דרכון — מעקב שבועי</h2>' +
      '<div class="head-actions">' +
        '<button class="btn-ghost sm" id="pspPdf"><i class="bi bi-file-earmark-pdf"></i> הורד PDF</button>' +
        '<button class="btn-ghost sm" id="pspCsv"><i class="bi bi-download"></i> ייצוא לאקסל</button>' +
        '<button class="btn-ghost sm" id="pspPrint"><i class="bi bi-printer"></i> הדפסה</button>' +
      '</div></div>' +
      // entry-ui: הטבלה *היא* טופס ההזנה. בלי הסימון הזה מצב "הזנה בלבד"
      // (מלמד) היה מסתיר אותה ומונע ממנו למלא את הדרכון בכלל.
      '<div class="toolbar entry-ui">' +
        '<select class="inp mb0" id="pspView">' +
          '<option value="week">תצוגה: שבוע אחד (הזנה)</option>' +
          '<option value="all">תצוגה: סיכום כל השבועות</option>' +
        '</select>' +
        '<select class="inp mb0" id="pspWeek">' +
          WEEKS.map((w, i) => '<option value="' + (i + 1) + '">' + (i + 1) + '. פרשת ' + esc(w[0]) + ' · ' + esc(w[1]) + '</option>').join('') +
        '</select>' +
        '<select class="inp mb0" id="pspCls"><option value="">כל השיעורים</option>' +
          classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select>' +
        (window.cv3Sort ? window.cv3Sort.bar('psp') : '') +
      '</div>' +
      '<div class="count-line" id="pspSum"></div>' +
      '<div id="pspWrap" class="table-wrap entry-ui"></div>';

    page.querySelector('#pspWeek').value = String(currentWeek());

    const visible = () => {
      const cid = page.querySelector('#pspCls').value;
      return students.filter(s => !cid || String(s.class_id) === cid);
    };

    // ── תצוגת שבוע: הזנה ──────────────────────────────────────────────────
    function drawWeek() {
      const wk = Number(page.querySelector('#pspWeek').value);
      const list = visible();
      const cell = (s, f) => {
        const r = byKey[s.id + '|' + wk];
        const v = r && r[f.k] != null ? r[f.k] : '';
        return '<td><input class="inp mb0 psp-in" type="number" min="0" max="' + f.max + '" ' +
          'style="width:' + f.w + 'px;padding:5px 8px;text-align:center" ' +
          'data-sid="' + s.id + '" data-f="' + f.k + '" value="' + esc(v) + '"></td>';
      };
      const row = (s, n) =>
        '<tr data-row="' + s.id + '"><td class="idx">' + n + '</td>' +
        '<td><span class="name-link" data-view="' + s.id + '">' + esc(nm(s)) + '</span></td>' +
        '<td>' + esc(clsOf(s)) + '</td>' +
        FIELDS.map(f => cell(s, f)).join('') +
        '<td class="psp-score">' + chip(score(byKey[s.id + '|' + wk])) + '</td></tr>';

      page.querySelector('#pspWrap').innerHTML =
        '<table class="tbl"><thead><tr><th style="width:44px">#</th><th>תלמיד</th><th>שיעור</th>' +
        FIELDS.map(f => '<th>' + esc(f.t) + '<div class="tl-note" style="font-size:.7rem;font-weight:400">' + esc(f.sub) + '</div></th>').join('') +
        '<th>ניקוד</th></tr></thead><tbody>' +
        (window.cv3Sort ? window.cv3Sort.rows(page, 'psp', list, clsOf, row, 8)
                        : list.map((s, i) => row(s, i + 1)).join('')) +
        '</tbody></table>';

      const done = list.filter(s => byKey[s.id + '|' + wk]).length;
      const sc = list.map(s => score(byKey[s.id + '|' + wk])).filter(x => x != null);
      page.querySelector('#pspSum').textContent =
        'פרשת ' + WEEKS[wk - 1][0] + ' · הוזנו ' + done + ' מתוך ' + list.length +
        (sc.length ? ' · ממוצע ניקוד ' + avg(sc) : '');
      wireInputs(wk);
    }

    // שמירה בכל שינוי שדה. upsert לפי (student_id, week_no) — האילוץ במסד
    // מונע כפילות, ולכן אפשר לשמור בלי לבדוק קודם אם יש שורה.
    function wireInputs(wk) {
      page.querySelectorAll('.psp-in').forEach(inp => {
        inp.addEventListener('change', async () => {
          const sid = Number(inp.dataset.sid), f = inp.dataset.f;
          const raw = inp.value.trim();
          const val = raw === '' ? null : num(raw);
          const fld = FIELDS.find(x => x.k === f);
          if (val != null && (val < 0 || val > fld.max)) {
            window.UI.toast('ערך חייב להיות בין 0 ל-' + fld.max, 'err');
            inp.value = ''; return;
          }
          const key = sid + '|' + wk;
          const cur = byKey[key];
          inp.classList.add('psp-saving');
          try {
            if (cur) {
              await window.store.update('passport', cur.id, { [f]: val });
              cur[f] = val;
            } else {
              const payload = { student_id: sid, week_no: wk, parasha: WEEKS[wk - 1][0],
                                heb_date: WEEKS[wk - 1][1] };
              payload[f] = val;
              const r = await window.store.add('passport', payload);
              byKey[key] = (r.data && r.data[0]) || payload;
            }
            const tr = page.querySelector('[data-row="' + sid + '"]');
            if (tr) tr.querySelector('.psp-score').innerHTML = chip(score(byKey[key]));
            inp.classList.remove('psp-saving');
            inp.classList.add('psp-saved');
            setTimeout(() => inp.classList.remove('psp-saved'), 900);
          } catch (e) {
            inp.classList.remove('psp-saving');
            window.UI.toast('השמירה נכשלה: ' + (e.message || e), 'err');
          }
        });
      });
      page.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
        if (window.cv3Students && window.showPage) window.showPage('students');
      }));
    }

    // ── תצוגת סיכום: כל השבועות ───────────────────────────────────────────
    function drawAll() {
      const list = visible();
      const row = (s, n) => {
        const mine = WEEKS.map((w, i) => byKey[s.id + '|' + (i + 1)]);
        const scores = mine.map(score).filter(x => x != null);
        const sum = k => { const a = mine.map(r => r && r[k]).filter(x => x != null); return a.length ? a.reduce((x, y) => x + y, 0) : null; };
        const av = k => { const a = mine.map(r => r && r[k]).filter(x => x != null); return avg(a); };
        return '<tr><td class="idx">' + n + '</td><td>' + esc(nm(s)) + '</td><td>' + esc(clsOf(s)) + '</td>' +
          '<td>' + scores.length + '/' + WEEKS.length + '</td>' +
          '<td>' + (sum('shacharit') != null ? sum('shacharit') : '—') + '</td>' +
          '<td>' + (sum('study_min') != null ? Math.round(sum('study_min') / 60) + ' ש׳' : '—') + '</td>' +
          '<td>' + (av('test_written') != null ? av('test_written') : '—') + '</td>' +
          '<td>' + (av('test_oral') != null ? av('test_oral') : '—') + '</td>' +
          '<td>' + chip(avg(scores)) + '</td>' +
          '<td class="psp-spark">' + WEEKS.map((w, i) => {
            const v = score(mine[i]);
            return '<i title="' + esc(w[0]) + (v == null ? ' — לא הוזן' : ' · ' + v) + '" style="background:' +
              (v == null ? 'var(--line,#dde3ea)' : v >= 85 ? '#16a34a' : v >= 70 ? '#f59e0b' : '#dc2626') + '"></i>';
          }).join('') + '</td></tr>';
      };
      page.querySelector('#pspWrap').innerHTML =
        '<table class="tbl"><thead><tr><th style="width:44px">#</th><th>תלמיד</th><th>שיעור</th>' +
        '<th>שבועות</th><th>סה״כ שחרית</th><th>סה״כ לימוד</th><th>ממוצע בכתב</th><th>ממוצע בע״פ</th>' +
        '<th>ניקוד כללי</th><th>מגמה לאורך השנה</th></tr></thead><tbody>' +
        (window.cv3Sort ? window.cv3Sort.rows(page, 'psp', list, clsOf, row, 10)
                        : list.map((s, i) => row(s, i + 1)).join('')) +
        '</tbody></table>';
      const filled = Object.keys(byKey).length;
      page.querySelector('#pspSum').textContent =
        'סיכום ' + WEEKS.length + ' שבועות · ' + list.length + ' תלמידים · ' + filled + ' רשומות שהוזנו';
    }

    const draw = () => (page.querySelector('#pspView').value === 'all' ? drawAll() : drawWeek());

    ['#pspView', '#pspWeek', '#pspCls'].forEach(sel =>
      page.querySelector(sel).addEventListener('change', () => {
        // בתצוגת הסיכום בורר הפרשה מיותר ורק מבלבל
        page.querySelector('#pspWeek').style.display =
          page.querySelector('#pspView').value === 'all' ? 'none' : '';
        draw();
      }));
    if (window.cv3Sort) window.cv3Sort.wire(page, 'psp', draw);

    // ── יצוא והדפסה ──
    page.querySelector('#pspCsv').addEventListener('click', () => {
      const t = page.querySelector('#pspWrap table');
      if (!t) return;
      const cell = v => { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
      const lines = [...t.tHead.rows, ...t.tBodies[0].rows].map(r =>
        [...r.cells].map(c => cell(c.querySelector('input') ? c.querySelector('input').value : c.innerText)).join(','));
      const blob = new Blob([String.fromCharCode(0xFEFF) + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'דרכון — ' + (page.querySelector('#pspView').value === 'all' ? 'סיכום' : WEEKS[Number(page.querySelector('#pspWeek').value) - 1][0]) + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    });
    page.querySelector('#pspPrint').addEventListener('click', () => {
      document.body.classList.add('printing-card');
      window.print();
      setTimeout(() => document.body.classList.remove('printing-card'), 400);
    });
    if (window.cv3Pdf) window.cv3Pdf.wire(page.querySelector('#pspPdf'),
      () => page.querySelector('#pspWrap'),
      () => 'דרכון — ' + (page.querySelector('#pspView').value === 'all' ? 'סיכום' : WEEKS[Number(page.querySelector('#pspWeek').value) - 1][0]),
      () => ({ orientation: 'landscape', margin: 6 }));

    style();
    draw();
  }

  function style() {
    if (document.getElementById('pspStyle')) return;
    const s = document.createElement('style'); s.id = 'pspStyle';
    s.textContent =
      '.psp-in{transition:box-shadow .2s,background .2s}' +
      '.psp-in.psp-saving{background:#fff7ed}' +
      '.psp-in.psp-saved{background:#dcfce7;box-shadow:0 0 0 2px #16a34a33}' +
      '.psp-spark{white-space:nowrap;direction:ltr}' +
      '.psp-spark i{display:inline-block;width:7px;height:16px;margin:0 1px;border-radius:2px;vertical-align:middle}';
    document.head.appendChild(s);
  }

  // ── סקשן לכרטיס התלמיד ────────────────────────────────────────────────
  // מציג את חמשת השבועות האחרונים שהוזנו + סיכום, ולא את כל 22 —
  // הכרטיס אמור לתת תמונה, לא להיות טבלה שנייה.
  function cardSection(rows) {
    rows = (rows || []).slice().sort((a, b) => b.week_no - a.week_no);
    const head = '<div class="det-sec"><h4><i class="bi bi-passport"></i> דרכון' +
      ' <span class="det-badge">' + rows.length + '/' + WEEKS.length + '</span></h4>';
    if (!rows.length) {
      return head + '<div class="tl-note" style="padding:6px 2px;font-size:.84rem">' +
        'עדיין לא הוזנו נתוני דרכון לתלמיד זה.</div></div>';
    }
    const sc = rows.map(score).filter(x => x != null);
    const pick = k => rows.map(r => r[k]).filter(x => x != null);
    const sum = k => { const a = pick(k); return a.length ? a.reduce((x, y) => x + y, 0) : null; };
    const av = k => { const a = pick(k); return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null; };
    const val = v => v == null ? '—' : v;
    return head +
      '<div class="det-grid">' +
        '<div class="det-row"><span class="det-lbl">ניקוד ממוצע</span><span class="det-val">' +
          (sc.length ? chip(Math.round(sc.reduce((a, b) => a + b, 0) / sc.length)) : '—') + '</span></div>' +
        '<div class="det-row"><span class="det-lbl">סה״כ שחרית בזמן</span><span class="det-val">' + val(sum('shacharit')) + ' ימים</span></div>' +
        '<div class="det-row"><span class="det-lbl">סה״כ לימוד בשב״ק</span><span class="det-val">' +
          (sum('study_min') != null ? Math.round(sum('study_min') / 60) + ' שעות' : '—') + '</span></div>' +
        '<div class="det-row"><span class="det-lbl">ממוצע מבחנים</span><span class="det-val">בכתב ' +
          val(av('test_written')) + ' · בע״פ ' + val(av('test_oral')) + '</span></div>' +
      '</div>' +
      scrollWrap(rows.map(r =>
        '<div class="det-item"><span class="di-main"><strong>' + esc(r.parasha || '') + '</strong>' +
        ' · שחרית ' + val(r.shacharit) + ' · לימוד ' + val(r.study_min) + ' דק׳' +
        (r.test_written != null ? ' · בכתב ' + r.test_written : '') +
        (r.test_oral != null ? ' · בע״פ ' + r.test_oral : '') +
        '</span><span class="di-meta">' + esc(r.heb_date || '') + '</span></div>').join(''), rows.length) +
      '</div>';
  }
  // גלילה פנימית: מציג כחמש שורות, והשאר בגלילה — כך 22 שבועות לא מותחים את הכרטיס
  function scrollWrap(html, n) {
    return n > 5 ? '<div class="det-scroll">' + html + '</div>' : html;
  }

  window.cv3Passport = { WEEKS, FIELDS, score, currentWeek, cardSection };
  const R = window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  R.passport = render;
})();
