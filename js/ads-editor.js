/* admin-ads.js — עורך מודעות WYSIWYG לפאנל הניהול של מניין הצעירים.
 *
 * מודל נתונים:
 *   canvas: { w, h, bg }
 *   elements: [{ id, type: 'text'|'image', x,y,w,h, rotation,
 *                text?, font?, size?, weight?, color?, align?, line?,
 *                src? }]
 *   כל הקואורדינטות בפיקסלים של הקנבס הטבעי (למשל 1240x1754 עבור A4@300dpi).
 *
 * ייצוא PNG: רינדור נטיב לקנבס. ייצוא PDF: jsPDF (vendor).
 * מייל: mailto + הורדה, המשתמש גורר את הקבצים לחלון המייל.
 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  /* ── מצב ────────────────────────────────────────────────────── */
  var state = {
    canvas: { w: 1240, h: 1754, bg: '#F6F1E5' },
    elements: [],
    selectedId: null,
    scale: 1,
    userZoom: 1,
    snap: true,
    grid: 20,
    templates: [],
    history: [],
    hIdx: -1,
    inited: false,
    isTouch: (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  };

  var STORAGE_KEY = 'bht-ads-draft-v1';

  // תוכן העורך — מוזרק ל-#page-ads ע"י mount() כשנכנסים למסך מתוך ה-SPA (במקום עמוד
  // HTML נפרד). ‎.ads-page‎ עוטף רק את הבלוק הזה (לא את body) כדי שכללי ה-CSS
  // "‎.ads-page ...‎" שב-ads-editor.css ימשיכו להתאים בלי לגעת בעיצוב שאר האפליקציה.
  var ADS_SECTION_HTML = '<div class="ads-page"><section class="adm-sec" id="adsSec" data-panel>' +
    '<div class="head" style="padding:12px 14px 6px">' +
      '<div class="eyebrow">עיצוב · WYSIWYG</div>' +
      '<h2>עורך מודעות והדפסות</h2>' +
      '<p>גורר, משנה גודל, מחליף לוגו וגופנים. תבניות מוכנות: בלאנק רשמי, הודעה, לוח שיעורים, תעודת הוקרה, ריבוע לוואטסאפ.</p>' +
    '</div>' +
    '<div class="ae">' +
      '<div class="ae-topbar">' +
        '<div class="ae-group">' +
          '<label class="ae-lbl">תבנית:</label>' +
          '<select id="aeTpl" class="ae-sel"></select>' +
          '<button type="button" class="btn btn-s small" id="aeLoadTpl">טעינה</button>' +
        '</div>' +
        '<div class="ae-group">' +
          '<button type="button" class="btn btn-s small" id="aeAddText">+ טקסט</button>' +
          '<button type="button" class="btn btn-s small" id="aeAddImg">+ תמונה/לוגו</button>' +
          '<label class="btn btn-s small" for="aeUpload" style="cursor:pointer">העלאה…</label>' +
          '<input type="file" id="aeUpload" accept="image/*" hidden>' +
          '<button type="button" class="btn btn-s small" id="aeAddRect" title="מלבן">▭</button>' +
          '<button type="button" class="btn btn-s small" id="aeAddCirc" title="עיגול">◯</button>' +
          '<button type="button" class="btn btn-s small" id="aeAddLine" title="קו">━</button>' +
          '<button type="button" class="btn btn-s small" id="aeAddTable" title="טבלה">▦ טבלה</button>' +
        '</div>' +
        '<div class="ae-group">' +
          '<label class="ae-lbl"><input type="checkbox" id="aeSnap" checked> סנאפ לגריד</label>' +
        '</div>' +
        '<div class="ae-group">' +
          '<button type="button" class="btn btn-s small" id="aeUndo" title="ביטול (Ctrl+Z)">↶</button>' +
          '<button type="button" class="btn btn-s small" id="aeRedo" title="חזרה (Ctrl+Y)">↷</button>' +
        '</div>' +
        '<div class="ae-group ae-right">' +
          '<button type="button" class="btn btn-s small" id="aeSaveTpl">שמירה כתבנית…</button>' +
          '<button type="button" class="btn btn-s small" id="aeSave">שמירה</button>' +
          '<button type="button" class="btn btn-s small" id="aeExportPng">PNG</button>' +
          '<button type="button" class="btn btn-s small" id="aeExportPdf">PDF</button>' +
          '<button type="button" class="btn btn-g small" id="aeSendMail">✉ שליחה למייל</button>' +
        '</div>' +
      '</div>' +
      '<div class="ae-work">' +
        '<div class="ae-canvas-wrap" id="aeCanvasWrap"><div class="ae-canvas" id="aeCanvas" tabindex="0"></div></div>' +
        '<aside class="ae-props" id="aeProps">' +
          '<div class="ae-props-empty">' +
            '<p><b>אין פריט נבחר.</b></p>' +
            '<p>הוסף טקסט, תמונה או צורה מהסרגל, לחץ עליו כדי לערוך. ' +
            'במחשב — גרירה עם העכבר, לחיצה כפולה לעריכת טקסט. בטלפון — לגרירה מגע רגילה, ' +
            'ללחיצה ארוכה על טקסט תיפתח עריכה.</p>' +
            '<hr>' +
            '<p><b>קיצורים (מחשב):</b></p>' +
            '<ul>' +
              '<li>Del — מחיקה</li>' +
              '<li>Ctrl+D — שכפול</li>' +
              '<li>Ctrl+Z / Y — ביטול / חזרה</li>' +
              '<li>Shift+חצים — הזזה גסה</li>' +
              '<li>Shift בזמן סיבוב — צמידה לזוויות של 15°</li>' +
            '</ul>' +
          '</div>' +
          '<div class="ae-props-panel" hidden>' +
            '<div class="ae-fld ae-fld-text" hidden><label>טקסט</label><textarea id="aePropText" rows="3"></textarea></div>' +
            '<div class="ae-fld ae-fld-text" hidden>' +
              '<label>גופן</label>' +
              '<select id="aePropFont">' +
                '<option value="Frank, serif">Frank Ruhl (סריפי קלאסי)</option>' +
                '<option value="Drug, serif">Drugulin (סריפי מודרני)</option>' +
                '<option value="Asst, sans-serif">Assistant (סאנס)</option>' +
                '<option value="Heebo, sans-serif">Heebo (סאנס עבה)</option>' +
              '</select>' +
            '</div>' +
            '<div class="ae-fld ae-fld-text ae-fld-row" hidden>' +
              '<div><label>גודל</label><input id="aePropSize" type="number" min="8" max="400" step="1"></div>' +
              '<div><label>עובי</label>' +
                '<select id="aePropWeight">' +
                  '<option value="400">רגיל</option><option value="600">חצי-מודגש</option>' +
                  '<option value="700">מודגש</option><option value="800">עבה</option><option value="900">שחור</option>' +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-text ae-fld-row" hidden>' +
              '<div><label>יישור</label>' +
                '<select id="aePropAlign"><option value="right">ימין</option><option value="center">מרכז</option><option value="left">שמאל</option></select>' +
              '</div>' +
              '<div><label>צבע</label><input id="aePropColor" type="color"></div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-text" hidden><label>ריווח שורות</label><input id="aePropLine" type="number" min="0.8" max="3" step="0.05"></div>' +
            '<div class="ae-fld ae-fld-row">' +
              '<div><label>מיקום X</label><input id="aePropX" type="number" step="1"></div>' +
              '<div><label>מיקום Y</label><input id="aePropY" type="number" step="1"></div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-row">' +
              '<div><label>רוחב</label><input id="aePropW" type="number" step="1"></div>' +
              '<div><label>גובה</label><input id="aePropH" type="number" step="1"></div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-row">' +
              '<div><label>סיבוב (°)</label><input id="aePropRot" type="number" step="1" min="-180" max="180"></div>' +
              '<div><label>שכבה</label><div class="ae-btn-row"><button type="button" class="btn btn-s small" id="aeLayerUp">↑</button><button type="button" class="btn btn-s small" id="aeLayerDown">↓</button></div></div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-row">' +
              '<div><label>שקיפות</label><input id="aePropOpacity" type="range" min="0.05" max="1" step="0.05" value="1"></div>' +
              '<div><label>הצללה</label><select id="aePropShadow"><option value="0">בלי</option><option value="1">כן</option></select></div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-shape" hidden><label>מילוי צורה</label><input id="aePropFill" type="color"></div>' +
            '<div class="ae-fld ae-fld-shape ae-fld-row" hidden>' +
              '<div><label>מסגרת (עובי)</label><input id="aePropStrokeW" type="number" min="0" max="40" step="1" value="0"></div>' +
              '<div><label>צבע מסגרת</label><input id="aePropStroke" type="color" value="#003048"></div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-shape" hidden><label>עיגול פינות (px)</label><input id="aePropRadius" type="number" min="0" max="200" step="1" value="0"></div>' +
            '<div class="ae-fld ae-fld-table ae-fld-row" hidden>' +
              '<div><label>שורות</label><input id="aePropRows" type="number" min="1" max="50" step="1" value="4"></div>' +
              '<div><label>עמודות</label><input id="aePropCols" type="number" min="1" max="20" step="1" value="3"></div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-table ae-fld-row" hidden>' +
              '<div><label>רקע כותרת</label><input id="aePropHeaderBg" type="color" value="#003048"></div>' +
              '<div><label>טקסט כותרת</label><input id="aePropHeaderColor" type="color" value="#ffffff"></div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-table ae-fld-row" hidden>' +
              '<div><label>רקע תא</label><input id="aePropCellBg" type="color" value="#ffffff"></div>' +
              '<div><label>טקסט תא</label><input id="aePropCellColor" type="color" value="#111111"></div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-table ae-fld-row" hidden>' +
              '<div><label>צבע מסגרת</label><input id="aePropBorderColor" type="color" value="#8A6A2E"></div>' +
              '<div><label>עובי מסגרת</label><input id="aePropBorderW" type="number" min="0" max="20" step="1" value="2"></div>' +
            '</div>' +
            '<div class="ae-fld ae-fld-row">' +
              '<button type="button" class="btn btn-s small" id="aeDup">שכפול</button>' +
              '<button type="button" class="btn btn-x small" id="aeDel">מחיקה</button>' +
            '</div>' +
          '</div>' +
          '<hr>' +
          '<div class="ae-fld"><label>רקע הקנבס</label><input id="aeBgColor" type="color" value="#F6F1E5"></div>' +
          '<div class="ae-fld"><label>גודל דף</label>' +
            '<select id="aePageSize">' +
              '<option value="A4">A4 · לאורך (1240×1754)</option>' +
              '<option value="A4L">A4 · לרוחב (1754×1240)</option>' +
              '<option value="A5">A5 · לאורך (874×1240)</option>' +
              '<option value="Square">ריבועי (1080×1080)</option>' +
              '<option value="Story">סטורי (1080×1920)</option>' +
            '</select>' +
          '</div>' +
        '</aside>' +
      '</div>' +
      '<p class="ae-hint" id="aeHint">מוכן. בחר תבנית או התחל דף ריק.</p>' +
    '</div>' +
    '<div class="ae-modal" id="aeMailModal" hidden>' +
      '<div class="ae-modal-box">' +
        '<h3>שליחת מודעה במייל</h3>' +
        '<label class="fld"><span>נמענים (מופרדים בפסיק)</span><input id="aeMailTo" type="text" placeholder="a@b.com, c@d.com"></label>' +
        '<label class="fld"><span>נושא</span><input id="aeMailSubj" type="text" value="מודעה ממכינה בית התלמוד"></label>' +
        '<label class="fld"><span>גוף ההודעה</span><textarea id="aeMailBody" rows="4">שלום,\nמצורפת המודעה בקבצי PNG ו-PDF.\nבברכה,\nמכינה בית התלמוד · מעלה עמוס</textarea></label>' +
        '<p class="hint">הכפתור יפתח את תוכנת המייל שלך עם הנושא והגוף מוכנים, ובמקביל יוריד את קבצי PNG ו-PDF לצירוף (גרירה לחלון המייל).</p>' +
        '<div class="ae-btn-row" style="justify-content:flex-end;margin-top:10px">' +
          '<button type="button" class="btn btn-s small" id="aeMailCancel">ביטול</button>' +
          '<button type="button" class="btn btn-g small" id="aeMailSend">פתיחת מייל + הורדה</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ae-modal" id="aeTplModal" hidden>' +
      '<div class="ae-modal-box">' +
        '<h3>שמירת תבנית</h3>' +
        '<div id="aeTplUpdateRow" hidden>' +
          '<button type="button" class="btn btn-g" id="aeTplUpdate" style="width:100%">עדכון התבנית "<span id="aeTplCurName"></span>"</button>' +
          '<p class="hint">שומר את השינויים הנוכחיים (כולל העיצוב) לתוך התבנית הזו, בלי ליצור תבנית נוספת.</p>' +
          '<hr>' +
          '<p class="hint">או — לשמור בתור תבנית חדשה ונפרדת:</p>' +
        '</div>' +
        '<label class="fld"><span>שם תבנית חדשה</span><input id="aeTplName" type="text" placeholder="לדוגמה: הזמנה לאירוע"></label>' +
        '<p class="hint">התבנית תישמר בענן ותופיע ברשימת "תבנית" בפתח הבא — לכולם, לא רק במחשב הזה.</p>' +
        '<div class="ae-btn-row" style="justify-content:space-between;margin-top:10px">' +
          '<button type="button" class="btn btn-x small" id="aeTplDelete" hidden>מחיקת התבנית הזו</button>' +
          '<div class="ae-btn-row" style="margin-inline-start:auto">' +
            '<button type="button" class="btn btn-s small" id="aeTplCancel">ביטול</button>' +
            '<button type="button" class="btn btn-g small" id="aeTplSave">שמירה כחדשה</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</section></div>';

  function snap(v) { return state.snap ? Math.round(v / state.grid) * state.grid : Math.round(v); }

  /* ── עזרים ─────────────────────────────────────────────────── */
  function newId() { return 'el-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function hint(msg, cls) {
    var el = $('#aeHint'); if (!el) return;
    el.textContent = msg || '';
    el.className = 'ae-hint' + (cls ? ' ' + cls : '');
  }

  function pushHistory() {
    var snap = clone({ canvas: state.canvas, elements: state.elements });
    state.history = state.history.slice(0, state.hIdx + 1);
    state.history.push(snap);
    if (state.history.length > 60) state.history.shift();
    state.hIdx = state.history.length - 1;
    saveDraft();
  }
  function undo() {
    if (state.hIdx <= 0) return;
    state.hIdx--;
    var s = clone(state.history[state.hIdx]);
    state.canvas = s.canvas; state.elements = s.elements;
    state.selectedId = null;
    render(); renderProps();
    hint('בוטל שינוי אחרון.');
  }
  function redo() {
    if (state.hIdx >= state.history.length - 1) return;
    state.hIdx++;
    var s = clone(state.history[state.hIdx]);
    state.canvas = s.canvas; state.elements = s.elements;
    render(); renderProps();
    hint('בוצע מחדש.');
  }

  function saveDraft() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        canvas: state.canvas, elements: state.elements, t: Date.now()
      }));
    } catch (e) { /* מצב פרטי / מלא */ }
  }
  function loadDraft() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || !d.canvas || !Array.isArray(d.elements)) return false;
      state.canvas = d.canvas; state.elements = d.elements;
      state.elements.forEach(function (e) { if (!e.id) e.id = newId(); });
      return true;
    } catch (e) { return false; }
  }

  /* ── תבניות ────────────────────────────────────────────────── */
  function loadTemplates() {
    var staticP = fetch('data/ads-templates.json', { cache: 'no-cache' }).then(function (r) { return r.json(); });
    // תבניות שהצוות שמר מתוך העורך עצמו — ads_custom_templates בסופאבייס, לא בקובץ
    // סטטי בריפו (אין לזה גישת-כתיבה מהדפדפן ב-GitHub Pages).
    var customP = window.store ? window.store.list('ads_custom_templates').catch(function () { return []; }) : Promise.resolve([]);
    return Promise.all([staticP, customP]).then(function (res) {
      var staticTpls = (res[0] && res[0].templates) || [];
      var customTpls = (res[1] || []).map(function (row) {
        return { id: 'custom-' + row.id, dbId: row.id, name: row.name, canvas: row.canvas, elements: row.elements, custom: true };
      });
      state.templates = staticTpls.concat(customTpls);
      var sel = $('#aeTpl');
      sel.innerHTML = '';
      var gStatic = document.createElement('optgroup'); gStatic.label = 'תבניות קבועות';
      staticTpls.forEach(function (t) {
        var o = document.createElement('option'); o.value = t.id; o.textContent = t.name; gStatic.appendChild(o);
      });
      sel.appendChild(gStatic);
      if (customTpls.length) {
        var gCustom = document.createElement('optgroup'); gCustom.label = 'התבניות שלנו';
        customTpls.forEach(function (t) {
          var o = document.createElement('option'); o.value = t.id; o.textContent = t.name; gCustom.appendChild(o);
        });
        sel.appendChild(gCustom);
      }
    }).catch(function (e) { hint('שגיאה בטעינת תבניות: ' + e.message, 'err'); });
  }
  function applyTemplate(id) {
    var t = state.templates.find(function (x) { return x.id === id; });
    if (!t) return;
    state.canvas = clone(t.canvas);
    state.elements = clone(t.elements).map(function (e) {
      e.id = newId();
      if (!e.rotation) e.rotation = 0;
      return e;
    });
    state.selectedId = null;
    // תבנית מותאמת-אישית (לא אחת מהקבועות) — זוכרים אותה כדי ש"שמירה
    // כתבנית" יוכל להציע "עדכון" (PATCH לאותה שורה) ולא רק "שמירה כחדשה".
    state.loadedTemplate = t.custom ? { dbId: t.dbId, name: t.name } : null;
    resizeCanvas();
    render();
    renderProps();
    pushHistory();
    hint('נטענה תבנית: ' + t.name, 'ok');
  }

  /* ── קנבס: גדלים ═════════════════════════════════════════════ */
  var PAGE_SIZES = {
    A4:     { w: 1240, h: 1754 },
    A4L:    { w: 1754, h: 1240 },
    A5:     { w: 874,  h: 1240 },
    Square: { w: 1080, h: 1080 },
    Story:  { w: 1080, h: 1920 }
  };
  function setPageSize(code) {
    var s = PAGE_SIZES[code]; if (!s) return;
    state.canvas.w = s.w; state.canvas.h = s.h;
    resizeCanvas();
    render();
    pushHistory();
  }

  function resizeCanvas() {
    var wrap = $('#aeCanvasWrap');
    var cv = $('#aeCanvas');
    cv.style.width = state.canvas.w + 'px';
    cv.style.height = state.canvas.h + 'px';
    cv.style.background = state.canvas.bg;

    // סקייל אוטומטי כדי שיתאים לחלון (משאיר שוליים 40px), כפול זום משתמש
    var wAvail = wrap.clientWidth - 48;
    var hAvail = Math.max(600, window.innerHeight - 260);
    var fit = Math.min(wAvail / state.canvas.w, hAvail / state.canvas.h, 1);
    var scale = fit * (state.userZoom || 1);
    state.scale = scale;
    cv.style.transform = 'scale(' + scale + ')';
    // גובה בפועל אחרי scale
    wrap.style.minHeight = (state.canvas.h * scale + 60) + 'px';
    var bg = $('#aeBgColor'); if (bg) bg.value = state.canvas.bg;
  }

  /* ── רינדור ═════════════════════════════════════════════════ */
  function render() {
    var cv = $('#aeCanvas');
    cv.innerHTML = '';
    state.elements.forEach(function (el) { cv.appendChild(buildElNode(el)); });
    highlightSelection();
  }

  function buildElNode(el) {
    var d = document.createElement('div');
    d.className = 'ae-el ' + el.type;
    d.dataset.id = el.id;
    d.style.left = el.x + 'px';
    d.style.top = el.y + 'px';
    d.style.width = el.w + 'px';
    d.style.height = el.h + 'px';
    if (el.rotation) d.style.transform = 'rotate(' + el.rotation + 'deg)';

    if (el.opacity != null) d.style.opacity = el.opacity;
    if (el.shadow) d.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,.35))';

    if (el.type === 'text') {
      d.style.fontFamily = el.font || 'Asst, sans-serif';
      d.style.fontSize = (el.size || 32) + 'px';
      d.style.fontWeight = el.weight || 400;
      d.style.color = el.color || '#12233F';
      d.style.textAlign = el.align || 'right';
      d.style.lineHeight = el.line || 1.3;
      if (el.italic) d.style.fontStyle = 'italic';
      if (el.underline) d.style.textDecoration = 'underline';
      var t = document.createElement('div');
      t.className = 'txt';
      t.textContent = el.text || '';
      d.appendChild(t);
    } else if (el.type === 'image') {
      var img = document.createElement('img');
      img.src = el.src || '';
      img.alt = '';
      d.appendChild(img);
    } else if (el.type === 'shape') {
      d.dataset.shape = el.shape || 'rect';
      d.style.setProperty('--shp-fill', el.fill || '#12233F');
      d.style.setProperty('--shp-stroke', el.stroke || '#000');
      d.style.setProperty('--shp-stroke-w', (el.strokeW || 0) + 'px');
      d.style.setProperty('--shp-radius', (el.radius || 0) + 'px');
      var s = document.createElement('div');
      s.className = 'shp';
      d.appendChild(s);
    } else if (el.type === 'table') {
      var tbl = document.createElement('table');
      tbl.className = 'ae-tbl';
      tbl.style.width = '100%'; tbl.style.height = '100%';
      tbl.style.borderCollapse = 'collapse';
      tbl.style.fontFamily = el.font || 'Asst, sans-serif';
      tbl.style.fontSize = (el.size || 22) + 'px';
      tbl.style.tableLayout = 'fixed';
      var bw = el.borderW || 2;
      var bc = el.borderColor || '#333';
      (el.cells || []).forEach(function (row, ri) {
        var tr = document.createElement('tr');
        row.forEach(function (val, ci) {
          var td = document.createElement('td');
          td.textContent = val || '';
          td.dataset.row = ri;
          td.dataset.col = ci;
          td.style.border = bw + 'px solid ' + bc;
          td.style.padding = '6px 8px';
          td.style.textAlign = 'center';
          td.style.verticalAlign = 'middle';
          td.style.overflow = 'hidden';
          if (ri === 0) {
            td.style.background = el.headerBg || '#003048';
            td.style.color = el.headerColor || '#fff';
            td.style.fontWeight = '800';
          } else {
            td.style.background = el.cellBg || '#fff';
            td.style.color = el.cellColor || '#111';
          }
          tr.appendChild(td);
        });
        tbl.appendChild(tr);
      });
      d.appendChild(tbl);
    }

    // ידיות שינוי גודל
    ['tl','tr','bl','br','rot'].forEach(function (pos) {
      var h = document.createElement('div');
      h.className = 'ae-hnd ' + pos;
      h.dataset.hnd = pos;
      d.appendChild(h);
    });

    return d;
  }

  function highlightSelection() {
    $$('.ae-el', $('#aeCanvas')).forEach(function (n) {
      n.classList.toggle('sel', n.dataset.id === state.selectedId);
    });
  }

  /* ── הוספה / מחיקה / שכפול ═════════════════════════════════ */
  function addText() {
    var el = {
      id: newId(), type: 'text',
      x: Math.round(state.canvas.w * .1),
      y: Math.round(state.canvas.h * .4),
      w: Math.round(state.canvas.w * .8), h: 100,
      text: 'טקסט חדש', font: 'Frank, serif',
      size: 48, weight: 700, color: '#12233F', align: 'center', line: 1.3,
      rotation: 0
    };
    state.elements.push(el);
    state.selectedId = el.id;
    render(); renderProps(); pushHistory();
    hint('נוסף טקסט. לחיצה כפולה לעריכה.');
  }

  function addImage(src) {
    var el = {
      id: newId(), type: 'image',
      x: Math.round(state.canvas.w * .3),
      y: Math.round(state.canvas.h * .3),
      w: Math.round(state.canvas.w * .4),
      h: Math.round(state.canvas.w * .4),
      src: src || 'img/logo-h.svg', rotation: 0, opacity: 1
    };
    state.elements.push(el);
    state.selectedId = el.id;
    render(); renderProps(); pushHistory();
    hint('נוספה תמונה.');
  }

  function addShape(shape) {
    var el = {
      id: newId(), type: 'shape', shape: shape || 'rect',
      x: Math.round(state.canvas.w * .25),
      y: Math.round(state.canvas.h * .35),
      w: Math.round(state.canvas.w * .5),
      h: shape === 'line' ? 8 : Math.round(state.canvas.w * .35),
      fill: shape === 'line' ? '#00000000' : '#CBA75B',
      stroke: '#12233F', strokeW: shape === 'line' ? 6 : 0, radius: 12,
      rotation: 0, opacity: 1
    };
    state.elements.push(el);
    state.selectedId = el.id;
    render(); renderProps(); pushHistory();
    hint('נוספה צורה: ' + shape);
  }

  function addTable() {
    var rows = 4, cols = 3;
    var cells = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) {
        row.push(r === 0 ? ('כותרת ' + (c + 1)) : '');
      }
      cells.push(row);
    }
    var el = {
      id: newId(), type: 'table',
      x: Math.round(state.canvas.w * .1),
      y: Math.round(state.canvas.h * .35),
      w: Math.round(state.canvas.w * .8),
      h: Math.round(state.canvas.h * .3),
      rows: rows, cols: cols, cells: cells,
      headerBg: '#003048', headerColor: '#ffffff',
      cellBg: '#ffffff', cellColor: '#111',
      borderColor: '#8A6A2E', borderW: 2,
      font: 'Asst, sans-serif', size: 22,
      rotation: 0, opacity: 1
    };
    state.elements.push(el);
    state.selectedId = el.id;
    render(); renderProps(); pushHistory();
    hint('נוספה טבלה. לחיצה כפולה על תא לעריכה.');
  }

  function resizeTable(el, newRows, newCols) {
    newRows = Math.max(1, Math.min(50, newRows|0));
    newCols = Math.max(1, Math.min(20, newCols|0));
    var cells = [];
    for (var r = 0; r < newRows; r++) {
      var row = [];
      for (var c = 0; c < newCols; c++) {
        row.push((el.cells[r] && el.cells[r][c]) != null ? el.cells[r][c] : '');
      }
      cells.push(row);
    }
    el.rows = newRows; el.cols = newCols; el.cells = cells;
  }

  function delSelected() {
    if (!state.selectedId) return;
    state.elements = state.elements.filter(function (e) { return e.id !== state.selectedId; });
    state.selectedId = null;
    render(); renderProps(); pushHistory();
  }
  function dupSelected() {
    var el = getSel(); if (!el) return;
    var c = clone(el); c.id = newId(); c.x += 30; c.y += 30;
    state.elements.push(c); state.selectedId = c.id;
    render(); renderProps(); pushHistory();
  }
  function moveLayer(dir) {
    var i = state.elements.findIndex(function (e) { return e.id === state.selectedId; });
    if (i < 0) return;
    var j = i + (dir === 'up' ? 1 : -1);
    if (j < 0 || j >= state.elements.length) return;
    var tmp = state.elements[i]; state.elements[i] = state.elements[j]; state.elements[j] = tmp;
    render(); pushHistory();
  }

  function getSel() { return state.elements.find(function (e) { return e.id === state.selectedId; }); }

  /* ── פאנל תכונות ═════════════════════════════════════════════ */
  function renderProps() {
    var empty = $('.ae-props-empty');
    var panel = $('.ae-props-panel');
    var el = getSel();
    if (!el) {
      empty.hidden = false; panel.hidden = true;
      return;
    }
    empty.hidden = true; panel.hidden = false;

    // הצג/הסתר שדות לפי סוג
    var isText = el.type === 'text';
    var isShape = el.type === 'shape';
    var isTable = el.type === 'table';
    $$('.ae-fld-text', panel).forEach(function (f) { f.hidden = !isText; });
    $$('.ae-fld-shape', panel).forEach(function (f) { f.hidden = !isShape; });
    $$('.ae-fld-table', panel).forEach(function (f) { f.hidden = !isTable; });
    if (isTable) {
      var $rows = $('#aePropRows'), $cols = $('#aePropCols');
      if ($rows) $rows.value = el.rows || 1;
      if ($cols) $cols.value = el.cols || 1;
      var $hb = $('#aePropHeaderBg'); if ($hb) $hb.value = el.headerBg || '#003048';
      var $hc = $('#aePropHeaderColor'); if ($hc) $hc.value = el.headerColor || '#ffffff';
      var $cb = $('#aePropCellBg'); if ($cb) $cb.value = el.cellBg || '#ffffff';
      var $cc = $('#aePropCellColor'); if ($cc) $cc.value = el.cellColor || '#111111';
      var $bc = $('#aePropBorderColor'); if ($bc) $bc.value = el.borderColor || '#8A6A2E';
      var $bw = $('#aePropBorderW'); if ($bw) $bw.value = el.borderW || 2;
    }

    if (isText) {
      $('#aePropText').value = el.text || '';
      $('#aePropFont').value = el.font || 'Frank, serif';
      $('#aePropSize').value = el.size || 32;
      $('#aePropWeight').value = String(el.weight || 400);
      $('#aePropAlign').value = el.align || 'right';
      $('#aePropColor').value = el.color || '#12233F';
      $('#aePropLine').value = el.line || 1.3;
    }
    if (isShape) {
      $('#aePropFill').value = el.fill || '#12233F';
      $('#aePropStroke').value = el.stroke || '#12233F';
      $('#aePropStrokeW').value = el.strokeW || 0;
      $('#aePropRadius').value = el.radius || 0;
    }
    $('#aePropX').value = Math.round(el.x);
    $('#aePropY').value = Math.round(el.y);
    $('#aePropW').value = Math.round(el.w);
    $('#aePropH').value = Math.round(el.h);
    $('#aePropRot').value = el.rotation || 0;
    $('#aePropOpacity').value = (el.opacity != null ? el.opacity : 1);
    $('#aePropShadow').value = el.shadow ? '1' : '0';
  }

  function updateSelected(patch) {
    var el = getSel(); if (!el) return;
    Object.assign(el, patch);
    // עדכן רק את הצומת המתאים (לא רינדור מלא, כדי לא לאבד פוקוס)
    var node = $('.ae-el[data-id="' + el.id + '"]', $('#aeCanvas'));
    if (node) {
      node.style.left = el.x + 'px';
      node.style.top = el.y + 'px';
      node.style.width = el.w + 'px';
      node.style.height = el.h + 'px';
      node.style.transform = el.rotation ? 'rotate(' + el.rotation + 'deg)' : '';
      if (el.type === 'text') {
        node.style.fontFamily = el.font;
        node.style.fontSize = el.size + 'px';
        node.style.fontWeight = el.weight;
        node.style.color = el.color;
        node.style.textAlign = el.align;
        node.style.lineHeight = el.line;
        var t = node.querySelector('.txt'); if (t) t.textContent = el.text || '';
      } else if (el.type === 'image') {
        var img = node.querySelector('img'); if (img && patch.src) img.src = el.src;
      }
    }
    saveDraft();
  }

  /* ── אינטראקציה: גרירה + שינוי גודל + מגע ═════════════════ */
  function beginTextEdit(elNode, cellTd) {
    var id = elNode.dataset.id;
    var el = state.elements.find(function (x) { return x.id === id; });
    if (!el) return;
    // עריכת תא בטבלה
    if (el.type === 'table' && cellTd) {
      var ri = parseInt(cellTd.dataset.row, 10);
      var ci = parseInt(cellTd.dataset.col, 10);
      cellTd.contentEditable = 'true';
      elNode.classList.add('editing');
      cellTd.focus();
      var rng2 = document.createRange(); rng2.selectNodeContents(cellTd);
      var sel2 = window.getSelection(); sel2.removeAllRanges(); sel2.addRange(rng2);
      var blur2 = function () {
        cellTd.removeEventListener('blur', blur2);
        cellTd.contentEditable = 'false';
        elNode.classList.remove('editing');
        el.cells[ri][ci] = cellTd.textContent;
        pushHistory();
      };
      cellTd.addEventListener('blur', blur2);
      return;
    }
    if (el.type !== 'text') return;
    var t = elNode.querySelector('.txt');
    t.contentEditable = 'true';
    elNode.classList.add('editing');
    t.focus();
    var rng = document.createRange(); rng.selectNodeContents(t);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
    var blur = function () {
      t.removeEventListener('blur', blur);
      t.contentEditable = 'false';
      elNode.classList.remove('editing');
      el.text = t.textContent;
      renderProps();
      pushHistory();
    };
    t.addEventListener('blur', blur);
  }

  function initInteraction() {
    var cv = $('#aeCanvas');
    var wrap = $('#aeCanvasWrap');
    var drag = null;
    var pinch = null;
    var pressTimer = null, pressStart = null;

    cv.addEventListener('pointerdown', function (e) {
      var elNode = e.target.closest('.ae-el');
      if (!elNode || elNode === cv) {
        state.selectedId = null; highlightSelection(); renderProps();
        return;
      }
      // אם כבר במצב עריכה — לתת לדפדפן להמשיך (סמן טקסט, בחירה)
      if (elNode.classList.contains('editing')) return;

      var id = elNode.dataset.id;
      state.selectedId = id;
      highlightSelection(); renderProps();

      var el = state.elements.find(function (x) { return x.id === id; });
      var hnd = e.target.dataset.hnd;
      drag = {
        mode: hnd ? (hnd === 'rot' ? 'rotate' : 'resize') : 'move',
        hnd: hnd,
        startX: e.clientX, startY: e.clientY,
        origX: el.x, origY: el.y, origW: el.w, origH: el.h, origRot: el.rotation || 0,
        moved: false
      };
      elNode.setPointerCapture(e.pointerId);
      e.preventDefault();

      // long-press = כניסה לעריכת טקסט (חלופה נגישה למגע ל-dblclick)
      if (!hnd && el.type === 'text') {
        pressStart = { x: e.clientX, y: e.clientY };
        clearTimeout(pressTimer);
        pressTimer = setTimeout(function () {
          if (drag && !drag.moved) {
            drag = null;
            beginTextEdit(elNode);
          }
        }, 500);
      }
    });

    cv.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var el = getSel(); if (!el) return;
      var dx = (e.clientX - drag.startX) / state.scale;
      var dy = (e.clientY - drag.startY) / state.scale;

      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;

      var doSnap = e.shiftKey || (state.snap && drag.moved);

      if (drag.mode === 'move') {
        var nx = drag.origX + dx, ny = drag.origY + dy;
        el.x = doSnap ? snap(nx) : Math.round(nx);
        el.y = doSnap ? snap(ny) : Math.round(ny);
      } else if (drag.mode === 'resize') {
        var nx2 = drag.origX, ny2 = drag.origY, nw = drag.origW, nh = drag.origH;
        if (drag.hnd.indexOf('r') > -1) { nw = drag.origW + dx; }
        if (drag.hnd.indexOf('l') > -1) { nw = drag.origW - dx; nx2 = drag.origX + dx; }
        if (drag.hnd.indexOf('b') > -1) { nh = drag.origH + dy; }
        if (drag.hnd.indexOf('t') > -1) { nh = drag.origH - dy; ny2 = drag.origY + dy; }
        if (nw < 20) nw = 20;
        if (nh < 20) nh = 20;
        el.x = doSnap ? snap(nx2) : Math.round(nx2);
        el.y = doSnap ? snap(ny2) : Math.round(ny2);
        el.w = doSnap ? snap(nw) : Math.round(nw);
        el.h = doSnap ? snap(nh) : Math.round(nh);
      } else if (drag.mode === 'rotate') {
        var node = $('.ae-el[data-id="' + el.id + '"]', cv);
        var r = node.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var ang = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI + 90;
        if (e.shiftKey) ang = Math.round(ang / 15) * 15;
        el.rotation = Math.round(ang);
      }
      updateSelected({ x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation });
      renderProps();
    });

    cv.addEventListener('pointerup', function () {
      clearTimeout(pressTimer); pressTimer = null;
      if (drag) {
        if (drag.moved) pushHistory();
        drag = null;
      }
    });
    cv.addEventListener('pointercancel', function () {
      clearTimeout(pressTimer); pressTimer = null; drag = null;
    });

    // עריכת טקסט/תא בלחיצה כפולה (עכבר) — בנוסף ל-long-press
    cv.addEventListener('dblclick', function (e) {
      var elNode = e.target.closest('.ae-el');
      if (!elNode) return;
      if (elNode.classList.contains('text')) { beginTextEdit(elNode); return; }
      var td = e.target.closest('td');
      if (td && elNode.contains(td)) beginTextEdit(elNode, td);
    });

    /* ── פינץ' זום של הקנבס ═══════════════════════════════════ */
    var activePointers = new Map();
    wrap.addEventListener('pointerdown', function (e) {
      activePointers.set(e.pointerId, e);
      if (activePointers.size === 2 && !e.target.closest('.ae-el')) {
        var pts = Array.from(activePointers.values());
        var d = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        pinch = { startDist: d, startZoom: state.userZoom };
      }
    });
    wrap.addEventListener('pointermove', function (e) {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, e);
      if (pinch && activePointers.size === 2) {
        var pts = Array.from(activePointers.values());
        var d = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        state.userZoom = Math.max(0.4, Math.min(3, pinch.startZoom * d / pinch.startDist));
        resizeCanvas();
      }
    });
    function endPointer(e) {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) pinch = null;
    }
    wrap.addEventListener('pointerup', endPointer);
    wrap.addEventListener('pointercancel', endPointer);
    wrap.addEventListener('pointerleave', endPointer);

    // קיצורי מקלדת — מאזין גלובלי על document. mount() קורא ל-initInteraction()
    // בכל כניסה למסך (ה-DOM נבנה מחדש בכל ניווט ב-SPA), אז מסירים את הקודם לפני
    // שמוסיפים חדש — בלי זה Ctrl+Z/Del היו מוכפלים אחרי ביקור שני במסך.
    if (state._onKeydown) document.removeEventListener('keydown', state._onKeydown);
    state._onKeydown = function (e) {
      var pg = document.getElementById('page-ads');
      if (!pg || !pg.classList.contains('active')) return;
      var tag = (e.target.tagName || '').toLowerCase();
      var editing = tag === 'input' || tag === 'textarea' || tag === 'select' ||
                    (e.target.isContentEditable);
      if (editing) return;

      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.ctrlKey && (e.key.toLowerCase() === 'y' ||
          (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); dupSelected(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedId) { e.preventDefault(); delSelected(); return; }
      }
      var el = getSel(); if (!el) return;
      var step = e.shiftKey ? 20 : 2;
      var moved = true;
      if (e.key === 'ArrowLeft')  el.x -= step;
      else if (e.key === 'ArrowRight') el.x += step;
      else if (e.key === 'ArrowUp') el.y -= step;
      else if (e.key === 'ArrowDown') el.y += step;
      else moved = false;
      if (moved) {
        e.preventDefault();
        updateSelected({ x: el.x, y: el.y });
        renderProps();
      }
    };
    document.addEventListener('keydown', state._onKeydown);
  }

  /* ── ייצוא PNG ═════════════════════════════════════════════ */
  function renderToCanvas() {
    var W = state.canvas.w, H = state.canvas.h;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = state.canvas.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.direction = 'rtl';

    // המתן לגופנים לפני ציור
    return document.fonts.ready.then(function () {
      var promises = [];
      state.elements.forEach(function (el) {
        promises.push(drawElement(ctx, el));
      });
      return Promise.all(promises).then(function () { return cv; });
    });
  }

  function drawElement(ctx, el) {
    return new Promise(function (resolve) {
      ctx.save();
      if (el.opacity != null && el.opacity < 1) ctx.globalAlpha = el.opacity;
      if (el.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,.45)';
        ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
      }
      // סיבוב סביב המרכז
      var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      if (el.rotation) {
        ctx.translate(cx, cy);
        ctx.rotate(el.rotation * Math.PI / 180);
        ctx.translate(-cx, -cy);
      }

      if (el.type === 'table') {
        var rows = el.rows || 1, cols = el.cols || 1;
        var cw = el.w / cols, ch = el.h / rows;
        var bw = el.borderW || 2, bc = el.borderColor || '#333';
        ctx.font = '700 ' + (el.size || 22) + 'px ' + (el.font || 'Asst, sans-serif');
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
        for (var r = 0; r < rows; r++) {
          for (var c = 0; c < cols; c++) {
            var cx1 = el.x + c * cw, cy1 = el.y + r * ch;
            ctx.fillStyle = r === 0 ? (el.headerBg || '#003048') : (el.cellBg || '#fff');
            ctx.fillRect(cx1, cy1, cw, ch);
            ctx.fillStyle = r === 0 ? (el.headerColor || '#fff') : (el.cellColor || '#111');
            var txt = (el.cells[r] && el.cells[r][c]) || '';
            ctx.font = (r === 0 ? '800 ' : '500 ') + (el.size || 22) + 'px ' + (el.font || 'Asst, sans-serif');
            ctx.fillText(txt, cx1 + cw / 2, cy1 + ch / 2);
            ctx.lineWidth = bw; ctx.strokeStyle = bc;
            ctx.strokeRect(cx1, cy1, cw, ch);
          }
        }
        ctx.restore(); resolve(); return;
      }

      if (el.type === 'shape') {
        var fill = el.fill || '#12233F';
        var stroke = el.stroke || '#000';
        var sw = el.strokeW || 0;
        var rad = el.radius || 0;
        if (el.shape === 'circle') {
          ctx.beginPath();
          ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
          if (fill && fill !== 'transparent' && fill !== '#00000000') { ctx.fillStyle = fill; ctx.fill(); }
          if (sw > 0) { ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.stroke(); }
        } else if (el.shape === 'line') {
          ctx.beginPath();
          ctx.moveTo(el.x, el.y + el.h / 2);
          ctx.lineTo(el.x + el.w, el.y + el.h / 2);
          ctx.lineWidth = Math.max(2, sw || 6);
          ctx.strokeStyle = stroke || fill; ctx.lineCap = 'round';
          ctx.stroke();
        } else { // rect
          if (rad > 0 && ctx.roundRect) {
            ctx.beginPath(); ctx.roundRect(el.x, el.y, el.w, el.h, rad);
            if (fill) { ctx.fillStyle = fill; ctx.fill(); }
            if (sw > 0) { ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.stroke(); }
          } else {
            if (fill) { ctx.fillStyle = fill; ctx.fillRect(el.x, el.y, el.w, el.h); }
            if (sw > 0) { ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.strokeRect(el.x, el.y, el.w, el.h); }
          }
        }
        ctx.restore(); resolve(); return;
      }

      if (el.type === 'image') {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
          // שמור יחס — כמו object-fit: contain
          var iw = img.naturalWidth, ih = img.naturalHeight;
          var s = Math.min(el.w / iw, el.h / ih);
          var dw = iw * s, dh = ih * s;
          var dx = el.x + (el.w - dw) / 2, dy = el.y + (el.h - dh) / 2;
          ctx.drawImage(img, dx, dy, dw, dh);
          ctx.restore();
          resolve();
        };
        img.onerror = function () { ctx.restore(); resolve(); };
        img.src = el.src;
      } else if (el.type === 'text') {
        var weight = el.weight || 400;
        var size = el.size || 32;
        var family = el.font || 'Asst, sans-serif';
        ctx.font = weight + ' ' + size + 'px ' + family;
        ctx.fillStyle = el.color || '#12233F';
        ctx.textAlign = el.align === 'center' ? 'center' :
                        el.align === 'left' ? 'left' : 'right';
        ctx.textBaseline = 'top';
        ctx.direction = 'rtl';
        var lineH = size * (el.line || 1.3);
        var lines = wrapLines(ctx, el.text || '', el.w - 12);
        var totalH = lines.length * lineH;
        // מרכז אנכית בתוך הקופסה
        var startY = el.y + Math.max(0, (el.h - totalH) / 2) + 4;
        var xAnchor = el.align === 'center' ? (el.x + el.w / 2) :
                      el.align === 'left' ? (el.x + 6) :
                      (el.x + el.w - 6);
        lines.forEach(function (ln, i) {
          ctx.fillText(ln, xAnchor, startY + i * lineH);
        });
        ctx.restore();
        resolve();
      } else {
        ctx.restore(); resolve();
      }
    });
  }

  function wrapLines(ctx, text, maxW) {
    var out = [];
    (text || '').split('\n').forEach(function (para) {
      var words = para.split(' ');
      var cur = '';
      words.forEach(function (w) {
        var trial = cur ? cur + ' ' + w : w;
        if (ctx.measureText(trial).width <= maxW || !cur) cur = trial;
        else { out.push(cur); cur = w; }
      });
      if (cur !== '') out.push(cur);
      if (para === '') out.push('');
    });
    return out;
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function exportPng() {
    hint('מייצא PNG…');
    return renderToCanvas().then(function (cv) {
      return new Promise(function (res) {
        cv.toBlob(function (b) {
          download(b, filename('png'));
          hint('הורד PNG.', 'ok');
          res(b);
        }, 'image/png');
      });
    });
  }

  function exportPdf() {
    hint('מייצא PDF…');
    return renderToCanvas().then(function (cv) {
      var dataUrl = cv.toDataURL('image/jpeg', 0.92);
      // גודל דף PDF במ״מ, לפי יחס A4 / כל גודל אחר
      var W = state.canvas.w, H = state.canvas.h;
      var orient = W > H ? 'l' : 'p';
      // ננרמל למ״מ: 300dpi = 25.4/300 מ״מ לפיקסל
      var mmW = W * 25.4 / 300;
      var mmH = H * 25.4 / 300;
      var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      var doc = new jsPDF({ orientation: orient, unit: 'mm', format: [mmW, mmH] });
      doc.addImage(dataUrl, 'JPEG', 0, 0, mmW, mmH);
      doc.save(filename('pdf'));
      hint('הורד PDF.', 'ok');
    });
  }

  function filename(ext) {
    var d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : n; };
    return 'moda_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.' + ext;
  }

  /* ── שליחת מייל ═════════════════════════════════════════════ */
  function openMailModal() {
    $('#aeMailModal').hidden = false;
    setTimeout(function () { $('#aeMailTo').focus(); }, 50);
  }
  function closeMailModal() { $('#aeMailModal').hidden = true; }

  function sendMail() {
    var to = $('#aeMailTo').value.trim();
    var subj = $('#aeMailSubj').value.trim() || 'מודעה ממכינה בית התלמוד';
    var body = $('#aeMailBody').value;
    if (!to) { $('#aeMailTo').focus(); return; }
    hint('מכין קבצים ופותח את תוכנת המייל…');
    // הורד PNG + PDF, ואז פתח mailto
    Promise.all([exportPng(), exportPdf()]).then(function () {
      var url = 'mailto:' + encodeURIComponent(to) +
        '?subject=' + encodeURIComponent(subj) +
        '&body=' + encodeURIComponent(body);
      window.location.href = url;
      closeMailModal();
      hint('המייל נפתח והקבצים הורדו. גרור אותם לחלון המייל.', 'ok');
    });
  }

  /* ── שמירת תבנית חדשה (בענן, ב-ads_custom_templates — משותפת לכולם,
     לא רק למחשב הזה) ═══════════════════════════════════════════ */
  function openTplModal() {
    var loaded = state.loadedTemplate;
    var row = $('#aeTplUpdateRow'), delBtn = $('#aeTplDelete');
    if (loaded) {
      row.hidden = false; delBtn.hidden = false;
      $('#aeTplCurName').textContent = loaded.name;
    } else {
      row.hidden = true; delBtn.hidden = true;
    }
    $('#aeTplModal').hidden = false;
    var inp = $('#aeTplName'); inp.value = '';
    setTimeout(function () { inp.focus(); }, 50);
  }
  function closeTplModal() { $('#aeTplModal').hidden = true; }
  function saveAsTemplate() {
    var name = $('#aeTplName').value.trim();
    if (!name) { $('#aeTplName').focus(); return; }
    if (!window.store) { hint('אין חיבור לשרת — לא ניתן לשמור תבנית כרגע.', 'err'); return; }
    var row = { name: name, canvas: clone(state.canvas), elements: clone(state.elements) };
    window.store.add('ads_custom_templates', row).then(function (r) {
      if (!r || !r.ok) { hint('שמירת התבנית נכשלה.', 'err'); return; }
      closeTplModal();
      return loadTemplates().then(function () {
        var newRow = r.data && r.data[0];
        if (newRow) { $('#aeTpl').value = 'custom-' + newRow.id; state.loadedTemplate = { dbId: newRow.id, name: name }; }
        hint('התבנית "' + name + '" נשמרה. היא תופיע ברשימת "תבנית" לכולם, גם במחשבים אחרים.', 'ok');
      });
    }).catch(function () { hint('שמירת התבנית נכשלה.', 'err'); });
  }
  // "עדכון תבנית" — כותב את הקנבס הנוכחי (כולל העיצוב) לתוך אותה שורה
  // שממנה נטענה התבנית, במקום ליצור עותק חדש.
  function updateCurrentTemplate() {
    var loaded = state.loadedTemplate; if (!loaded) return;
    if (!window.store) { hint('אין חיבור לשרת — לא ניתן לעדכן תבנית כרגע.', 'err'); return; }
    var patch = { name: loaded.name, canvas: clone(state.canvas), elements: clone(state.elements) };
    window.store.update('ads_custom_templates', loaded.dbId, patch).then(function (r) {
      if (!r || !r.ok) { hint('עדכון התבנית נכשל.', 'err'); return; }
      closeTplModal();
      return loadTemplates().then(function () {
        $('#aeTpl').value = 'custom-' + loaded.dbId;
        hint('התבנית "' + loaded.name + '" עודכנה.', 'ok');
      });
    }).catch(function () { hint('עדכון התבנית נכשל.', 'err'); });
  }
  function deleteCurrentTemplate() {
    var loaded = state.loadedTemplate; if (!loaded) return;
    if (!window.store) { hint('אין חיבור לשרת — לא ניתן למחוק תבנית כרגע.', 'err'); return; }
    if (!window.confirm('למחוק את התבנית "' + loaded.name + '"? אי אפשר לשחזר.')) return;
    window.store.remove('ads_custom_templates', loaded.dbId).then(function (r) {
      if (!r || !r.ok) { hint('מחיקת התבנית נכשלה.', 'err'); return; }
      closeTplModal();
      state.loadedTemplate = null;
      return loadTemplates().then(function () { hint('התבנית נמחקה.', 'ok'); });
    }).catch(function () { hint('מחיקת התבנית נכשלה.', 'err'); });
  }

  /* ── שמירה / פתיחה של קובץ פרויקט ═══════════════════════════ */
  function saveProject() {
    var data = { canvas: state.canvas, elements: state.elements };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    download(blob, 'moda_project_' + Date.now() + '.json');
    hint('הפרויקט נשמר לקובץ JSON.', 'ok');
  }

  /* ── תמיכה בהעלאת תמונה מהמשתמש ═════════════════════════════ */
  function handleUpload(file) {
    var reader = new FileReader();
    reader.onload = function (e) { addImage(e.target.result); };
    reader.readAsDataURL(file);
  }

  /* ── חיבור UI ═════════════════════════════════════════════ */
  function bind() {
    $('#aeLoadTpl').addEventListener('click', function () { applyTemplate($('#aeTpl').value); });
    $('#aeAddText').addEventListener('click', addText);
    $('#aeAddImg').addEventListener('click', function () { addImage(); });
    var addRect = $('#aeAddRect'); if (addRect) addRect.addEventListener('click', function () { addShape('rect'); });
    var addCirc = $('#aeAddCirc'); if (addCirc) addCirc.addEventListener('click', function () { addShape('circle'); });
    var addLine = $('#aeAddLine'); if (addLine) addLine.addEventListener('click', function () { addShape('line'); });
    var addTbl = $('#aeAddTable'); if (addTbl) addTbl.addEventListener('click', addTable);

    // שדות טבלה
    var $rows = $('#aePropRows'); if ($rows) $rows.addEventListener('change', function (e) {
      var el = getSel(); if (!el || el.type !== 'table') return;
      resizeTable(el, parseInt(e.target.value, 10) || 1, el.cols);
      render(); pushHistory();
    });
    var $cols = $('#aePropCols'); if ($cols) $cols.addEventListener('change', function (e) {
      var el = getSel(); if (!el || el.type !== 'table') return;
      resizeTable(el, el.rows, parseInt(e.target.value, 10) || 1);
      render(); pushHistory();
    });
    function tblStyleBind(sel, key, colorField) {
      var $f = $(sel); if (!$f) return;
      $f.addEventListener('input', function (e) {
        var el = getSel(); if (!el || el.type !== 'table') return;
        el[key] = colorField ? e.target.value : (parseInt(e.target.value, 10) || 0);
        render();
      });
      $f.addEventListener('change', pushHistory);
    }
    tblStyleBind('#aePropHeaderBg', 'headerBg', true);
    tblStyleBind('#aePropHeaderColor', 'headerColor', true);
    tblStyleBind('#aePropCellBg', 'cellBg', true);
    tblStyleBind('#aePropCellColor', 'cellColor', true);
    tblStyleBind('#aePropBorderColor', 'borderColor', true);
    tblStyleBind('#aePropBorderW', 'borderW', false);
    var snapChk = $('#aeSnap'); if (snapChk) {
      snapChk.checked = state.snap;
      snapChk.addEventListener('change', function (e) { state.snap = !!e.target.checked; });
    }
    $('#aeUpload').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (f) handleUpload(f);
      e.target.value = '';
    });
    $('#aeUndo').addEventListener('click', undo);
    $('#aeRedo').addEventListener('click', redo);
    $('#aeSave').addEventListener('click', saveProject);
    $('#aeExportPng').addEventListener('click', exportPng);
    $('#aeExportPdf').addEventListener('click', exportPdf);
    $('#aeSendMail').addEventListener('click', openMailModal);
    $('#aeMailCancel').addEventListener('click', closeMailModal);
    $('#aeMailSend').addEventListener('click', sendMail);
    $('#aeSaveTpl').addEventListener('click', openTplModal);
    $('#aeTplCancel').addEventListener('click', closeTplModal);
    $('#aeTplSave').addEventListener('click', saveAsTemplate);
    $('#aeTplUpdate').addEventListener('click', updateCurrentTemplate);
    $('#aeTplDelete').addEventListener('click', deleteCurrentTemplate);
    $('#aeBgColor').addEventListener('input', function (e) {
      state.canvas.bg = e.target.value;
      $('#aeCanvas').style.background = state.canvas.bg;
      saveDraft();
    });
    $('#aeBgColor').addEventListener('change', pushHistory);
    $('#aePageSize').addEventListener('change', function (e) { setPageSize(e.target.value); });

    // שדות פאנל
    $('#aePropText').addEventListener('input', function (e) { updateSelected({ text: e.target.value }); });
    $('#aePropText').addEventListener('change', pushHistory);
    $('#aePropFont').addEventListener('change', function (e) { updateSelected({ font: e.target.value }); pushHistory(); });
    $('#aePropSize').addEventListener('input', function (e) { updateSelected({ size: parseInt(e.target.value, 10) || 16 }); });
    $('#aePropSize').addEventListener('change', pushHistory);
    $('#aePropWeight').addEventListener('change', function (e) { updateSelected({ weight: parseInt(e.target.value, 10) }); pushHistory(); });
    $('#aePropAlign').addEventListener('change', function (e) { updateSelected({ align: e.target.value }); pushHistory(); });
    $('#aePropColor').addEventListener('input', function (e) { updateSelected({ color: e.target.value }); });
    $('#aePropColor').addEventListener('change', pushHistory);
    $('#aePropLine').addEventListener('input', function (e) { updateSelected({ line: parseFloat(e.target.value) || 1.3 }); });
    $('#aePropLine').addEventListener('change', pushHistory);
    ['X','Y','W','H','Rot'].forEach(function (k) {
      var input = $('#aeProp' + k);
      input.addEventListener('change', function (e) {
        var v = parseInt(e.target.value, 10) || 0;
        var key = k === 'Rot' ? 'rotation' : k.toLowerCase();
        var patch = {}; patch[key] = v;
        updateSelected(patch); pushHistory();
      });
    });
    $('#aeLayerUp').addEventListener('click', function () { moveLayer('up'); });
    $('#aeLayerDown').addEventListener('click', function () { moveLayer('down'); });
    $('#aeDup').addEventListener('click', dupSelected);
    $('#aeDel').addEventListener('click', delSelected);

    var op = $('#aePropOpacity'); if (op) {
      op.addEventListener('input', function (e) { updateSelected({ opacity: parseFloat(e.target.value) }); });
      op.addEventListener('change', pushHistory);
    }
    var sh = $('#aePropShadow'); if (sh) sh.addEventListener('change', function (e) {
      updateSelected({ shadow: e.target.value === '1' }); render(); pushHistory();
    });
    var fill = $('#aePropFill'); if (fill) {
      fill.addEventListener('input', function (e) {
        var el = getSel(); if (!el) return;
        el.fill = e.target.value;
        var node = $('.ae-el[data-id="' + el.id + '"]', $('#aeCanvas'));
        if (node) node.style.setProperty('--shp-fill', el.fill);
        saveDraft();
      });
      fill.addEventListener('change', pushHistory);
    }
    var strk = $('#aePropStroke'); if (strk) {
      strk.addEventListener('input', function (e) {
        var el = getSel(); if (!el) return;
        el.stroke = e.target.value;
        var node = $('.ae-el[data-id="' + el.id + '"]', $('#aeCanvas'));
        if (node) node.style.setProperty('--shp-stroke', el.stroke);
        saveDraft();
      });
      strk.addEventListener('change', pushHistory);
    }
    var strkW = $('#aePropStrokeW'); if (strkW) {
      strkW.addEventListener('input', function (e) {
        var el = getSel(); if (!el) return;
        el.strokeW = parseInt(e.target.value, 10) || 0;
        var node = $('.ae-el[data-id="' + el.id + '"]', $('#aeCanvas'));
        if (node) node.style.setProperty('--shp-stroke-w', el.strokeW + 'px');
        saveDraft();
      });
      strkW.addEventListener('change', pushHistory);
    }
    var rad = $('#aePropRadius'); if (rad) {
      rad.addEventListener('input', function (e) {
        var el = getSel(); if (!el) return;
        el.radius = parseInt(e.target.value, 10) || 0;
        var node = $('.ae-el[data-id="' + el.id + '"]', $('#aeCanvas'));
        if (node) node.style.setProperty('--shp-radius', el.radius + 'px');
        saveDraft();
      });
      rad.addEventListener('change', pushHistory);
    }

    /* לחיצה על כותרת פאנל התכונות במובייל = פתיחה/סגירה */
    var props = $('#aeProps');
    if (props) {
      props.addEventListener('click', function (e) {
        if (window.innerWidth > 700) return;
        var rect = props.getBoundingClientRect();
        if (e.clientY - rect.top < 44) props.classList.toggle('open');
      });
    }

    // סקייל מחדש בשינוי גודל חלון — remove+add כדי לא לערום מאזינים בכל mount
    if (state._onResize) window.removeEventListener('resize', state._onResize);
    state._onResize = function () {
      var pg = document.getElementById('page-ads');
      if (pg && pg.classList.contains('active')) resizeCanvas();
    };
    window.addEventListener('resize', state._onResize);
  }

  /* ── אתחול ═════════════════════════════════════════════════
     נקרא מ-showPage('ads') של ה-SPA (app.js) — לא עוד עמוד HTML נפרד. כל
     ניווט למסך מבצע target.innerHTML = 'טוען…' ואז קורא ל-render(id), ולכן
     ה-DOM של #adsSec נבנה מחדש בכל ביקור; bind()/initInteraction() בטוחים
     לריצה חזרה (ראו ה-remove-before-add על שני המאזינים הגלובליים למעלה).
     state.templates/canvas/elements נשארים בזיכרון בין ביקורים באותה טעינת-עמוד. */
  function mount(target) {
    target.innerHTML = ADS_SECTION_HTML;
    bind();
    initInteraction();
    if (!state.templatesLoaded) {
      var restored = loadDraft();
      loadTemplates().then(function () {
        state.templatesLoaded = true;
        if (!restored) {
          applyTemplate('letterhead');  // ברירת מחדל = בלאנק רשמי
        } else {
          resizeCanvas();
          render();
          renderProps();
          pushHistory();
          hint('שוחזר טיוטה מקומית. בחר תבנית מהתפריט אם רוצים להתחיל מחדש.', 'ok');
        }
      });
    } else {
      resizeCanvas();
      render();
      renderProps();
    }
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.ads = mount;
})();
