// labels.js — פאנל הדפסת מדבקות (2026-08-27, בקשת יוסף).
//
// נפתח ככפתור בתוך מסך "יצוא והדפסה", כפאנל עצמאי משלו: בוחרים גודל דף,
// כמה עמודות וכמה שורות, שוליים (או בלי), או תבנית מדף מוכנה — ואז מזרימים
// לתוכו תוכן: שמות התלמידים מהמערכת, טקסט שמקלידים, או קובץ אקסל/CSV.
//
// למה לא להרחיב את exporter.js: שם היחידה היא *טבלה* בזרימה, וכאן היא
// *מלבן במידות מ"מ במיקום מוחלט*. שתי הגיאומטריות לא מתערבבות — טבלה
// שנשברת בין עמודים היא תכונה בדוח ופגם קטלני בגיליון מדבקות.
//
// ⚠️ כל המיקומים במ"מ ובמיקום מוחלט, ו-@page margin:0 — כלומר **חובה
// להדפיס ב-100% ולא "התאם לדף"**, אחרת הכל זז ביחס לגיליון הפיזי.
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (v, d) => { const n = parseFloat(v); return isNaN(n) ? d : n; };

  // ── גדלי נייר (מ"מ) ─────────────────────────────────────────────────────
  const PAPERS = {
    a4: { label: 'A4 (210×297)', w: 210, h: 297 },
    a3: { label: 'A3 (297×420)', w: 297, h: 420 },
    a5: { label: 'A5 (148×210)', w: 148, h: 210 },
    letter: { label: 'Letter (216×279)', w: 215.9, h: 279.4 },
    custom: { label: 'מותאם אישית…', w: 210, h: 297 },
  };

  // ── תבניות מדבקות ──────────────────────────────────────────────────────
  // lw/lh = מידת המדבקה עצמה; mt/ms = שוליים עליון/צדדי; gx/gy = מרווח בין
  // מדבקות. מספרי Avery הם המידות הרשמיות שמפורסמות ליריעות A4 — הן
  // **לא נמדדו כאן פיזית**, ולכן לפני הזמנה גדולה מדפיסים דף אחד ומצמידים
  // אותו לגיליון ריק. היחידה שכן אומתה מול הגיליון הפיזי היא bht3x8.
  const TEMPLATES = [
    { id: 'custom', label: 'מותאם אישית — אני מגדיר הכל' },
    { id: 'bht3x8', label: '★ 3×8 · 70×35.9 מ״מ (24 בדף) — אומת פיזית במכינה',
      paper: 'a4', cols: 3, rows: 8, lw: 70, lh: 35.875, mt: 5, ms: 0, gx: 0, gy: 0, verified: true },
    { id: 'l7159', label: 'Avery L7159 · 63.5×33.9 (3×8 = 24)',
      paper: 'a4', cols: 3, rows: 8, lw: 63.5, lh: 33.9, mt: 12.9, ms: 7.2, gx: 2.5, gy: 0 },
    { id: 'l7160', label: 'Avery L7160 · 63.5×38.1 (3×7 = 21)',
      paper: 'a4', cols: 3, rows: 7, lw: 63.5, lh: 38.1, mt: 15.1, ms: 7.2, gx: 2.5, gy: 0 },
    { id: 'l7161', label: 'Avery L7161 · 63.5×46.6 (3×6 = 18)',
      paper: 'a4', cols: 3, rows: 6, lw: 63.5, lh: 46.6, mt: 8.9, ms: 7.2, gx: 2.5, gy: 0 },
    { id: 'l7162', label: 'Avery L7162 · 99.1×33.9 (2×8 = 16)',
      paper: 'a4', cols: 2, rows: 8, lw: 99.1, lh: 33.9, mt: 12.9, ms: 4.65, gx: 2.5, gy: 0 },
    { id: 'l7163', label: 'Avery L7163 · 99.1×38.1 (2×7 = 14)',
      paper: 'a4', cols: 2, rows: 7, lw: 99.1, lh: 38.1, mt: 15.1, ms: 4.65, gx: 2.5, gy: 0 },
    { id: 'l7165', label: 'Avery L7165 · 99.1×67.7 (2×4 = 8)',
      paper: 'a4', cols: 2, rows: 4, lw: 99.1, lh: 67.7, mt: 13.1, ms: 4.65, gx: 2.5, gy: 0 },
    { id: 'l7169', label: 'Avery L7169 · 99.1×139 (2×2 = 4)',
      paper: 'a4', cols: 2, rows: 2, lw: 99.1, lh: 139, mt: 8.8, ms: 4.65, gx: 2.5, gy: 0 },
    { id: 'l7651', label: 'Avery L7651 · 38.1×21.2 (5×13 = 65) — זעירות',
      paper: 'a4', cols: 5, rows: 13, lw: 38.1, lh: 21.2, mt: 10.7, ms: 4.75, gx: 2.5, gy: 0 },
    { id: 'full', label: 'ללא שוליים — המדבקות ממלאות את כל הדף',
      paper: 'a4', cols: 3, rows: 8, mt: 0, ms: 0, gx: 0, gy: 0, fill: true },
  ];

  // ── שדות התלמיד שאפשר להדפיס ───────────────────────────────────────────
  const FIELDS = [
    { k: 'full', t: 'שם מלא' },
    { k: 'first', t: 'שם פרטי' },
    { k: 'family', t: 'שם משפחה' },
    { k: 'cls', t: 'שיעור (שם מלא)' },
    { k: 'clsShort', t: 'שיעור בלבד' },
    { k: 'rav', t: 'שם הרב' },
    { k: 'tz', t: 'תעודת זהות' },
    { k: 'inst', t: 'שם המוסד' },
    { k: 'year', t: 'שנה (תשפ״ז)' },
  ];

  const DEF = () => ({
    tpl: 'bht3x8', paper: 'a4', cw: 210, ch: 297, orient: 'portrait',
    cols: 3, rows: 8, sizeMode: 'exact', lw: 70, lh: 35.875,
    marginMode: 'market', mt: 5, mb: 5, ms: 0, me: 0, gx: 0, gy: 0,
    src: 'students', cls: [], fields: ['full'], sort: 'family',
    text: '', fileRows: [], fileName: '', fileHead: true,
    copies: 1, shuffle: false, noNick: true, startAt: 1, repeatOne: false,
    fontMode: 'uniform', font: 14, bold: true, align: 'center', wrapLines: true,
    border: true, cut: false, logo: false, dir: 'rtl', pad: 2,
  });

  // ═══════════════════════════════════════════════════════════════════════
  async function open() {
    const st = DEF();
    const [classes, students, staff] = await Promise.all([
      window.store.list('classes'),
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
      // שם הטבלה שונה בין המופעים (staff בבית התלמוד, staff_directory
      // בתלמוד תורה מעלה עמוס) — מנסים את שתיהן ולא נופלים על אף אחת.
      window.store.list('staff').catch(() => window.store.list('staff_directory').catch(() => [])),
    ]);
    const inst = (window.CV3 || {}).INSTANCE_NAME || '';
    const hebYear = (window.UI && window.UI.hebYear) ? window.UI.hebYear() : '';
    st.cls = classes.map(c => Number(c.id));

    // שם הרב: קודם שיוך `melamed` לאיש צוות, ואם אין — החלק שאחרי " - "
    // בשם השיעור ("שיעור ג1 - הרב יודלוב"). לשיעורים בלי אף אחד מהם
    // הערך ריק, והפאנל מתריע במקום להדפיס מדבקות חצי-ריקות בשקט.
    const clsOf = id => classes.filter(c => c.id == id)[0] || null;
    function ravOf(c) {
      if (!c) return '';
      if (c.melamed != null) {
        const s = staff.filter(x => x.id == c.melamed)[0];
        if (s) return (s.name || ((s.first_name || '') + ' ' + (s.last_name || ''))).trim();
      }
      const p = String(c.name || '').split(' - ');
      return p.length > 1 ? p.slice(1).join(' - ').trim() : '';
    }

    const ov = document.createElement('div');
    ov.className = 'modal-ov lb-ov';
    ov.innerHTML =
      '<div class="modal-card lb-card">' +
        '<div class="modal-head"><h3><i class="bi bi-tags-fill"></i> הדפסת מדבקות</h3>' +
          '<div class="lb-head-actions">' +
            '<button class="btn-ghost sm" id="lbImport"><i class="bi bi-file-earmark-excel"></i> ייבוא מאקסל</button>' +
            '<button class="btn-ghost sm" id="lbGuide"><i class="bi bi-question-circle"></i> מבנה הקובץ</button>' +
            '<button class="btn-ghost sm" id="lbPdf"><i class="bi bi-file-earmark-pdf"></i> הורד PDF</button>' +
            '<button class="btn-primary sm" id="lbPrint"><i class="bi bi-printer"></i> הדפסה</button>' +
          '</div>' +
          '<button class="modal-x" aria-label="סגור"><i class="bi bi-x-lg"></i></button>' +
        '</div>' +
        '<div class="modal-body lb-body">' + controlsHTML() + previewHTML() + '</div>' +
      '</div>';
    document.body.appendChild(ov);

    const $ = s => ov.querySelector(s);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.lb-ov ~ .modal-ov')) close(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    $('.modal-x').addEventListener('click', close);

    // ── HTML של הפקדים ───────────────────────────────────────────────────
    function controlsHTML() {
      return '<div class="lb-ctl">' +

        sec('bi-grid-3x3-gap', 'תבנית וגודל דף',
          fld('תבנית מוכנה', '<select class="inp mb0" id="lbTpl">' +
            TEMPLATES.map(t => '<option value="' + t.id + '"' + (t.id === st.tpl ? ' selected' : '') + '>' +
              esc(t.label) + '</option>').join('') + '</select>', 'wide') +
          fld('גודל הדף', '<select class="inp mb0" id="lbPaper">' +
            Object.keys(PAPERS).map(k => '<option value="' + k + '"' + (k === st.paper ? ' selected' : '') + '>' +
              esc(PAPERS[k].label) + '</option>').join('') + '</select>') +
          fld('כיוון', '<select class="inp mb0" id="lbOrient">' +
            '<option value="portrait">לאורך</option><option value="landscape">לרוחב</option></select>') +
          fld('רוחב הדף (מ״מ)', '<input class="inp mb0" id="lbCw" type="number" step="0.1" min="30" max="1000" value="' + st.cw + '">', 'lb-custom') +
          fld('גובה הדף (מ״מ)', '<input class="inp mb0" id="lbCh" type="number" step="0.1" min="30" max="1400" value="' + st.ch + '">', 'lb-custom')
        ) +

        sec('bi-layout-three-columns', 'רשת המדבקות',
          fld('עמודות', '<input class="inp mb0" id="lbCols" type="number" min="1" max="20" value="' + st.cols + '">') +
          fld('שורות', '<input class="inp mb0" id="lbRows" type="number" min="1" max="40" value="' + st.rows + '">') +
          fld('מידת המדבקה', '<select class="inp mb0" id="lbSize">' +
            '<option value="fill">מחושבת — ממלאת את השטח שנשאר</option>' +
            '<option value="exact" selected>מידה מדויקת שאני מזין</option></select>', 'wide') +
          fld('רוחב מדבקה (מ״מ)', '<input class="inp mb0" id="lbLw" type="number" step="0.1" min="5" value="' + st.lw + '">', 'lb-exact') +
          fld('גובה מדבקה (מ״מ)', '<input class="inp mb0" id="lbLh" type="number" step="0.1" min="5" value="' + st.lh + '">', 'lb-exact')
        ) +

        sec('bi-bounding-box', 'שוליים ומרווחים',
          fld('שוליים', '<select class="inp mb0" id="lbMm">' +
            '<option value="none">בלי שוליים בכלל (0)</option>' +
            '<option value="market" selected>המקובל בשוק — לפי התבנית (5 מ״מ במותאם אישית)</option>' +
            '<option value="printer">מינימום למדפסת ביתית (5 מ״מ)</option>' +
            '<option value="custom">אני קובע</option></select>', 'wide') +
          fld('עליון', '<input class="inp mb0" id="lbMt" type="number" step="0.1" min="0" value="' + st.mt + '">', 'lb-marg') +
          fld('תחתון', '<input class="inp mb0" id="lbMb" type="number" step="0.1" min="0" value="' + st.mb + '">', 'lb-marg') +
          fld('ימין', '<input class="inp mb0" id="lbMs" type="number" step="0.1" min="0" value="' + st.ms + '">', 'lb-marg') +
          fld('שמאל', '<input class="inp mb0" id="lbMe" type="number" step="0.1" min="0" value="' + st.me + '">', 'lb-marg') +
          fld('מרווח אופקי בין מדבקות', '<input class="inp mb0" id="lbGx" type="number" step="0.1" min="0" value="' + st.gx + '">') +
          fld('מרווח אנכי בין מדבקות', '<input class="inp mb0" id="lbGy" type="number" step="0.1" min="0" value="' + st.gy + '">')
        ) +

        sec('bi-fonts', 'מה כתוב על המדבקה',
          // ⚠️ היה select, ויוסף לא מצא בו את הייבוא מאקסל. שלושת המקורות
          // הם הבחירה הראשונה בפאנל — הם צריכים להיות גלויים, לא מגולגלים.
          '<div class="fld wide"><span>מקור התוכן</span><div class="lb-tabs" id="lbSrcTabs">' +
            '<button type="button" data-src="students" class="on"><i class="bi bi-people-fill"></i> תלמידי המכינה</button>' +
            '<button type="button" data-src="text"><i class="bi bi-pencil-square"></i> טקסט שאני מקליד</button>' +
            '<button type="button" data-src="file"><i class="bi bi-file-earmark-excel"></i> קובץ אקסל / CSV</button>' +
          '</div></div>' +

          // ── תלמידים ──
          '<div class="lb-when lb-students" style="grid-column:1/-1">' +
            '<div class="fld"><span>שיעורים</span><div class="cb-grid" id="lbCls">' +
              classes.map(c => '<label class="cb"><input type="checkbox" value="' + c.id + '" checked> ' +
                esc(c.name) + '</label>').join('') + '</div></div>' +
            '<div class="fld"><span>שורות הטקסט על המדבקה <small>— לפי הסדר; סמנו כמה שתרצו</small></span>' +
              '<div class="cb-grid" id="lbFields">' +
              FIELDS.map(f => '<label class="cb"><input type="checkbox" value="' + f.k + '"' +
                (st.fields.indexOf(f.k) > -1 ? ' checked' : '') + '> ' + esc(f.t) + '</label>').join('') +
              '</div></div>' +
            '<div class="qr-grid" style="grid-template-columns:repeat(2,1fr);gap:10px">' +
              fld('מיון', '<select class="inp mb0" id="lbSort">' +
                '<option value="family">לפי שם משפחה (א״ב)</option>' +
                '<option value="name">לפי שם מלא (א״ב)</option>' +
                '<option value="cls">לפי שיעור ואז א״ב</option>' +
                '<option value="none">כפי שהם במערכת</option></select>') +
              fld('&nbsp;', '<label class="cb"><input type="checkbox" id="lbShuffle"> סדר אקראי (ערבוב)</label>' +
                '<label class="cb" style="margin-top:4px"><input type="checkbox" id="lbNick" checked> בלי כינוי בסוגריים</label>') +
            '</div>' +
          '</div>' +

          // ── טקסט חופשי ──
          '<div class="lb-when lb-text" style="grid-column:1/-1;display:none">' +
            '<label class="fld"><span>הטקסט <small>— שורה אחת = מדבקה אחת. לשבירת שורה בתוך מדבקה: <b>|</b></small></span>' +
              '<textarea class="inp mb0" id="lbText" rows="6" placeholder="ישראל ישראלי&#10;שיעור א | הרב כהן&#10;כיתה ב\'"></textarea></label>' +
            '<label class="cb"><input type="checkbox" id="lbRepeat"> להדפיס את השורה הראשונה על <b>כל</b> המדבקות (מדבקה אחת חוזרת)</label>' +
          '</div>' +

          // ── קובץ ──
          '<div class="lb-when lb-file" style="grid-column:1/-1;display:none">' +
            '<div class="lb-drop" id="lbDrop">' +
              '<i class="bi bi-file-earmark-arrow-up"></i>' +
              '<div><b>גררו לכאן קובץ</b> או <button type="button" class="btn-ghost sm" id="lbPick">בחרו קובץ</button></div>' +
              '<div class="tl-note">xlsx · csv · עד 2000 שורות</div>' +
              '<input type="file" id="lbFile" accept=".xlsx,.csv,.txt" hidden>' +
            '</div>' +
            '<div id="lbFileInfo" class="tl-note" style="margin-top:6px"></div>' +
            '<label class="cb" style="margin-top:6px"><input type="checkbox" id="lbHead" checked> לשורה הראשונה יש כותרות — לדלג עליה</label>' +
            '<div style="margin-top:6px"><button type="button" class="btn-ghost sm" id="lbSample">' +
              '<i class="bi bi-download"></i> הורדת קובץ לדוגמה</button>' +
              '<button type="button" class="btn-ghost sm" id="lbGuide2"><i class="bi bi-question-circle"></i> איך הקובץ צריך להיראות</button></div>' +
          '</div>'
        ) +

        sec('bi-palette', 'עיצוב והפקה',
          fld('גודל הכתב', '<select class="inp mb0" id="lbFontMode">' +
            '<option value="uniform" selected>אוטומטי — אחיד לכל המדבקות</option>' +
            '<option value="auto">אוטומטי — כל מדבקה למקסימום שלה</option>' +
            '<option value="fixed">קבוע</option></select>') +
          fld('גודל קבוע (px)', '<input class="inp mb0" id="lbFont" type="number" min="5" max="90" value="' + st.font + '">', 'lb-fixedfont') +
          fld('יישור', '<select class="inp mb0" id="lbAlign">' +
            '<option value="center">מרכז</option><option value="start">לימין</option>' +
            '<option value="end">לשמאל</option></select>') +
          fld('סדר מילוי', '<select class="inp mb0" id="lbDir">' +
            '<option value="rtl">מימין לשמאל (עברית)</option>' +
            '<option value="ltr">משמאל לימין</option></select>') +
          fld('ריפוד פנימי (מ״מ)', '<input class="inp mb0" id="lbPad" type="number" step="0.5" min="0" max="15" value="' + st.pad + '">') +
          fld('כמה עותקים לכל מדבקה', '<input class="inp mb0" id="lbCopies" type="number" min="1" max="200" value="1">') +
          fld('להתחיל מהמדבקה מספר', '<input class="inp mb0" id="lbStart" type="number" min="1" value="1" title="לגיליון שכבר השתמשתם בחלק ממנו — משאיר את המדבקות הראשונות ריקות">') +
          '<div class="fld" style="grid-column:1/-1"><span>&nbsp;</span><div style="display:flex;gap:12px;flex-wrap:wrap">' +
            '<label class="cb"><input type="checkbox" id="lbBold" checked> כתב מודגש</label>' +
            '<label class="cb"><input type="checkbox" id="lbWrapLines" checked title="שם ארוך יישבר לשתי שורות במקום להתכווץ לכתב זעיר"> לשבור שורה ארוכה</label>' +
            '<label class="cb"><input type="checkbox" id="lbBorder" checked> מסגרת סביב כל מדבקה</label>' +
            '<label class="cb"><input type="checkbox" id="lbCut"> סימני חיתוך במקום מסגרת</label>' +
            '<label class="cb"><input type="checkbox" id="lbLogo"> לוגו קטן על המדבקה</label>' +
          '</div></div>'
        ) +
        '</div>';
    }

    function previewHTML() {
      return '<div class="lb-side">' +
        '<div class="lb-statbar">' +
          '<div class="lb-stat" id="lbStat"></div>' +
          '<select class="inp mb0 lb-zoom" id="lbZoom" title="תצוגה בלבד — ההדפסה תמיד ב-100%">' +
            '<option value="width">התאם לרוחב</option>' +
            '<option value="page">דף שלם</option>' +
            '<option value="1">100%</option></select>' +
        '</div>' +
        '<div class="lb-warn" id="lbWarn"></div>' +
        '<p class="login-hint" style="margin:8px 0 0"><i class="bi bi-exclamation-triangle"></i> ' +
          'בחלון ההדפסה חובה לבחור <b>גודל אמיתי / 100%</b> ולא "התאם לדף", ולכבות כותרות עליונות ותחתונות — ' +
          'אחרת המדבקות יזוזו ביחס לגיליון.</p>' +
        // ⚠️ המעטפת וה-wrapper המוקטן חייבים להיות שני אלמנטים: כשהם אחד,
        // ה-scale מקטין גם את הריפוד ואת הגובה שנקבע עליו, והגיליון נחתך.
        '<div class="lb-prev"><div id="lbWrap"></div></div>' +
      '</div>';
    }

    function sec(icon, title, inner) {
      return '<div class="lb-sec"><h4><i class="bi ' + icon + '"></i> ' + esc(title) + '</h4>' +
        '<div class="lb-grid">' + inner + '</div></div>';
    }
    function fld(label, inner, cls) {
      return '<label class="fld ' + (cls || '') + '"><span>' + label + '</span>' + inner + '</label>';
    }

    // ── קריאת המצב מהטופס ────────────────────────────────────────────────
    function read() {
      st.paper = $('#lbPaper').value;
      st.orient = $('#lbOrient').value;
      st.cw = num($('#lbCw').value, 210); st.ch = num($('#lbCh').value, 297);
      st.cols = Math.max(1, Math.min(20, Math.round(num($('#lbCols').value, 3))));
      st.rows = Math.max(1, Math.min(40, Math.round(num($('#lbRows').value, 8))));
      st.sizeMode = $('#lbSize').value;
      st.lw = num($('#lbLw').value, 70); st.lh = num($('#lbLh').value, 35.875);
      st.marginMode = $('#lbMm').value;
      st.mt = num($('#lbMt').value, 0); st.mb = num($('#lbMb').value, 0);
      st.ms = num($('#lbMs').value, 0); st.me = num($('#lbMe').value, 0);
      st.gx = num($('#lbGx').value, 0); st.gy = num($('#lbGy').value, 0);
      const onTab = $('#lbSrcTabs').querySelector('.on');
      st.src = onTab ? onTab.dataset.src : 'students';
      st.cls = [].map.call($('#lbCls').querySelectorAll('input:checked'), x => Number(x.value));
      st.fields = [].map.call($('#lbFields').querySelectorAll('input:checked'), x => x.value);
      st.sort = $('#lbSort').value;
      st.shuffle = $('#lbShuffle').checked;
      st.noNick = $('#lbNick').checked;
      st.text = $('#lbText').value;
      st.repeatOne = $('#lbRepeat').checked;
      st.fileHead = $('#lbHead').checked;
      st.fontMode = $('#lbFontMode').value;
      st.font = num($('#lbFont').value, 14);
      st.align = $('#lbAlign').value;
      st.dir = $('#lbDir').value;
      st.pad = num($('#lbPad').value, 2);
      st.copies = Math.max(1, Math.min(200, Math.round(num($('#lbCopies').value, 1))));
      st.startAt = Math.max(1, Math.round(num($('#lbStart').value, 1)));
      st.bold = $('#lbBold').checked;
      st.wrapLines = $('#lbWrapLines').checked;
      st.border = $('#lbBorder').checked;
      st.cut = $('#lbCut').checked;
      st.logo = $('#lbLogo').checked;
    }

    // מציג/מסתיר את השדות שרלוונטיים רק למצב מסוים
    function sync() {
      const custom = $('#lbPaper').value === 'custom';
      ov.querySelectorAll('.lb-custom').forEach(e => e.style.display = custom ? '' : 'none');
      const exact = $('#lbSize').value === 'exact';
      ov.querySelectorAll('.lb-exact').forEach(e => e.style.display = exact ? '' : 'none');
      const mCustom = $('#lbMm').value === 'custom';
      ov.querySelectorAll('.lb-marg').forEach(e => e.style.display = mCustom ? '' : 'none');
      ov.querySelectorAll('.lb-fixedfont').forEach(e => e.style.display = $('#lbFontMode').value === 'fixed' ? '' : 'none');
      const src = st.src;
      ov.querySelector('.lb-students').style.display = src === 'students' ? '' : 'none';
      ov.querySelector('.lb-text').style.display = src === 'text' ? '' : 'none';
      ov.querySelector('.lb-file').style.display = src === 'file' ? '' : 'none';
      // "סימני חיתוך" ו"מסגרת" סותרים — סימן חיתוך נועד להחליף את הקו המלא
      if ($('#lbCut').checked) $('#lbBorder').checked = false;
    }

    // ── גיאומטריה ────────────────────────────────────────────────────────
    // מחזיר את כל המידות בפועל, כולל השארית שנשארת בשולי הדף. זו הפונקציה
    // היחידה שמחשבת מיקומים — התצוגה וההדפסה משתמשות באותה תוצאה.
    function geom() {
      const P = PAPERS[st.paper] || PAPERS.a4;
      let pw = st.paper === 'custom' ? st.cw : P.w;
      let ph = st.paper === 'custom' ? st.ch : P.h;
      if (st.orient === 'landscape') { const t = pw; pw = ph; ph = t; }

      let mt = st.mt, mb = st.mb, ms = st.ms, me = st.me;
      if (st.marginMode === 'none') { mt = mb = ms = me = 0; }
      else if (st.marginMode === 'printer') { mt = mb = ms = me = 5; }
      else if (st.marginMode === 'market') {
        const tpl = TEMPLATES.filter(t => t.id === st.tpl)[0];
        if (tpl && tpl.mt != null) { mt = mb = tpl.mt; ms = me = tpl.ms; }
        else { mt = mb = 5; ms = me = 5; }
      }

      let lw, lh;
      if (st.sizeMode === 'fill') {
        lw = (pw - ms - me - st.gx * (st.cols - 1)) / st.cols;
        lh = (ph - mt - mb - st.gy * (st.rows - 1)) / st.rows;
      } else { lw = st.lw; lh = st.lh; }

      const needW = ms + me + lw * st.cols + st.gx * (st.cols - 1);
      const needH = mt + mb + lh * st.rows + st.gy * (st.rows - 1);
      return { pw, ph, mt, mb, ms, me, lw, lh, needW, needH,
        overW: needW - pw, overH: needH - ph, per: st.cols * st.rows };
    }

    // ── התוכן: מערך של מדבקות, כל אחת מערך שורות טקסט ─────────────────────
    function items() {
      let out = [];
      if (st.src === 'students') {
        let list = students.filter(s => st.cls.indexOf(Number(s.class_id)) > -1);
        // "דב בער (דובי) מלינוביץ" → "דב בער מלינוביץ". על מדבקה הכינוי
        // גוזל שורה שלמה ומקטין את הכתב לכל הגיליון (הגודל אחיד).
        const nick = t => st.noNick ? String(t).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim() : String(t);
        const nm = s => nick((window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s.name || ''));
        const fam = s => nick(String(s.family || '').trim());
        // שם פרטי = השם המלא פחות שם המשפחה. בנתונים המיובאים `name` הוא
        // כבר שם מלא ומכיל את המשפחה, ולכן חיתוך ולא שרשור.
        const first = s => {
          const full = nick(String(s.name || '').trim()), f = fam(s);
          if (!f) return full;
          const i = full.lastIndexOf(f);
          return (i > -1 ? (full.slice(0, i) + full.slice(i + f.length)) : full).replace(/\s+/g, ' ').trim() || full;
        };
        if (st.sort === 'family') list.sort((a, b) =>
          fam(a).localeCompare(fam(b), 'he') || nm(a).localeCompare(nm(b), 'he'));
        else if (st.sort === 'name') list.sort((a, b) => nm(a).localeCompare(nm(b), 'he'));
        else if (st.sort === 'cls') list.sort((a, b) => {
          const ca = clsOf(a.class_id), cb = clsOf(b.class_id);
          return String(ca && ca.name).localeCompare(String(cb && cb.name), 'he') ||
            fam(a).localeCompare(fam(b), 'he');
        });
        out = list.map(s => {
          const c = clsOf(s.class_id);
          const map = {
            full: nm(s), first: first(s), family: fam(s),
            cls: c ? c.name : '', clsShort: c ? String(c.name).split(' - ')[0].trim() : '',
            rav: ravOf(c), tz: s.tz || '', inst: inst, year: hebYear,
          };
          return st.fields.map(k => map[k] || '').filter(x => x !== '');
        }).filter(l => l.length);
      } else if (st.src === 'text') {
        const lines = st.text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        out = lines.map(l => l.split('|').map(x => x.trim()).filter(Boolean));
        if (st.repeatOne && out.length) {
          const g = geom();
          const n = Math.max(0, g.per - (st.startAt - 1));
          out = new Array(Math.max(1, n)).fill(0).map(() => out[0].slice());
          return out;                       // "אותה מדבקה על כל הדף" — בלי עותקים/ערבוב
        }
      } else {
        let rows = st.fileRows.slice();
        if (st.fileHead) rows = rows.slice(1);
        out = rows.map(r => r.map(x => String(x == null ? '' : x).trim()))
          .map(r => {
            // עמודה בשם "עותקים"/"copies" אינה טקסט על המדבקה אלא כמות.
            const n = st.copyCol >= 0 ? Math.max(1, Math.round(num(r[st.copyCol], 1))) : 1;
            const cells = r.filter((_, i) => i !== st.copyCol).filter(x => x !== '');
            return cells.length ? { cells: cells, n: n } : null;
          }).filter(Boolean);
        const flat = [];
        out.forEach(o => { for (let i = 0; i < o.n; i++) flat.push(o.cells); });
        out = flat;
      }

      if (st.shuffle) {
        // Fisher-Yates. לא sort(()=>Math.random()-.5) — זה מטה את ההתפלגות
        // ומשאיר חלק מהרשימה כמעט בסדר המקורי.
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = out[i]; out[i] = out[j]; out[j] = t;
        }
      }
      if (st.copies > 1 && st.src !== 'file') {
        const rep = [];
        out.forEach(o => { for (let i = 0; i < st.copies; i++) rep.push(o); });
        out = rep;
      }
      return out;
    }

    // ── ציור ─────────────────────────────────────────────────────────────
    function draw() {
      read(); sync();
      const g = geom();
      const list = items();
      const blanks = st.startAt - 1;
      const total = list.length + blanks;
      const pages = Math.max(1, Math.ceil(total / g.per));
      const mm = v => (Math.round(v * 100) / 100) + 'mm';

      let html = '';
      let idx = 0;                                  // מונה מדבקות כולל הריקות
      for (let p = 0; p < pages; p++) {
        let cells = '';
        for (let r = 0; r < st.rows; r++) {
          for (let c = 0; c < st.cols; c++) {
            const top = g.mt + r * (g.lh + st.gy);
            // סדר המילוי: בעברית המדבקה הראשונה בפינה הימנית העליונה.
            const off = g.ms + c * (g.lw + st.gx);
            const side = st.dir === 'rtl' ? 'right:' + mm(off) : 'left:' + mm(off);
            const item = idx >= blanks ? list[idx - blanks] : null;
            idx++;
            if (idx > total && !st.border && !st.cut) continue;   // אחרי הסוף — לא מציירים כלום
            const empty = !item;
            const body = empty ? '' :
              (st.logo ? '<img class="lb-logo" src="img/logo.png" alt="">' : '') +
              item.map((t, i) => '<div class="lb-l' + (i === 0 ? ' lb-l1' : '') + '">' + esc(t) + '</div>').join('');
            cells += '<div class="lb-cell' + (empty ? ' lb-empty' : '') + '" style="top:' + mm(top) + ';' + side +
              ';width:' + mm(g.lw) + ';height:' + mm(g.lh) + ';padding:' + mm(st.pad) + '">' +
              '<div class="lb-in">' + body + '</div></div>';
          }
        }
        html += '<div class="lb-page al-' + st.align + (st.border ? ' bord' : '') +
          (st.cut ? ' cut' : '') + (st.bold ? ' bold' : '') + (st.wrapLines ? ' wrapl' : '') +
          '" style="width:' + mm(g.pw) + ';height:' + mm(g.ph) + '">' + cells + '</div>';
      }
      $('#lbWrap').innerHTML = html;

      // חיווי + אזהרות
      const tplV = TEMPLATES.filter(t => t.id === st.tpl)[0];
      $('#lbStat').innerHTML =
        '<b>' + (Math.round(g.lw * 10) / 10) + ' × ' + (Math.round(g.lh * 10) / 10) + ' מ״מ</b> למדבקה · ' +
        g.per + ' בדף · <b>' + list.length + '</b> מדבקות ב-<b>' + pages + '</b> ' + (pages === 1 ? 'עמוד' : 'עמודים') +
        (blanks ? ' · ' + blanks + ' ראשונות מדולגות' : '');

      const w = [];
      if (g.overW > 0.05) w.push('הרוחב חורג ב-' + (Math.round(g.overW * 10) / 10) + ' מ״מ — המדבקות בקצה ייחתכו.');
      if (g.overH > 0.05) w.push('הגובה חורג ב-' + (Math.round(g.overH * 10) / 10) + ' מ״מ — השורה התחתונה תיחתך.');
      if (!list.length) w.push('אין תוכן — בחרו שיעורים, הקלידו טקסט או טענו קובץ.');
      if (st.src === 'students' && !st.fields.length) w.push('לא נבחרה אף שורת טקסט למדבקה.');
      if (st.src === 'students' && st.fields.indexOf('rav') > -1) {
        const missing = classes.filter(c => st.cls.indexOf(Number(c.id)) > -1 && !ravOf(c));
        if (missing.length) w.push('אין שם רב לשיעורים: ' + missing.map(c => c.name).join(', ') +
          ' — השורה תצא ריקה. הוסיפו " - הרב פלוני" לשם השיעור, או שייכו מלמד בניהול הכיתות.');
      }
      if (tplV && tplV.id !== 'custom' && !tplV.verified) w.push(
        'מידות התבנית לקוחות מהמפרט המפורסם של היצרן ולא נמדדו כאן — הדפיסו דף אחד והצמידו לגיליון ריק לפני הזמנה גדולה.');
      $('#lbWarn').innerHTML = w.length
        ? w.map(x => '<div><i class="bi bi-exclamation-triangle-fill"></i> ' + esc(x) + '</div>').join('') : '';
      $('#lbWarn').style.display = w.length ? '' : 'none';

      fit(g);
      zoomFit(g);
    }

    // התצוגה בלבד: מכווצים את הגיליון כך שירוחב הזמין. ההדפסה מבטלת את
    // ה-transform לגמרי (ראה main.css), ולכן זה לא נוגע למידות האמיתיות.
    // הגובה של המעטפת נקבע ידנית — transform לא מכווץ את מקום הפריסה.
    function zoomFit(g) {
      const prev = $('#lbWrap');
      const box = prev.parentElement;
      const mode = ($('#lbZoom') || {}).value || 'width';
      const pxPerMm = 96 / 25.4;
      let z = 1;
      if (mode !== '1') {
        z = Math.min(1, (box.clientWidth - 28) / (g.pw * pxPerMm));
        // "דף שלם" — מכווץ גם לפי הגובה. ⚠️ הגובה הזמין נגזר מה-viewport
        // ולא מ-clientHeight של המעטפת: את הגובה שלה אנחנו עצמנו קובעים
        // כאן, וקריאה ממנה יוצרת לולאת התכווצות שחותכת את הדף.
        if (mode === 'page') {
          const availH = window.innerHeight * 0.64 - 30;
          z = Math.min(z, availH / (g.ph * pxPerMm));
        }
      }
      prev.style.setProperty('--lb-z', z.toFixed(4));
      // transform לא מכווץ את מקום הפריסה, ולכן קובעים את הגובה ידנית.
      // ⚠️ הגובה חייב להיקבע על **המעטפת** ולא על האלמנט המוקטן עצמו:
      // scale מקטין גם את ה-height שהוגדר עליו, והגיליון נחתך באמצע
      // (667px הפכו ל-382px על המסך והשורות התחתונות נעלמו).
      prev.style.height = '';
      box.style.height = (prev.scrollHeight * z + 28) + 'px';
    }

    // ── גודל הכתב ────────────────────────────────────────────────────────
    // ⚠️ `scrollWidth` של המעטפת **לא** תופס גלישה שמאלה ב-RTL — הגרסה
    // הראשונה עברה את הבדיקה בזמן שהשמות נחתכו בפועל על המסך. המדידה
    // האמינה היא Range על תוכן השורה עצמה, שמחזיר את הרוחב הגרפי האמיתי
    // בלי קשר לכיוון ולחיתוך.
    function fitsAt(cell, size) {
      cell.style.fontSize = size + 'px';
      const inner = cell.querySelector('.lb-in');
      if (inner.scrollHeight > inner.clientHeight + 0.5) return false;
      const lines = cell.querySelectorAll('.lb-l');
      const rg = document.createRange();
      for (let i = 0; i < lines.length; i++) {
        rg.selectNodeContents(lines[i]);
        if (rg.getBoundingClientRect().width > lines[i].clientWidth + 0.5) return false;
      }
      return true;
    }

    // חיפוש בינארי — 8 מדידות במקום סריקה לינארית של 70 גדלים
    function bestSize(cell) {
      let lo = 4, hi = 80, best = 4;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (fitsAt(cell, mid)) { best = mid; lo = mid; } else hi = mid;
      }
      return Math.max(4, Math.floor(best * 10) / 10);
    }

    function fit(g) {
      const cells = [].slice.call($('#lbWrap').querySelectorAll('.lb-cell:not(.lb-empty)'));
      if (!cells.length) return;
      if (st.fontMode === 'fixed') {
        cells.forEach(c => c.style.fontSize = st.font + 'px');
        return;
      }
      // המדידה זהה לכל מדבקות עם אותו טקסט ואותה מידה — בלי ה-cache
      // גיליון של 65 מדבקות עשה 520 מדידות פריסה והקפיא את הדפדפן.
      const cache = {};
      const key = c => c.textContent + '|' + Math.round(g.lw * 10) + 'x' + Math.round(g.lh * 10);
      const sizes = cells.map(c => {
        const k = key(c);
        if (cache[k] == null) cache[k] = bestSize(c);
        return cache[k];
      });
      // "אחיד" = הקטן מביניהם. גיליון שבו כל מדבקה בגודל אחר נראה שבור,
      // וזו ברירת המחדל הנכונה לדפוס.
      const uni = st.fontMode === 'uniform' ? Math.min.apply(null, sizes) : null;
      cells.forEach((c, i) => c.style.fontSize = (uni != null ? uni : sizes[i]) + 'px');
    }

    // ── תבנית נבחרה ──────────────────────────────────────────────────────
    function applyTpl(id) {
      const t = TEMPLATES.filter(x => x.id === id)[0];
      st.tpl = id;
      if (!t || id === 'custom') return;
      $('#lbPaper').value = t.paper || 'a4';
      $('#lbOrient').value = 'portrait';
      $('#lbCols').value = t.cols; $('#lbRows').value = t.rows;
      $('#lbGx').value = t.gx != null ? t.gx : 0;
      $('#lbGy').value = t.gy != null ? t.gy : 0;
      if (t.fill) {
        $('#lbSize').value = 'fill';
        $('#lbMm').value = 'none';
      } else {
        $('#lbSize').value = 'exact';
        $('#lbLw').value = t.lw; $('#lbLh').value = t.lh;
        $('#lbMm').value = 'market';
        $('#lbMt').value = t.mt; $('#lbMb').value = t.mt;
        $('#lbMs').value = t.ms; $('#lbMe').value = t.ms;
      }
    }

    // ── חיווט ────────────────────────────────────────────────────────────
    $('#lbTpl').addEventListener('change', () => { applyTpl($('#lbTpl').value); draw(); });
    // כל שינוי ידני בגיאומטריה מוציא אותנו מהתבנית — אחרת מצב "מקובל בשוק"
    // היה מושך שוב את המידות של התבנית ומבטל את מה שהמשתמש הזין.
    ['#lbPaper', '#lbOrient', '#lbCw', '#lbCh', '#lbCols', '#lbRows', '#lbSize',
      '#lbLw', '#lbLh', '#lbMt', '#lbMb', '#lbMs', '#lbMe', '#lbGx', '#lbGy'].forEach(s => {
      const el = $(s);
      el.addEventListener('input', () => {
        if (st.tpl !== 'custom') { st.tpl = 'custom'; $('#lbTpl').value = 'custom'; }
        draw();
      });
      el.addEventListener('change', draw);
    });
    // הטאבים מזינים את ה-select המוסתר, שנשאר מקור האמת היחיד ל-read()
    $('#lbSrcTabs').addEventListener('click', e => {
      const btn = e.target.closest('[data-src]'); if (!btn) return;
      setSrc(btn.dataset.src);
    });
    function setSrc(v) {
      $('#lbSrcTabs').querySelectorAll('[data-src]').forEach(b =>
        b.classList.toggle('on', b.dataset.src === v));
      draw();
    }
    // "ייבוא מאקסל" — קיצור מלא: עובר למקור הקובץ ופותח מיד את בורר הקבצים
    $('#lbImport').addEventListener('click', () => {
      setSrc('file');
      $('#lbFile').click();
    });

    $('#lbZoom').addEventListener('change', () => zoomFit(geom()));
    ['#lbMm', '#lbSort', '#lbFontMode', '#lbAlign', '#lbDir'].forEach(s => {
      $(s).addEventListener('change', draw);
    });
    ['#lbText', '#lbFont', '#lbPad', '#lbCopies', '#lbStart'].forEach(s => {
      $(s).addEventListener('input', draw);
    });
    ['#lbShuffle', '#lbNick', '#lbRepeat', '#lbHead', '#lbBold', '#lbWrapLines', '#lbBorder', '#lbCut', '#lbLogo'].forEach(s => {
      $(s).addEventListener('change', draw);
    });
    $('#lbCls').querySelectorAll('input').forEach(x => x.addEventListener('change', draw));
    $('#lbFields').querySelectorAll('input').forEach(x => x.addEventListener('change', draw));

    // ── קובץ ─────────────────────────────────────────────────────────────
    st.copyCol = -1;
    async function loadFile(f) {
      if (!f) return;
      try {
        const rows = await window.XlsxLite.readFile(f);
        if (!rows.length) throw new Error('הקובץ ריק');
        if (rows.length > 2001) { rows.length = 2001; window.UI.toast('הקובץ נקטע ל-2000 שורות', 'err'); }
        st.fileRows = rows; st.fileName = f.name;
        // מזהים עמודת כמות לפי הכותרת, ורק אם יש כותרות
        st.copyCol = -1;
        const head = (rows[0] || []).map(x => String(x).trim().toLowerCase());
        ['עותקים', 'כמות', 'copies', 'qty', 'quantity'].forEach(k => {
          const i = head.indexOf(k); if (i > -1 && st.copyCol < 0) st.copyCol = i;
        });
        const cols = Math.max.apply(null, rows.slice(0, 20).map(r => r.length));
        $('#lbFileInfo').innerHTML = '<i class="bi bi-check-circle-fill" style="color:var(--ok,#2e7d32)"></i> ' +
          esc(f.name) + ' · ' + rows.length + ' שורות · ' + cols + ' עמודות' +
          (st.copyCol > -1 ? ' · עמודת כמות: ' + esc(rows[0][st.copyCol]) : '');
        setSrc('file');
      } catch (e) {
        $('#lbFileInfo').innerHTML = '<i class="bi bi-x-circle-fill" style="color:var(--danger,#c62828)"></i> ' +
          esc(e.message || String(e));
      }
    }
    $('#lbPick').addEventListener('click', () => $('#lbFile').click());
    $('#lbFile').addEventListener('change', e => loadFile(e.target.files[0]));
    const drop = $('#lbDrop');
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => {
      e.preventDefault(); drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => {
      e.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));

    $('#lbSample').addEventListener('click', () => {
      const rows = [
        ['שורה 1 (גדולה)', 'שורה 2', 'שורה 3', 'עותקים'],
        ['ישראל ישראלי', 'שיעור א', 'הרב כהן', '1'],
        ['משה כהן', 'שיעור ב', 'הרב לוי', '2'],
        ['ספר בראשית', 'מכינה בית התלמוד', '', '3'],
      ];
      const csv = String.fromCharCode(0xFEFF) +
        rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      a.download = 'מדבקות-לדוגמה.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    });

    const guide = () => window.UI.modal({
      title: 'איך קובץ המדבקות צריך להיראות',
      bodyHTML:
        '<div class="lb-guide">' +
        '<p><b>כל שורה בקובץ = מדבקה אחת. כל עמודה = שורת טקסט בתוך המדבקה,</b> ' +
        'לפי הסדר: עמודה A היא השורה הראשונה (הגדולה והמודגשת), B מתחתיה וכן הלאה.</p>' +
        '<table class="tbl lb-demo"><thead><tr><th></th><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead><tbody>' +
        '<tr><td>1</td><td>שורה 1 (גדולה)</td><td>שורה 2</td><td>שורה 3</td><td>עותקים</td></tr>' +
        '<tr><td>2</td><td>ישראל ישראלי</td><td>שיעור א</td><td>הרב כהן</td><td>1</td></tr>' +
        '<tr><td>3</td><td>משה כהן</td><td>שיעור ב</td><td>הרב לוי</td><td>2</td></tr>' +
        '</tbody></table>' +
        '<ul>' +
        '<li><b>שורת כותרות</b> — לא חובה. אם יש, השאירו מסומן "לשורה הראשונה יש כותרות" והיא תדולג.</li>' +
        '<li><b>עמודת כמות</b> — עמודה שכותרתה <code>עותקים</code> / <code>כמות</code> / <code>copies</code> ' +
        'לא מודפסת אלא קובעת כמה פעמים המדבקה תחזור. בלי כותרות אין זיהוי כזה, וכל העמודות יודפסו.</li>' +
        '<li><b>תא ריק</b> מדלג על השורה — אין שורה ריקה באמצע המדבקה.</li>' +
        '<li><b>כמה עמודות?</b> כמה שתרצו, אבל 2–3 שורות זה מה שנכנס יפה במדבקה סטנדרטית. ' +
        'ככל שיש יותר שורות, הכתב האוטומטי קטן יותר.</li>' +
        '<li><b>פורמט:</b> <code>.xlsx</code> (אקסל 2007 ומעלה) או <code>.csv</code> בקידוד UTF-8. ' +
        '<code>.xls</code> הישן <b>אינו נתמך</b> — פתחו באקסל ושמרו בשם עם סוג "חוברת עבודה של Excel".</li>' +
        '<li><b>נקרא רק הגיליון הראשון</b> בחוברת, ועד 2000 שורות.</li>' +
        '<li><b>נוסחאות</b> נקראות לפי הערך המחושב שאקסל שמר. <b>תאריכים</b> עלולים לצאת כמספר סידורי — ' +
        'אם חשוב שיופיעו כתאריך, עצבו את העמודה כ<b>טקסט</b> באקסל לפני השמירה.</li>' +
        '<li>הקובץ נקרא <b>בדפדפן בלבד</b> ולא נשלח לשום שרת.</li>' +
        '</ul></div>',
      cancelLabel: 'סגירה',
    });
    $('#lbGuide').addEventListener('click', guide);
    $('#lbGuide2').addEventListener('click', guide);

    // ── הדפסה ────────────────────────────────────────────────────────────
    $('#lbPrint').addEventListener('click', () => {
      const g = geom();
      let sty = document.getElementById('lbPageStyle');
      if (!sty) { sty = document.createElement('style'); sty.id = 'lbPageStyle'; document.head.appendChild(sty); }
      // margin:0 — השוליים כבר בתוך הגיליון עצמו. שוליים של @page היו
      // מוסיפים עליהם ומזיזים כל מדבקה ביחס לגיליון הפיזי.
      sty.textContent = '@page { size: ' + (Math.round(g.pw * 100) / 100) + 'mm ' +
        (Math.round(g.ph * 100) / 100) + 'mm; margin: 0; }';
      document.body.classList.add('printing-labels');
      const done = () => document.body.classList.remove('printing-labels');
      window.addEventListener('afterprint', done, { once: true });
      setTimeout(done, 8000);
      window.print();
    });

    if (window.cv3Pdf) window.cv3Pdf.wire($('#lbPdf'),
      () => $('#lbWrap'), () => 'מדבקות',
      () => {
        const g = geom();
        return { orientation: g.pw > g.ph ? 'landscape' : 'portrait',
                 paper: (g.pw > 250 || g.ph > 350) ? 'a3' : 'a4', margin: 0, scale: 2 };
      });

    applyTpl(st.tpl);
    $('#lbTpl').value = st.tpl;
    draw();
    return { close: close };
  }

  window.cv3Labels = { open: open };
})();
