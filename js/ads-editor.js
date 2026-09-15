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
    return fetch('data/ads-templates.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.templates = d.templates || [];
        var sel = $('#aeTpl');
        sel.innerHTML = '';
        state.templates.forEach(function (t) {
          var o = document.createElement('option');
          o.value = t.id; o.textContent = t.name;
          sel.appendChild(o);
        });
      })
      .catch(function (e) { hint('שגיאה בטעינת תבניות: ' + e.message, 'err'); });
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

    // הצג/הסתר שדות טקסט וצורה
    var isText = el.type === 'text';
    var isShape = el.type === 'shape';
    $$('.ae-fld-text', panel).forEach(function (f) { f.hidden = !isText; });
    $$('.ae-fld-shape', panel).forEach(function (f) { f.hidden = !isShape; });

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
  function beginTextEdit(elNode) {
    var id = elNode.dataset.id;
    var el = state.elements.find(function (x) { return x.id === id; });
    if (!el || el.type !== 'text') return;
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

    // עריכת טקסט בלחיצה כפולה (עכבר) — בנוסף ל-long-press
    cv.addEventListener('dblclick', function (e) {
      var elNode = e.target.closest('.ae-el.text');
      if (elNode) beginTextEdit(elNode);
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

    // קיצורי מקלדת
    document.addEventListener('keydown', function (e) {
      if ($('#adsSec').hidden) return;
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
    });
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
    var subj = $('#aeMailSubj').value.trim() || 'מודעה מהמניין';
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

    // סקייל מחדש בשינוי גודל חלון
    window.addEventListener('resize', function () {
      if (!$('#adsSec').hidden) resizeCanvas();
    });
  }

  /* ── אתחול ═════════════════════════════════════════════════ */
  function init() {
    if (state.inited) return;
    state.inited = true;
    bind();
    initInteraction();

    var restored = loadDraft();
    loadTemplates().then(function () {
      if (!restored) {
        applyTemplate('letterhead');  // ברירת מחדל = מודעת התרמה
      } else {
        resizeCanvas();
        render();
        pushHistory();
        hint('שוחזר טיוטה מקומית. בחר תבנית מהתפריט אם רוצים להתחיל מחדש.', 'ok');
      }
    });
  }

  // הפעל כשה-panel של המודעות נחשף
  function watchPanel() {
    var sec = $('#adsSec');
    if (!sec) return;
    var mo = new MutationObserver(function () {
      if (!sec.hidden && !state.inited) {
        // המתן טיפה ל-CSS ולפריסה
        setTimeout(init, 30);
      } else if (!sec.hidden) {
        setTimeout(resizeCanvas, 30);
      }
    });
    mo.observe(sec, { attributes: true, attributeFilter: ['hidden'] });
    // אם כבר מוצג (אחרי טעינה + sessionStorage)
    if (!sec.hidden) setTimeout(init, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchPanel);
  } else {
    watchPanel();
  }
})();
