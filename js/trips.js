// trips.js — טיולים (2026-08-26, בקשת יוסף).
//
// טיול הוא ישות בפני עצמה: תאריך, יעד, משתתפים, קבצים (אישור טיול, אישור
// רכב, תוכנית), וטופס אישור ההורים ששייך לו.
//
// **הלב של המסך הוא דף ההדפסה.** מה שבאמת צריך כשיוצאים לטיול זה דף מרוכז
// אחד שבו לכל תלמיד: פרטים, טלפוני הורים, **המידע הרפואי מהמערכת**, ו**מה
// שההורה מילא בטופס אישור הטיול** (אלרגיות, תרופות, איש קשר לחירום). זה
// חיתוך רוחבי של ארבע טבלאות — students, medications, form_responses,
// trip_participants — ולכן הוא לא שייך לשום מסך קיים.
//
// ⚠️ הדף הזה מכיל מידע רפואי של קטינים. הוא נשלף מהטבלאות עצמן ולכן נאכף
// ב-RLS שלהן; המסך עצמו סגור למלמד (can_view_trips). אין להוסיף כאן שליפה
// שעוקפת את זה.
//
// קבצים עולים לתיקיית הדרייב של הטיול דרך ה-Edge Function `drive` עם
// ?tripId= — הדפדפן לא נוגע בגוגל.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const dmy = x => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : (x || ''); };
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : ((s && s.name) || '');
  const hebDate = iso => { try { return window.UI.hebDate(iso); } catch (_) { return ''; } };

  // תיקיית האם של קובצי הטיולים יושבת בצד-שרת (TRIPS_ROOT ב-Edge Function),
  // כדי שהלקוח לא יוכל לכוון יצירת תיקייה למקום אחר בדרייב.
  const STATUSES = ['מתוכנן', 'יצא', 'הסתיים', 'בוטל'];
  const STATUS_CLS = { 'מתוכנן': 'off', 'יצא': 'ok', 'הסתיים': 'off', 'בוטל': 'off' };

  const canManage = () => ['מנהל', 'מזכירה'].includes((window.currentUser || {}).role);
  const state = { trips: [], students: [], classes: [], forms: [], open: null };

  // ── נתונים ────────────────────────────────────────────────────────────
  async function loadAll() {
    const [trips, studs, classes, forms] = await Promise.all([
      window.store.list('trips'),
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
      window.cv3Students ? window.cv3Students.getClasses() : window.store.list('classes'),
      window.store.list('forms'),
    ]);
    state.trips = (trips || []).sort((a, b) =>
      String(b.trip_date || '').localeCompare(String(a.trip_date || '')) || b.id - a.id);
    state.students = studs || [];
    state.classes = classes || [];
    state.forms = forms || [];
  }
  const clsOf = s => { const c = state.classes.find(x => x.id == (s || {}).class_id); return c ? c.name : ''; };
  const reg = (s, k) => (s && s.reg && s.reg[k] != null) ? String(s.reg[k]) : '';

  // ── דרייב ─────────────────────────────────────────────────────────────
  function driveUrl(params) {
    const c = window.CV3 || {};
    return c.SUPABASE_URL + '/functions/v1/drive?' + new URLSearchParams(params).toString();
  }
  async function driveAuth() {
    const { data } = await window.sb.auth.getSession();
    const tok = data && data.session && data.session.access_token;
    if (!tok) throw new Error('אין סשן פעיל');
    return { Authorization: 'Bearer ' + tok, apikey: (window.CV3 || {}).SUPABASE_ANON_KEY };
  }
  // תיקיית הטיול נוצרת בעצלתיים — רק כשבאמת מעלים קובץ ראשון, כדי שלא
  // ייווצרו תיקיות ריקות לכל טיול שנרשם ובוטל.
  async function ensureFolder(trip) {
    if (trip.drive_folder) return trip.drive_folder;
    const name = (dmy(trip.trip_date) ? dmy(trip.trip_date).replace(/\//g, '-') + ' ' : '') + trip.name;
    // action=tripfolder ולא mkdir: ההרשאה לתיקיית טיול נגזרת מ-drive_folder,
    // שעוד ריק בדיוק עכשיו. הפעולה הייעודית בודקת הרשאה מול טבלת trips
    // ויוצרת תמיד תחת תיקיית האם הקבועה שבצד-שרת.
    const res = await fetch(driveUrl({ action: 'tripfolder', tripId: trip.id, name: name }), {
      method: 'POST', headers: await driveAuth(),
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'יצירת תיקיית הטיול נכשלה');
    if (!d.existed) await window.store.update('trips', trip.id, { drive_folder: d.folder.id });
    trip.drive_folder = d.folder.id;
    return trip.drive_folder;
  }

  // ── מסך ראשי ──────────────────────────────────────────────────────────
  async function render(page) {
    page.innerHTML = '<div class="page-loading"><span class="spin"><i class="bi bi-arrow-repeat"></i></span><div>טוען…</div></div>';
    await loadAll();
    if (state.open) { const t = state.trips.find(x => x.id === state.open); if (t) return detail(page, t); state.open = null; }
    list(page);
  }

  function list(page) {
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>טיולים</h2>' +
      '<div class="head-actions">' +
        (canManage() ? '<button class="btn-primary sm" id="trAdd"><i class="bi bi-plus-lg"></i> טיול חדש</button>' : '') +
      '</div></div>' +
      (state.trips.length
        ? '<div class="trip-grid">' + state.trips.map(cardHTML).join('') + '</div>'
        : '<div class="empty-state"><i class="bi bi-signpost-split"></i><div>אין טיולים עדיין' +
          (canManage() ? ' — הקש "טיול חדש"' : '') + '</div></div>');
    const a = page.querySelector('#trAdd');
    if (a) a.addEventListener('click', () => form(page, null));
    page.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      const t = state.trips.find(x => String(x.id) === b.dataset.open);
      if (t) { state.open = t.id; detail(page, t); }
    }));
  }

  function cardHTML(t) {
    const when = t.trip_date
      ? dmy(t.trip_date) + (t.end_date && t.end_date !== t.trip_date ? ' – ' + dmy(t.end_date) : '')
      : 'ללא תאריך';
    return '<button class="trip-card" data-open="' + t.id + '">' +
      '<div class="tc-top"><span class="chip ' + (STATUS_CLS[t.status] || 'off') + '">' + esc(t.status) + '</span>' +
        (t.drive_folder ? '<i class="bi bi-paperclip" title="יש קבצים"></i>' : '') + '</div>' +
      '<div class="tc-name">' + esc(t.name) + '</div>' +
      '<div class="tc-meta"><i class="bi bi-calendar3"></i> ' + esc(when) +
        (hebDate(t.trip_date) ? ' · ' + esc(hebDate(t.trip_date)) : '') + '</div>' +
      (t.destination ? '<div class="tc-meta"><i class="bi bi-geo-alt"></i> ' + esc(t.destination) + '</div>' : '') +
      '</button>';
  }

  // ── טופס טיול ─────────────────────────────────────────────────────────
  function form(page, rec) {
    const t = rec || {};
    const formOpts = state.forms.map(f => '<option value="' + f.id + '"' +
      (String(f.id) === String(t.form_id) ? ' selected' : '') + '>' + esc(f.title) + '</option>').join('');
    const stOpts = STATUSES.map(x => '<option' + ((t.status || 'מתוכנן') === x ? ' selected' : '') + '>' + x + '</option>').join('');
    window.UI.modal({
      title: rec ? 'עריכת טיול' : 'טיול חדש', saveLabel: 'שמירה',
      bodyHTML: '<div class="form-grid">' +
        '<label class="fld fld-wide"><span>שם הטיול *</span><input class="inp mb0" id="tr_name" value="' + esc(t.name || '') + '"></label>' +
        '<label class="fld"><span>תאריך</span><input class="inp mb0" id="tr_date" type="date" value="' + esc(String(t.trip_date || '').slice(0, 10)) + '"></label>' +
        '<label class="fld"><span>תאריך סיום (לטיול רב-יומי)</span><input class="inp mb0" id="tr_end" type="date" value="' + esc(String(t.end_date || '').slice(0, 10)) + '"></label>' +
        '<label class="fld"><span>יעד</span><input class="inp mb0" id="tr_dest" value="' + esc(t.destination || '') + '"></label>' +
        '<label class="fld"><span>יציאה / מקום איסוף</span><input class="inp mb0" id="tr_dep" value="' + esc(t.departure || '') + '"></label>' +
        '<label class="fld"><span>סטטוס</span><select class="inp mb0" id="tr_status">' + stOpts + '</select></label>' +
        '<label class="fld"><span>טופס אישור ההורים</span><select class="inp mb0" id="tr_form"><option value="">— ללא —</option>' + formOpts + '</select></label>' +
        '<div class="fld fld-wide"><span class="login-hint" style="margin:0">הטופס שנבחר הוא המקור לאלרגיות, לתרופות ולאיש הקשר לחירום בדף ההדפסה.</span></div>' +
        '<label class="fld fld-wide"><span>הערות</span><textarea class="inp mb0 ta-auto" id="tr_notes" rows="3">' + esc(t.notes || '') + '</textarea></label>' +
        '</div>',
      onSave: async (mel) => {
        const name = mel.querySelector('#tr_name').value.trim();
        if (!name) { window.UI.toast('שם הטיול חובה', 'err'); return false; }
        const row = {
          name: name,
          trip_date: mel.querySelector('#tr_date').value || null,
          end_date: mel.querySelector('#tr_end').value || null,
          destination: mel.querySelector('#tr_dest').value.trim() || null,
          departure: mel.querySelector('#tr_dep').value.trim() || null,
          status: mel.querySelector('#tr_status').value,
          form_id: Number(mel.querySelector('#tr_form').value) || null,
          notes: mel.querySelector('#tr_notes').value.trim() || null,
        };
        const res = rec ? await window.store.update('trips', rec.id, row) : await window.store.add('trips', row);
        if (!res || res.ok === false) { window.UI.toast('השמירה נכשלה: ' + ((res && res.error) || ''), 'err'); return false; }
        window.UI.toast(rec ? 'עודכן' : 'הטיול נוצר');
        state.open = rec ? rec.id : ((res.data && res.data[0] && res.data[0].id) || null);
        await render(page);
        return true;
      },
    });
  }

  // ── מסך הטיול ─────────────────────────────────────────────────────────
  async function detail(page, t) {
    const formName = (state.forms.find(f => f.id == t.form_id) || {}).title || '';
    page.innerHTML =
      '<div class="page-head"><button class="back" id="trBack">→ כל הטיולים</button><h2>' + esc(t.name) + '</h2>' +
      '<div class="head-actions">' +
        '<button class="btn-primary sm" id="trPrint"><i class="bi bi-printer"></i> הדפסת רשימת תלמידים</button>' +
        (canManage() ? '<button class="btn-ghost sm" id="trEdit"><i class="bi bi-pencil"></i> עריכה</button>' +
          '<button class="btn-ghost sm danger" id="trDel"><i class="bi bi-trash"></i> מחיקה</button>' : '') +
      '</div></div>' +
      '<div class="qr-card"><div class="det-grid">' +
        row('תאריך', (t.trip_date ? dmy(t.trip_date) + (t.end_date && t.end_date !== t.trip_date ? ' – ' + dmy(t.end_date) : '') : '') +
            (hebDate(t.trip_date) ? ' · ' + hebDate(t.trip_date) : '')) +
        row('יעד', t.destination) + row('יציאה', t.departure) +
        '<div class="det-row"><span class="det-lbl">סטטוס</span><span class="det-val"><span class="chip ' +
          (STATUS_CLS[t.status] || 'off') + '">' + esc(t.status) + '</span></span></div>' +
        row('טופס אישור', formName) + row('הערות', t.notes) +
      '</div></div>' +
      '<div class="qr-card"><div class="card-h-row"><h3 style="margin:0"><i class="bi bi-people"></i> משתתפים</h3>' +
        (canManage() ? '<button class="btn-ghost sm" id="trPart"><i class="bi bi-pencil"></i> בחירת משתתפים</button>' : '') +
        '</div><div id="trPartBox"><span class="tl-note">טוען…</span></div></div>' +
      '<div class="qr-card"><div class="card-h-row"><h3 style="margin:0"><i class="bi bi-paperclip"></i> קבצים</h3>' +
        (canManage() ? '<button class="btn-ghost sm" id="trUp"><i class="bi bi-upload"></i> העלאת קובץ</button>' : '') +
        '</div><div id="trFiles"><span class="tl-note">טוען…</span></div></div>';

    page.querySelector('#trBack').addEventListener('click', () => { state.open = null; list(page); });
    const e = page.querySelector('#trEdit'); if (e) e.addEventListener('click', () => form(page, t));
    const d = page.querySelector('#trDel'); if (d) d.addEventListener('click', () => removeTrip(page, t));
    const pt = page.querySelector('#trPart'); if (pt) pt.addEventListener('click', () => pickParticipants(page, t));
    const up = page.querySelector('#trUp'); if (up) up.addEventListener('click', () => uploadFile(page, t));
    page.querySelector('#trPrint').addEventListener('click', () => printSheet(t));

    drawParticipants(page, t);
    drawFiles(page, t);
  }
  const row = (l, v) => v ? '<div class="det-row"><span class="det-lbl">' + esc(l) + '</span><span class="det-val">' + esc(v) + '</span></div>' : '';

  // ── משתתפים ───────────────────────────────────────────────────────────
  async function participantsOf(tripId) {
    const all = await window.store.list('trip_participants');
    return (all || []).filter(p => String(p.trip_id) === String(tripId)).map(p => p.student_id);
  }
  // אין שורות = כל התלמידים. זו ברירת המחדל הנפוצה בטיול מוסדי, והיא חוסכת
  // 37 שורות לכל טיול.
  async function tripStudents(tripId) {
    const ids = await participantsOf(tripId);
    return ids.length ? state.students.filter(s => ids.includes(s.id)) : state.students.slice();
  }
  async function drawParticipants(page, t) {
    const ids = await participantsOf(t.id);
    const box = page.querySelector('#trPartBox'); if (!box) return;
    const list = ids.length ? state.students.filter(s => ids.includes(s.id)) : state.students;
    box.innerHTML = '<div class="count-line" style="margin-bottom:6px">' +
      (ids.length ? list.length + ' תלמידים נבחרו' : 'כל התלמידים (' + state.students.length + ') — לא הוגדרה בחירה') + '</div>' +
      '<div class="chip-list">' + list.slice(0, 60).map(s =>
        '<span class="chip off">' + esc(nm(s)) + '</span>').join('') +
      (list.length > 60 ? '<span class="tl-note">ועוד ' + (list.length - 60) + '…</span>' : '') + '</div>';
  }
  function pickParticipants(page, t) {
    participantsOf(t.id).then(ids => {
      const byCls = {};
      state.students.forEach(s => { (byCls[clsOf(s) || 'ללא שיעור'] = byCls[clsOf(s) || 'ללא שיעור'] || []).push(s); });
      const body = Object.keys(byCls).sort((a, b) => a.localeCompare(b, 'he')).map(k =>
        '<div class="fld fld-wide"><span>' + esc(k) +
        ' <button type="button" class="btn-ghost sm" data-cls="' + esc(k) + '">סמן/נקה</button></span>' +
        '<div class="cb-grid">' + byCls[k].map(s =>
          '<label class="cb"><input type="checkbox" value="' + s.id + '"' +
          (ids.includes(s.id) ? ' checked' : '') + '> ' + esc(nm(s)) + '</label>').join('') + '</div></div>').join('');
      const mm = window.UI.modal({
        title: 'משתתפי הטיול', saveLabel: 'שמירה',
        bodyHTML: '<p class="login-hint" style="margin:0 0 10px">אם לא מסמנים אף אחד — הטיול חל על <b>כל התלמידים</b>.</p>' +
          '<div style="display:flex;gap:6px;margin-bottom:10px">' +
          '<button type="button" class="btn-ghost sm" id="pAll">סמן הכל</button>' +
          '<button type="button" class="btn-ghost sm" id="pNone">נקה הכל</button></div>' +
          '<div class="form-grid">' + body + '</div>',
        onSave: async (mel) => {
          const chosen = [...mel.querySelectorAll('.cb-grid input:checked')].map(c => Number(c.value));
          // כל התלמידים מסומנים = אין הגבלה, ולכן לא שומרים שורות בכלל
          const all = chosen.length === state.students.length;
          await window.store.removeBy('trip_participants', { trip_id: t.id });
          if (!all) {
            for (const sid of chosen) await window.store.add('trip_participants', { trip_id: t.id, student_id: sid });
          }
          window.UI.toast('המשתתפים עודכנו');
          drawParticipants(page, t);
          return true;
        },
      });
      mm.el.querySelector('#pAll').addEventListener('click', () => mm.el.querySelectorAll('.cb-grid input').forEach(c => c.checked = true));
      mm.el.querySelector('#pNone').addEventListener('click', () => mm.el.querySelectorAll('.cb-grid input').forEach(c => c.checked = false));
      mm.el.querySelectorAll('[data-cls]').forEach(b => b.addEventListener('click', () => {
        const grid = b.closest('.fld').querySelector('.cb-grid');
        const on = [...grid.querySelectorAll('input')].every(c => c.checked);
        grid.querySelectorAll('input').forEach(c => c.checked = !on);
      }));
    });
  }

  // ── קבצים ─────────────────────────────────────────────────────────────
  async function drawFiles(page, t) {
    const box = page.querySelector('#trFiles'); if (!box) return;
    if (!t.drive_folder) { box.innerHTML = '<div class="tl-note">אין עדיין קבצים</div>'; return; }
    try {
      const res = await fetch(driveUrl({ action: 'list', tripId: t.id }), { method: 'POST', headers: await driveAuth() });
      const d = await res.json();
      if (!d.ok) { box.innerHTML = '<div class="tl-note">' + esc(d.error || 'טעינת הקבצים נכשלה') + '</div>'; return; }
      const files = d.files || [];
      box.innerHTML = files.length
        ? files.map(f => '<div class="tl-item"><span class="sev-dot lo"></span>' +
            '<div class="tl-main">' + esc(f.name) + '</div>' +
            '<div class="tl-meta">' + (f.size ? Math.round(f.size / 1024) + ' KB' : '') + '</div>' +
            '<button class="mini" data-dl="' + esc(f.id) + '" data-nm="' + esc(f.name) + '" title="הורדה"><i class="bi bi-download"></i></button>' +
            (canManage() ? '<button class="mini danger" data-rm="' + esc(f.id) + '" title="מחיקה"><i class="bi bi-trash"></i></button>' : '') +
            '</div>').join('')
        : '<div class="tl-note">אין עדיין קבצים</div>';
      box.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', () => downloadFile(t, b.dataset.dl, b.dataset.nm)));
      box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => deleteFile(page, t, b.dataset.rm)));
    } catch (err) { box.innerHTML = '<div class="tl-note">' + esc(err.message || 'שגיאה') + '</div>'; }
  }
  function uploadFile(page, t) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.addEventListener('change', async () => {
      const files = [...(inp.files || [])];
      if (!files.length) return;
      try {
        const folder = await ensureFolder(t);
        for (const f of files) {
          if (f.size > 20 * 1024 * 1024) { window.UI.toast(f.name + ' גדול מ-20MB', 'err'); continue; }
          window.UI.toast('מעלה ' + f.name + '…');
          const res = await fetch(driveUrl({ action: 'upload', tripId: t.id, folderId: folder, name: f.name }), {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': f.type || 'application/octet-stream' }, await driveAuth()),
            body: f,
          });
          const d = await res.json();
          if (!d.ok) { window.UI.toast(d.error || 'ההעלאה נכשלה', 'err'); return; }
        }
        window.UI.toast('הועלה');
        drawFiles(page, t);
      } catch (e) { window.UI.toast('שגיאה: ' + (e.message || e), 'err'); }
    });
    inp.click();
  }
  async function downloadFile(t, fileId, name) {
    window.UI.toast('מוריד…');
    try {
      const res = await fetch(driveUrl({ action: 'download', tripId: t.id, fileId: fileId }), {
        method: 'POST', headers: await driveAuth(),
      });
      const d = await res.json();
      if (!d.ok) { window.UI.toast(d.error || 'ההורדה נכשלה', 'err'); return; }
      // ⚠️ נטפרי חוסם גוף תגובה בינארי — הפונקציה מחזירה base64 והלקוח מרכיב Blob
      const bin = atob(d.dataB64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: d.mimeType || 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = url; a.download = d.name || name || 'file'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
    } catch (e) { window.UI.toast('שגיאה: ' + (e.message || e), 'err'); }
  }
  async function deleteFile(page, t, fileId) {
    if (!(await window.UI.confirm('למחוק את הקובץ? הוא יעבור לפח האשפה של הדרייב.'))) return;
    try {
      const res = await fetch(driveUrl({ action: 'delete', tripId: t.id, fileId: fileId }), {
        method: 'POST', headers: await driveAuth(),
      });
      const d = await res.json();
      if (!d.ok) { window.UI.toast(d.error || 'המחיקה נכשלה', 'err'); return; }
      window.UI.toast('נמחק'); drawFiles(page, t);
    } catch (e) { window.UI.toast('שגיאה: ' + (e.message || e), 'err'); }
  }

  async function removeTrip(page, t) {
    if (!(await window.UI.confirm('למחוק את הטיול "' + esc(t.name) + '"? הקבצים בדרייב יישארו.'))) return;
    const r = await window.store.remove('trips', t.id);
    if (!r || r.ok === false) { window.UI.toast('המחיקה נכשלה', 'err'); return; }
    window.UI.toast('נמחק'); state.open = null; await render(page);
  }

  // ── דף ההדפסה ─────────────────────────────────────────────────────────
  // חיתוך רוחבי: תלמיד + רפואי מהמערכת + מה שההורה מילא בטופס האישור.
  async function printSheet(t) {
    window.UI.toast('מכין את הדף…');
    const studs = await tripStudents(t.id);
    const ids = studs.map(s => s.id);
    const [meds, resp] = await Promise.all([
      window.store.list('medications'),
      t.form_id ? window.store.list('form_responses') : Promise.resolve([]),
    ]);
    const medOf = sid => (meds || []).filter(m => m.student_id === sid);
    const respOf = sid => (resp || []).find(r => r.student_id === sid && String(r.form_id) === String(t.form_id));
    const fields = (() => {
      const f = state.forms.find(x => x.id == t.form_id);
      if (!f) return [];
      try { return typeof f.fields === 'string' ? JSON.parse(f.fields) : (f.fields || []); } catch (_) { return []; }
    })();
    // מאתרים בטופס את השדות לפי מה שכתוב בתווית — הטפסים נבנים ידנית ואין
    // מפתחות קבועים, ולכן חיפוש לפי key היה שביר.
    const keyFor = re => (fields.find(f => re.test(String(f.label || ''))) || {}).key;
    const K = {
      health: keyFor(/מצב בריאות/), limit: keyFor(/מגבלה/),
      allergy: keyFor(/אלרג/), meds: keyFor(/תרופ/),
      ecName: keyFor(/איש קשר.*שם/), ecRel: keyFor(/קרבה/),
      ecPh1: keyFor(/איש קשר.*נייד|איש קשר.*טלפון נייד/), ecPh2: keyFor(/טלפון נוסף/),
    };
    const ans = (r, k) => (r && r.answers && k && r.answers[k] != null) ? String(r.answers[k]).trim() : '';

    const rows = studs.slice().sort((a, b) =>
      String(clsOf(a)).localeCompare(String(clsOf(b)), 'he') ||
      String(a.family || '').localeCompare(String(b.family || ''), 'he') ||
      String(a.name || '').localeCompare(String(b.name || ''), 'he'));

    const cell = v => '<td>' + (v ? esc(v) : '<span class="dim">—</span>') + '</td>';
    const body = rows.map((s, i) => {
      const r = respOf(s.id);
      const m = medOf(s.id);
      const sysAllergy = m.filter(x => x.category === 'רגישות').map(x => [x.name, x.details].filter(Boolean).join(' — ')).join(' · ');
      const sysCond = m.filter(x => x.category === 'מצב רפואי').map(x => [x.name, x.details].filter(Boolean).join(' — ')).join(' · ');
      const sysMeds = m.filter(x => (x.category || 'תרופה') === 'תרופה')
        .map(x => [x.name, x.dose, x.take_time].filter(Boolean).join(' · ')).join(' | ');
      // מה שההורה כתב בטופס גובר בתצוגה, והמערכת מוצגת לצידו — שניהם
      // רלוונטיים למלווה, ולפעמים הם לא זהים.
      const merge = (fromForm, fromSys) => [
        fromForm ? fromForm : '',
        fromSys ? (fromForm ? '\n(במערכת: ' + fromSys + ')' : fromSys) : '',
      ].filter(Boolean).join(' ');
      const phones = [reg(s, 'נייד אב'), reg(s, 'נייד אם'), reg(s, 'טלפון בבית')].filter(Boolean).join(' · ');
      const ec = [ans(r, K.ecName), ans(r, K.ecRel)].filter(Boolean).join(' — ');
      const ecPh = [ans(r, K.ecPh1), ans(r, K.ecPh2)].filter(Boolean).join(' · ');
      return '<tr>' +
        '<td class="idx">' + (i + 1) + '</td>' +
        '<td class="nm"><b>' + esc(nm(s)) + '</b></td>' +
        cell(clsOf(s)) +
        cell(s.tz || reg(s, 'תעודת זהות')) +
        cell(phones) +
        cell(merge(ans(r, K.health) || ans(r, K.limit), sysCond)) +
        cell(merge(ans(r, K.allergy), sysAllergy)) +
        cell(merge(ans(r, K.meds), sysMeds)) +
        cell(ec + (ecPh ? '\n' + ecPh : '')) +
        '<td class="ok-cell">' + (r && r.status === 'signed'
          ? '<span class="yes">✔ ' + esc(r.signer_name || '') + '</span>'
          : '<span class="no">✘ לא התקבל</span>') + '</td>' +
        '</tr>';
    }).join('');

    const signed = rows.filter(s => { const r = respOf(s.id); return r && r.status === 'signed'; }).length;
    const when = t.trip_date ? dmy(t.trip_date) + (t.end_date && t.end_date !== t.trip_date ? ' – ' + dmy(t.end_date) : '') : '';
    const inst = (window.CV3 || {}).INSTANCE_NAME || '';
    const html =
      '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">' +
      '<title>' + esc(t.name) + ' — רשימת תלמידים</title><style>' +
      '@page{size:A4 landscape;margin:9mm}' +
      'body{font-family:Heebo,Arial,sans-serif;margin:0;color:#111;font-size:8.6pt}' +
      '.hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #003048;padding-bottom:6px;margin-bottom:9px}' +
      '.hd h1{margin:0;font-size:15pt;color:#003048}' +
      '.hd .sub{font-size:9pt;color:#444;margin-top:2px}' +
      '.hd .rt{text-align:left;font-size:8.5pt;color:#444}' +
      'table{width:100%;border-collapse:collapse;table-layout:fixed}' +
      'th,td{border:1px solid #b9c2c8;padding:3px 4px;vertical-align:top;word-wrap:break-word;white-space:pre-line}' +
      'th{background:#eef3f6;color:#003048;font-size:8.4pt;text-align:right}' +
      'tr:nth-child(even) td{background:#fafcfd}' +
      '.idx{width:22px;text-align:center;color:#777}' +
      '.nm{width:96px}' +
      '.dim{color:#aaa}' +
      '.yes{color:#15803d;font-weight:700}.no{color:#b91c1c;font-weight:700}' +
      '.ok-cell{width:78px}' +
      '.warn{margin:8px 0;padding:6px 9px;border-inline-start:3px solid #b45309;background:#fff7ed;font-size:8.6pt}' +
      '.ft{margin-top:8px;font-size:7.6pt;color:#666;display:flex;justify-content:space-between}' +
      '@media print{.noprint{display:none}}' +
      '.noprint{margin:10px 0;text-align:center}' +
      '.noprint button{font:inherit;font-size:11pt;padding:8px 22px;border:0;border-radius:8px;background:#003048;color:#fff;cursor:pointer}' +
      '</style></head><body>' +
      '<div class="noprint"><button onclick="window.print()">הדפסה</button></div>' +
      '<div class="hd"><div><h1>' + esc(t.name) + '</h1>' +
        '<div class="sub">' + [when, hebDate(t.trip_date), t.destination, t.departure ? 'יציאה: ' + t.departure : '']
          .filter(Boolean).map(esc).join(' · ') + '</div></div>' +
        '<div class="rt">' + esc(inst) + '<br>' + rows.length + ' תלמידים · ' + signed + ' אישורי הורים התקבלו<br>' +
        'הופק ' + esc(dmy(today())) + '</div></div>' +
      (signed < rows.length
        ? '<div class="warn"><b>' + (rows.length - signed) + ' תלמידים ללא אישור הורים.</b> אין לצרפם לטיול לפני קבלת האישור.</div>'
        : '') +
      '<table><thead><tr>' +
      '<th class="idx">#</th><th class="nm">תלמיד</th><th style="width:70px">שיעור</th>' +
      '<th style="width:70px">ת״ז</th><th style="width:120px">טלפוני הורים</th>' +
      '<th>מצב בריאותי / מגבלה</th><th>אלרגיות</th><th>תרופות</th>' +
      '<th style="width:110px">איש קשר לחירום</th><th class="ok-cell">אישור הורים</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>' +
      '<div class="ft"><span>מסמך זה מכיל מידע רפואי — לשימוש המלווים בלבד, ולהשמדה בתום הטיול.</span>' +
      '<span>' + esc(inst) + '</span></div>' +
      '</body></html>';

    const w = window.open('', '_blank');
    if (!w) { window.UI.toast('הדפדפן חסם את החלון — אפשר חלונות קופצים', 'err'); return; }
    w.document.write(html); w.document.close();
  }

  // ── עיצוב ─────────────────────────────────────────────────────────────
  function style() {
    if (document.getElementById('trStyle')) return;
    const st = document.createElement('style'); st.id = 'trStyle';
    st.textContent =
      '.trip-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}' +
      '.trip-card{text-align:start;border:1px solid var(--line);border-radius:14px;padding:14px;' +
        'background:var(--card);cursor:pointer;font-family:inherit;color:var(--ink);transition:all .12s;' +
        'border-inline-start:4px solid var(--primary)}' +
      '.trip-card:hover{box-shadow:0 6px 18px rgba(0,0,0,.10);transform:translateY(-1px)}' +
      '.tc-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;color:var(--muted)}' +
      '.tc-name{font-weight:800;font-size:1.02rem;color:var(--primary-dark);margin-bottom:5px}' +
      '.tc-meta{font-size:.82rem;color:var(--muted);display:flex;align-items:center;gap:5px;margin-top:2px}' +
      '.btn-ghost.danger{color:#b91c1c}';
    document.head.appendChild(st);
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.trips = async function (page) { style(); state.open = null; await render(page); };
})();
