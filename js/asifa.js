// asifa.js — ניהול רישום הורים לאסיפת הורים (תורים של רבע שעה). מנהל/מזכירה בלבד.
// נתונים: asifa_meetings / asifa_bookings (RLS: מנהל+מזכירה). ההורים נרשמים דרך asifa.html?g=<token>.
// ⚠️ המסך לא שולח שום הודעה — רק מציג קישור ונוסח להעתקה.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hm2min = t => { const p = String(t || '0:0').split(':'); return (+p[0]) * 60 + (+p[1]); };
  const min2hm = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

  const S = { meetings: [], cur: null, students: [], classes: [], bookings: [], draft: null, endTouched: {} };

  const DEFAULT_RABBIS = [
    { name: 'הרב סורוצקין', classes: [2], start: '20:30', end: '', optional: false },
    { name: 'הרב רוקמיל', classes: [3], start: '20:30', end: '', optional: false },
    { name: 'הרב יודלוב', classes: [4], start: '20:30', end: '', optional: false },
    { name: 'הרב קרשנר', classes: [5], start: '20:30', end: '', optional: false },
    { name: 'הרב פרידלנדר', classes: [2, 4], start: '20:30', end: '', optional: true },
  ];

  const pubBase = () => location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '') + 'asifa.html';
  const linkOf = m => pubBase() + '?g=' + m.public_token;
  const className = id => { const c = S.classes.find(x => x.id === id); return c ? c.name.split(' - ')[0] : ''; };
  const phoneOf = s => (s.parent_phone || (s.reg && s.reg['נייד אב']) || s.mother_phone || (s.reg && s.reg['נייד אם']) || '');
  // שם מלא: name אם הוא כבר מסתיים בשם המשפחה, אחרת name + family (כמו asifa_full_name במסד)
  const fullName = s => {
    const n = String(s.name || '').trim(), f = String(s.family || '').trim();
    if (!f || n.slice(-f.length) === f) return n;
    return (n + ' ' + f).trim();
  };
  const stuName = id => { const s = S.students.find(x => x.id === id); return s ? fullName(s) : ('#' + id); };
  // תגית להזמנה שנרשמה לפי שם (לא מאומתת)
  const byNameTag = b => b.created_by === 'parent_name'
    ? '<span class="as-vtag">נרשם לפי שם — לאמת</span><small>' + esc(b.parent_name || '') + (b.parent_name && b.parent_phone ? ' · ' : '') +
      '<span style="direction:ltr;unicode-bidi:embed">' + esc(b.parent_phone || '') + '</span></small>'
    : '';
  const stuOf = id => S.students.find(x => x.id === id);

  function dateHe(d) {
    try {
      const dt = new Date(d + 'T12:00:00');
      const wd = dt.toLocaleDateString('he-IL', { weekday: 'long' });
      const greg = dt.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
      const heb = (window.UI && window.UI.hebDate) ? window.UI.hebDate(d) : '';
      // "יום רביעי, ח׳ בכסלו תשפ״ז (18 בנובמבר 2026)"
      return heb ? wd + ', ' + heb + ' (' + greg + ')' : wd + ', ' + greg;
    } catch (_) { return d; }
  }
  function autoEnd(r, slot) {
    // רב "לבחירה" לא פוגש את כל השיעור — ברירת מחדל 6 תורים; ותמיד עד 23:59 לכל היותר (שדה שעה)
    const n = r.optional ? 6 : S.students.filter(s => (r.classes || []).indexOf(s.class_id) >= 0).length;
    return min2hm(Math.min(1439, hm2min(r.start || '20:30') + Math.max(1, n) * slot));
  }

  async function loadAll(keepId) {
    const sb = window.sb;
    const [m, st, cl] = await Promise.all([
      sb.from('asifa_meetings').select('*').order('date', { ascending: false }).order('id', { ascending: false }),
      sb.from('students').select('id,name,family,class_id,parent_phone,mother_phone,reg,status').eq('status', 'פעיל').order('class_id').order('name'),
      sb.from('classes').select('id,name').order('id'),
    ]);
    if (m.error) throw m.error;
    S.meetings = m.data || []; S.students = st.data || []; S.classes = cl.data || [];
    const pick = keepId || (S.cur && S.cur.id);
    S.cur = S.meetings.find(x => x.id === pick) || S.meetings.find(x => !x.is_test) || S.meetings[0] || null;
    S.draft = S.cur ? JSON.parse(JSON.stringify(S.cur)) : null;
    S.endTouched = {};
    await loadBookings();
  }
  async function loadBookings() {
    S.bookings = [];
    if (!S.cur) return;
    const { data } = await window.sb.from('asifa_bookings').select('*').eq('meeting_id', S.cur.id).order('slot_time');
    S.bookings = data || [];
  }

  async function render(page) {
    const u = window.Auth && window.Auth.currentUser;
    if (!u || (u.role !== 'מנהל' && u.role !== 'מזכירה')) {
      page.innerHTML = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה</button><h2>אסיפת הורים</h2></div><div class="qr-card">המסך זמין למנהל ולמזכירה בלבד.</div>';
      return;
    }
    try { await loadAll(); } catch (e) {
      page.innerHTML = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה</button><h2>אסיפת הורים</h2></div><div class="qr-card">טעינה נכשלה. ייתכן שהמיגרציה לא רצה.</div>';
      return;
    }
    draw(page);
  }

  function draw(page) {
    const m = S.draft;
    let h = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>אסיפת הורים</h2>' +
      '<div class="head-actions"><button class="btn-ghost sm" id="as_new"><i class="bi bi-plus-lg"></i> אסיפה חדשה</button></div></div>';
    if (S.meetings.length > 1) {
      h += '<div class="qr-card"><label class="fld"><span>אסיפה</span><select class="inp mb0" id="as_pick">' +
        S.meetings.map(x => '<option value="' + x.id + '"' + (S.cur && x.id === S.cur.id ? ' selected' : '') + '>' + esc(x.title) + ' · ' + esc(x.date) + (x.is_test ? ' (בדיקה)' : '') + '</option>').join('') + '</select></label></div>';
    }
    if (!m) {
      h += '<div class="qr-card"><div class="empty-state" style="padding:20px">עוד לא הוגדרה אסיפה. לחצו על "אסיפה חדשה".</div></div>';
      page.innerHTML = h; wire(page); return;
    }
    // ----- הגדרות -----
    h += '<div class="qr-card"><h3><i class="bi bi-gear"></i> הגדרות</h3>' +
      '<div class="as-grid"><label class="fld"><span>כותרת</span><input class="inp mb0" id="as_title" value="' + esc(m.title) + '"></label>' +
      '<label class="fld"><span>תאריך</span><input type="date" class="inp mb0" id="as_date" value="' + esc(m.date) + '"></label>' +
      '<label class="fld"><span>דקות לפגישה</span><input type="number" min="5" max="120" class="inp mb0" id="as_min" value="' + m.slot_minutes + '"></label></div>' +
      '<label class="fld fld-wide"><span>טקסט קשר (מוצג להורה שהטלפון שלו לא מוכר)</span><input class="inp mb0" id="as_contact" value="' + esc(m.contact_text || '') + '" placeholder="למשל: פנו למזכירות המכינה"></label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin:10px 0;font-weight:700"><input type="checkbox" id="as_open"' + (m.reg_open ? ' checked' : '') + '> ההרשמה פתוחה להורים</label>' +
      '<div style="overflow-x:auto"><table class="as-tbl"><thead><tr><th>רב</th><th>שיעורים</th><th>התחלה</th><th>סיום</th><th>לבחירה</th><th></th></tr></thead><tbody>' +
      (m.rabbis || []).map((r, i) => '<tr data-i="' + i + '"><td><input class="inp mb0" data-f="name" value="' + esc(r.name) + '"></td>' +
        '<td>' + S.classes.map(c => '<label style="white-space:nowrap;margin-inline-end:8px"><input type="checkbox" data-f="cls" value="' + c.id + '"' + ((r.classes || []).indexOf(c.id) >= 0 ? ' checked' : '') + '> ' + esc(c.name.split(' - ')[0]) + '</label>').join('') + '</td>' +
        '<td><input type="time" class="inp mb0" data-f="start" value="' + esc(r.start) + '"></td>' +
        '<td><input type="time" class="inp mb0" data-f="end" value="' + esc(r.end) + '"></td>' +
        '<td style="text-align:center"><input type="checkbox" data-f="opt"' + (r.optional ? ' checked' : '') + '></td>' +
        '<td><button class="btn-ghost xs" data-delrav="' + i + '" title="הסר"><i class="bi bi-x-lg"></i></button></td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="det-actions" style="margin-top:10px"><button class="btn-ghost sm" id="as_addrav"><i class="bi bi-plus"></i> הוסף רב</button>' +
      '<button class="btn-ghost sm" id="as_autoend"><i class="bi bi-magic"></i> חשב שעות סיום</button>' +
      '<button class="btn-primary sm" id="as_save"><i class="bi bi-save"></i> שמור</button></div>' +
      (m.id ? '' : '<p class="login-hint">האסיפה עוד לא נשמרה.</p>') + '</div>';

    if (m.id) {
      const url = linkOf(m);
      const earliest = (m.rabbis || []).map(r => r.start).filter(Boolean).sort()[0] || '';
      const msg = 'שלום רב,\nמכינת בית התלמוד מזמינה את הורי התלמידים לאסיפת הורים ' + dateHe(m.date) +
        (earliest ? ', החל משעה ' + earliest : '') + '.\nלכל הורה פגישה של ' + m.slot_minutes + ' דקות עם הרב. ההרשמה חובה, ומי שנרשם קודם בוחר קודם.\nלהרשמה: ' + url;
      h += '<div class="qr-card"><h3><i class="bi bi-link-45deg"></i> קישור להורים</h3>' +
        '<input class="inp mb0" id="as_url" readonly value="' + esc(url) + '" style="direction:ltr;text-align:left">' +
        '<div class="det-actions" style="margin:8px 0"><button class="btn-primary sm" id="as_copy"><i class="bi bi-clipboard"></i> העתק קישור</button>' +
        '<button class="btn-ghost sm" id="as_wa"><i class="bi bi-whatsapp"></i> פתח בוואטסאפ</button></div>' +
        '<label class="fld fld-wide"><span>נוסח הודעה מוכן (לא נשלח אוטומטית)</span><textarea class="inp mb0" id="as_msg" rows="6" readonly>' + esc(msg) + '</textarea></label>' +
        '<div class="det-actions" style="margin-top:8px"><button class="btn-ghost sm" id="as_copymsg"><i class="bi bi-clipboard"></i> העתק נוסח</button></div></div>';
      h += boardHTML(m) + missingHTML(m) +
        '<div class="qr-card"><h3><i class="bi bi-printer"></i> הדפסה</h3><div class="det-actions"><button class="btn-primary sm" id="as_print"><i class="bi bi-printer"></i> דף לכל רב + דף מרוכז</button>' +
        '<button class="btn-ghost sm danger" id="as_del"><i class="bi bi-trash"></i> מחק אסיפה</button></div></div>';
    }
    h += '<style>.as-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.as-tbl{width:100%;border-collapse:collapse;font-size:.9rem}' +
      '.as-tbl th,.as-tbl td{border:1px solid var(--line);padding:5px;vertical-align:middle}.as-board td.free{color:#9aa6b1;text-align:center}' +
      '.as-board td.out{background:#eef1f4}.as-board td.bk{background:rgba(31,138,91,.10)}.as-board td.bk.byname{background:rgba(230,150,20,.16)}.as-board small{color:var(--muted);display:block}' +
      '.as-vtag{display:inline-block;margin-top:2px;font-size:.72rem;font-weight:800;background:#f2a100;color:#fff;border-radius:10px;padding:1px 7px}</style>';
    page.innerHTML = h; wire(page);
  }

  function boardHTML(m) {
    const rabbis = m.rabbis || [];
    if (!rabbis.length) return '';
    let lo = 1e9, hi = 0;
    rabbis.forEach(r => { if (r.start && r.end) { lo = Math.min(lo, hm2min(r.start)); hi = Math.max(hi, hm2min(r.end)); } });
    if (hi <= lo) return '';
    let h = '<div class="qr-card"><h3><i class="bi bi-calendar-week"></i> לוח חי <span class="tl-note">(' + S.bookings.length + ' תורים)</span>' +
      ' <button class="btn-ghost xs" id="as_refresh"><i class="bi bi-arrow-repeat"></i></button></h3><div style="overflow-x:auto"><table class="as-tbl as-board"><thead><tr><th>שעה</th>' +
      rabbis.map(r => '<th>' + esc(r.name) + '</th>').join('') + '</tr></thead><tbody>';
    for (let t = lo; t < hi; t += m.slot_minutes) {
      const hm = min2hm(t);
      h += '<tr><th>' + hm + '</th>';
      rabbis.forEach(r => {
        if (!r.start || !r.end || t < hm2min(r.start) || t + m.slot_minutes > hm2min(r.end)) { h += '<td class="out"></td>'; return; }
        const b = S.bookings.find(x => x.rav === r.name && x.slot_time === hm);
        if (b) {
          const s = stuOf(b.student_id);
          h += '<td class="bk' + (b.created_by === 'parent_name' ? ' byname' : '') + '"><b>' + esc(stuName(b.student_id)) + '</b>' +
            (b.created_by === 'parent_name' ? byNameTag(b) : '<small>' + esc(s ? phoneOf(s) : '') + (b.created_by === 'admin' ? ' · ידני' : '') + '</small>') +
            '<button class="btn-ghost xs" data-unbook="' + b.id + '"><i class="bi bi-x-lg"></i> בטל</button></td>';
        } else {
          h += '<td class="free"><button class="btn-ghost xs" data-add="' + esc(r.name) + '|' + hm + '"><i class="bi bi-plus"></i></button></td>';
        }
      });
      h += '</tr>';
    }
    return h + '</tbody></table></div></div>';
  }

  function missingHTML(m) {
    const rows = [];
    (m.rabbis || []).filter(r => !r.optional).forEach(r => {
      (r.classes || []).forEach(cid => {
        const miss = S.students.filter(s => s.class_id === cid && !S.bookings.some(b => b.student_id === s.id && b.rav === r.name));
        if (miss.length) rows.push('<div style="margin:6px 0"><b>' + esc(className(cid)) + ' · ' + esc(r.name) + '</b> (' + miss.length + ' חסרים)<br>' +
          miss.map(s => esc(fullName(s)) + ' <span style="direction:ltr;unicode-bidi:embed;color:var(--muted)">' + esc(phoneOf(s)) + '</span>').join('<br>') + '</div>');
      });
    });
    return '<div class="qr-card"><h3><i class="bi bi-person-exclamation"></i> עוד לא נרשמו</h3>' +
      (rows.length ? rows.join('') : '<div class="empty-state" style="padding:12px">כולם נרשמו.</div>') + '</div>';
  }

  function readDraft(page) {
    const m = S.draft; if (!m) return;
    m.title = page.querySelector('#as_title').value.trim();
    m.date = page.querySelector('#as_date').value;
    m.slot_minutes = parseInt(page.querySelector('#as_min').value, 10) || 15;
    m.contact_text = page.querySelector('#as_contact').value.trim();
    m.reg_open = page.querySelector('#as_open').checked;
    page.querySelectorAll('tr[data-i]').forEach(tr => {
      const r = m.rabbis[+tr.dataset.i];
      r.name = tr.querySelector('[data-f=name]').value.trim();
      r.classes = [...tr.querySelectorAll('[data-f=cls]:checked')].map(x => +x.value);
      r.start = tr.querySelector('[data-f=start]').value;
      r.end = tr.querySelector('[data-f=end]').value;
      r.optional = tr.querySelector('[data-f=opt]').checked;
    });
  }

  function wire(page) {
    const $ = s => page.querySelector(s);
    const redraw = () => draw(page);
    $('#as_new').addEventListener('click', () => {
      S.cur = null;
      S.draft = { title: 'אסיפת הורים', date: '2026-11-18', slot_minutes: 15, contact_text: 'פנו למזכירות המכינה', reg_open: true, rabbis: JSON.parse(JSON.stringify(DEFAULT_RABBIS)) };
      S.draft.rabbis.forEach(r => { r.end = autoEnd(r, 15); });
      S.bookings = []; redraw();
    });
    const pick = $('#as_pick');
    if (pick) pick.addEventListener('change', async () => { await loadAll(+pick.value); redraw(); });
    if (!S.draft) return;
    page.querySelectorAll('tr[data-i]').forEach(tr => {
      tr.querySelector('[data-f=end]').addEventListener('input', () => { S.endTouched[tr.dataset.i] = true; });
      const recalc = () => {
        readDraft(page);
        const i = +tr.dataset.i, r = S.draft.rabbis[i];
        if (!S.endTouched[i]) { r.end = autoEnd(r, S.draft.slot_minutes); tr.querySelector('[data-f=end]').value = r.end; }
      };
      tr.querySelectorAll('[data-f=cls]').forEach(c => c.addEventListener('change', recalc));
      tr.querySelector('[data-f=start]').addEventListener('change', recalc);
    });
    page.querySelectorAll('[data-delrav]').forEach(b => b.addEventListener('click', () => { readDraft(page); S.draft.rabbis.splice(+b.dataset.delrav, 1); redraw(); }));
    $('#as_addrav').addEventListener('click', () => { readDraft(page); S.draft.rabbis.push({ name: '', classes: [], start: '20:30', end: '', optional: false }); redraw(); });
    $('#as_autoend').addEventListener('click', () => { readDraft(page); S.draft.rabbis.forEach(r => { r.end = autoEnd(r, S.draft.slot_minutes); }); S.endTouched = {}; redraw(); });
    $('#as_save').addEventListener('click', async () => {
      readDraft(page);
      const m = S.draft;
      if (!m.title || !m.date) { window.UI.toast('כותרת ותאריך חובה', 'err'); return; }
      for (const r of m.rabbis) {
        if (!r.name || !r.start || !r.end || hm2min(r.end) <= hm2min(r.start) || !(r.classes || []).length) { window.UI.toast('לכל רב: שם, שיעורים, התחלה וסיום תקינים', 'err'); return; }
      }
      const row = { title: m.title, date: m.date, slot_minutes: m.slot_minutes, contact_text: m.contact_text, reg_open: m.reg_open, rabbis: m.rabbis };
      let res;
      if (m.id) res = await window.sb.from('asifa_meetings').update(row).eq('id', m.id).select().single();
      else res = await window.sb.from('asifa_meetings').insert(row).select().single();
      if (res.error) { window.UI.toast('השמירה נכשלה: ' + res.error.message, 'err'); return; }
      window.UI.toast('נשמר');
      await loadAll(res.data.id); redraw();
    });
    if (!S.draft.id) return;
    const m = S.cur;
    const copy = t => { if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => window.UI.toast('הועתק'), () => window.UI.toast(t)); else window.UI.toast(t); };
    $('#as_copy').addEventListener('click', () => copy($('#as_url').value));
    $('#as_copymsg').addEventListener('click', () => copy($('#as_msg').value));
    $('#as_wa').addEventListener('click', () => window.open('https://wa.me/?text=' + encodeURIComponent($('#as_msg').value), '_blank'));
    const rf = $('#as_refresh'); if (rf) rf.addEventListener('click', async () => { await loadBookings(); redraw(); });
    page.querySelectorAll('[data-unbook]').forEach(b => b.addEventListener('click', async () => {
      if (!(await window.UI.confirm('לבטל את התור?'))) return;
      const r = await window.sb.from('asifa_bookings').delete().eq('id', +b.dataset.unbook);
      if (r.error) { window.UI.toast('הביטול נכשל', 'err'); return; }
      await loadBookings(); redraw();
    }));
    page.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addModal(b.dataset.add.split('|'), redraw)));
    $('#as_print').addEventListener('click', () => printAll(m));
    $('#as_del').addEventListener('click', async () => {
      if (!(await window.UI.confirm('למחוק את האסיפה וכל ההזמנות שלה? אי אפשר לשחזר.'))) return;
      const r = await window.sb.from('asifa_meetings').delete().eq('id', m.id);
      if (r.error) { window.UI.toast('המחיקה נכשלה', 'err'); return; }
      await loadAll(); redraw();
    });
  }

  function addModal(arg, redraw) {
    const rav = arg[0], slot = arg[1];
    const r = (S.cur.rabbis || []).find(x => x.name === rav);
    const elig = S.students.filter(s => (r.classes || []).indexOf(s.class_id) >= 0 && !S.bookings.some(b => b.student_id === s.id && b.rav === rav));
    const mod = window.UI.modal({
      title: 'הוספת תור — ' + esc(rav) + ' · ' + esc(slot),
      bodyHTML: '<label class="fld fld-wide"><span>תלמיד</span><select class="inp mb0" id="am_stu">' +
        elig.map(s => '<option value="' + s.id + '">' + esc(s.name) + ' · ' + esc(className(s.class_id)) + '</option>').join('') + '</select></label>',
      saveLabel: 'הוסף',
      onSave: async card => {
        const sid = +card.querySelector('#am_stu').value;
        if (!sid) return false;
        const row = { meeting_id: S.cur.id, rav: rav, slot_time: slot, student_id: sid, created_by: 'admin' };
        const s = stuOf(sid); row.parent_phone = s ? phoneOf(s) : null;
        const res = await window.sb.from('asifa_bookings').insert(row);
        if (res.error) { window.UI.toast('לא נוסף: ' + (res.error.code === '23505' ? 'השעה תפוסה או שלתלמיד כבר יש תור אצל הרב' : res.error.message), 'err'); return false; }
        await loadBookings(); redraw(); return true;
      },
    });
    return mod;
  }

  function printAll(m) {
    const pageCss = '<style>@page{size:A4;margin:14mm}body{font-family:Heebo,Arial,sans-serif;direction:rtl}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 10px;color:#555}' +
      'table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #444;padding:6px 8px;text-align:right}th{background:#eee}.pb{page-break-after:always}.ph{direction:ltr;unicode-bidi:embed}</style>';
    const phoneShown = (b, s) => b.created_by === 'parent_name' ? (b.parent_phone || '') : (s ? phoneOf(s) : '');
    const noteOf = b => b.created_by === 'parent_name' ? 'נרשם לפי שם — לאמת' + (b.parent_name ? ' · ' + b.parent_name : '') : '';
    const rows = (rav, withRav) => {
      const r = (m.rabbis || []).find(x => x.name === rav);
      let out = '';
      for (let t = hm2min(r.start); t + m.slot_minutes <= hm2min(r.end); t += m.slot_minutes) {
        const hm = min2hm(t), b = S.bookings.find(x => x.rav === rav && x.slot_time === hm), s = b ? stuOf(b.student_id) : null;
        out += '<tr><td>' + hm + '</td><td>' + (withRav ? esc(rav) : '') + (b ? esc(stuName(b.student_id)) : '') + '</td><td>' + (s ? esc(className(s.class_id)) : '') + '</td><td class="ph">' + (b ? esc(phoneShown(b, s)) : '') + '</td><td>' + (b ? esc(noteOf(b)) : '') + '</td></tr>';
      }
      return out;
    };
    const head = '<tr><th>שעה</th><th>תלמיד</th><th>שיעור</th><th>טלפון הורה</th><th>הערות</th></tr>';
    let html = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>אסיפת הורים</title>' + pageCss + '</head><body>';
    (m.rabbis || []).forEach(r => {
      html += '<div class="pb"><h1>' + esc(r.name) + '</h1><h2>' + esc(m.title) + ' · ' + esc(dateHe(m.date)) + '</h2><table>' + head + rows(r.name, false) + '</table></div>';
    });
    // דף מרוכז: כל התורים התפוסים, לפי שעה
    const all = S.bookings.slice().sort((a, b) => a.slot_time.localeCompare(b.slot_time) || a.rav.localeCompare(b.rav));
    html += '<div><h1>דף מרוכז</h1><h2>' + esc(m.title) + ' · ' + esc(dateHe(m.date)) + '</h2><table><tr><th>שעה</th><th>רב</th><th>תלמיד</th><th>שיעור</th><th>טלפון הורה</th><th>הערות</th></tr>' +
      all.map(b => { const s = stuOf(b.student_id); return '<tr><td>' + esc(b.slot_time) + '</td><td>' + esc(b.rav) + '</td><td>' + esc(stuName(b.student_id)) + '</td><td>' + (s ? esc(className(s.class_id)) : '') + '</td><td class="ph">' + esc(phoneShown(b, s)) + '</td><td>' + esc(noteOf(b)) + '</td></tr>'; }).join('') +
      '</table></div></body></html>';
    const w = window.open('', '_blank');
    if (!w) { window.UI.toast('החלון נחסם — אפשרו חלונות קופצים', 'err'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 400);
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.asifa = render;
  window.cv3Asifa = { _state: S };
})();
