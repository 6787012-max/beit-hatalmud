// picker.js — בורר תלמיד חכם (combobox): סינון כיתה + חיפוש חי עם רשימת תוצאות נפתחת + בחירה בקליק/מקלדת.
// משותף לכל הקטגוריות/המודולים כדי שהחוויה תהיה אחידה.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function load() {
    const studs = window.cv3Students ? await window.cv3Students.getStudents() : [];
    const classes = window.cv3Students ? await window.cv3Students.getClasses() : [];
    const has = new Set(studs.map(s => s.class_id));          // רק כיתות שיש בהן תלמידים מורשים
    return { studs, classes: classes.filter(c => has.has(c.id)) };
  }
  const clsName = (classes, id) => { const c = classes.find(x => x.id == id); return c ? c.name : ''; };

  // HTML: כיתה (סינון) · שדה חיפוש עם רשימת תוצאות. prefix ייחודי לכל בורר בעמוד.
  async function html(prefix, opts) {
    opts = opts || {};
    const { classes } = await load();
    const clsOpts = classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    return '<div class="stu-pick" data-pick="' + esc(prefix) + '" data-value="">' +
      '<select class="inp mb0 pk-class"><option value="">כל הכיתות</option>' + clsOpts + '</select>' +
      '<div class="pk-combo">' +
        '<input class="inp mb0 pk-search" placeholder="' + esc(opts.placeholder || '🔍 חיפוש תלמיד — הקלד שם…') + '" autocomplete="off">' +
        '<div class="pk-results" hidden></div>' +
      '</div></div>';
  }

  // חיווט: מציג רשימת תוצאות חיה בזמן הקלדה; קליק/Enter בוחר. מחזיר API.
  function wire(root, prefix, onChange) {
    const box = root.querySelector('.stu-pick[data-pick="' + prefix + '"]');
    if (!box) return { value: () => '', set: () => {}, reset: () => {}, focus: () => {}, classValue: () => '' };
    const clsSel = box.querySelector('.pk-class');
    const search = box.querySelector('.pk-search');
    const results = box.querySelector('.pk-results');
    let studs = [], classes = [], current = [], active = -1;

    async function ensure() { if (!studs.length) { const d = await load(); studs = d.studs; classes = d.classes; } }
    const setVal = (id, name) => { box.dataset.value = id == null ? '' : String(id); if (name != null) search.value = name; if (onChange) onChange(box.dataset.value); };
    function filtered() {
      const cid = clsSel.value, q = (search.value || '').trim();
      return studs.filter(s => (!cid || String(s.class_id) === cid) && (!q || (s.name || '').includes(q)));
    }
    function render() {
      current = filtered().slice(0, 40); active = -1;
      if (!current.length) { results.innerHTML = '<div class="pk-empty">לא נמצאו תלמידים</div>'; results.hidden = false; return; }
      results.innerHTML = current.map((s, i) =>
        '<div class="pk-res-item" data-i="' + i + '"><span>' + esc(s.name) + '</span>' +
        (s.class_id ? '<small>' + esc(clsName(classes, s.class_id)) + '</small>' : '') + '</div>').join('');
      results.hidden = false;
      results.querySelectorAll('.pk-res-item').forEach(el => el.addEventListener('mousedown', e => {
        e.preventDefault(); const s = current[Number(el.dataset.i)]; setVal(s.id, s.name); hide();
      }));
    }
    function hide() { results.hidden = true; active = -1; }
    function highlight() { results.querySelectorAll('.pk-res-item').forEach((el, i) => { el.classList.toggle('active', i === active); if (i === active) el.scrollIntoView({ block: 'nearest' }); }); }

    search.addEventListener('focus', async () => { await ensure(); render(); });
    search.addEventListener('input', async () => { box.dataset.value = ''; if (onChange) onChange(''); await ensure(); render(); });
    search.addEventListener('blur', () => setTimeout(hide, 160));
    search.addEventListener('keydown', e => {
      if (results.hidden || !current.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, current.length - 1); highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
      else if (e.key === 'Enter') { e.preventDefault(); const s = current[active >= 0 ? active : 0]; if (s) { setVal(s.id, s.name); hide(); } }
      else if (e.key === 'Escape') { hide(); }
    });
    clsSel.addEventListener('change', async () => { box.dataset.value = ''; search.value = ''; if (onChange) onChange(''); await ensure(); if (document.activeElement === search) render(); });
    ensure();

    return {
      value: () => box.dataset.value || '',
      set: id => { const s = studs.find(x => String(x.id) === String(id)); setVal(id, s ? s.name : ''); },
      reset: () => { box.dataset.value = ''; clsSel.value = ''; search.value = ''; hide(); },
      focus: () => search.focus(),
      classValue: () => clsSel.value,
    };
  }

  window.cv3Picker = { html, wire };
})();
