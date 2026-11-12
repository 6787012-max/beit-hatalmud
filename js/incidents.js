// incidents.js — "אירועים חריגים": תאונות, פציעות, אירועים רפואיים ואלימות (2026-11-12, בקשת יוסף).
//
// למה מודול נפרד: אירוע תאונה הוכנס ל-behavior_events כסוג "אחר", והקבצים (סרטון ותמונות)
// הוצמדו לתלמיד ולא לאירוע. כאן לכל אירוע רשומה משלו (incidents) וקבצים שמשויכים אליו
// (incident_files). הקבצים עצמם יושבים ב-bucket הפרטי student-docs, תחת הנתיב
// {student_id}/{אקראי}-{שם} — כך ה-policy הקיים על storage.objects אוכף את ההרשאה גם לקבצים האלה.
//
// ⚠️ העלאה והורדה הולכות ישירות מול Supabase Storage (לא דרך Edge Function כמו תיק המסמכים),
//    והורדה היא תמיד blob דרך ה-API — לא קישור חתום שנפתח בטאב חדש (נטפרי חוסם).
// ⚠️ מחיקה של אירוע היא רכה בלבד (deleted_at). אין כאן מסך שחזור מהסל.
(function () {
  'use strict';

  const BUCKET = 'student-docs';
  const MAX_MB = 25;
  const MAX_BYTES = MAX_MB * 1048576;
  const KINDS = ['תאונה', 'פציעה', 'אירוע רפואי', 'אלימות', 'אחר'];
  const SEVERITIES = ['נמוכה', 'רגילה', 'גבוהה'];
  const STATUSES = ['פתוח', 'סגור'];
  const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|heic)$/i;
  const VID_EXT = /\.(mp4|mov|m4v|webm|3gp|avi|mkv)$/i;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s && s.name) || '';
  const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
  const hebDate = iso => (window.UI && window.UI.hebDate) ? window.UI.hebDate(iso) : '';
  const kb = n => { n = Number(n || 0); return !n ? '' : (n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'); };
  const toast = (m, t) => { if (window.UI) window.UI.toast(m, t); };
  const txt = v => { const s = String(v == null ? '' : v).trim(); return s || null; };
  const rnd = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ── הרשאות ──
  // התצוגה נאכפת ב-roleCaps (auth.js) וב-RLS. כאן רק מסתירים כפתורים שייכשלו.
  const me = () => window.currentUser || (window.Auth && window.Auth.currentUser) || null;
  const canView = () => !window.Auth || window.Auth.canAccess('incidents');
  const canWrite = () => !!me() && !(window.Auth && window.Auth.mode === 'readonly');
  // עדכון/מחיקה ב-RLS: מנהל או היוצר בלבד — המסך מתאים לזה
  const canEdit = row => canWrite() && (me().role === 'מנהל' || String(row.created_by) === String(me().id));

  // ── נתונים ──
  async function loadAll() {
    const [incs, files, studs, classes] = await Promise.all([
      window.store.list('incidents'),
      window.store.list('incident_files'),
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
      window.store.list('classes'),
    ]);
    return {
      incs: (incs || []).filter(r => !r.deleted_at),
      files: files || [],
      studs: studs || [],
      classes: classes || [],
    };
  }
  const stuOf = (D, id) => D.studs.find(s => String(s.id) === String(id)) || {};
  const clsName = (D, stu) => { const c = D.classes.find(x => String(x.id) === String(stu.class_id)); return c ? c.name : ''; };
  const chipSev = s => s === 'גבוהה' ? 'hi' : (s === 'נמוכה' ? 'ok' : 'mid');
  const chipStatus = s => s === 'סגור' ? 'ok' : 'mid';

  // ── קבצים ──
  // סוג מדיה לפי MIME, ואם הוא ריק (קורה לחלק מהסרטונים) — לפי הסיומת.
  function kindOf(f) {
    const mt = String(f.mime || f.type || ''), n = String(f.title || f.name || '');
    if (/^image\//.test(mt) || IMG_EXT.test(n)) return 'image';
    if (/^video\//.test(mt) || VID_EXT.test(n)) return 'video';
    return null;
  }
  // שם לנתיב באחסון: ASCII בלבד (Supabase דוחה תווים לא-תקינים). השם המקורי נשמר ב-title.
  function safeName(name) {
    const s = String(name || 'file');
    const dot = s.lastIndexOf('.');
    const base = dot > 0 ? s.slice(0, dot) : s;
    const ext = dot > 0 ? s.slice(dot) : '';
    const clean = (base.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'file').slice(0, 60);
    return clean + ext.replace(/[^A-Za-z0-9.]/g, '').slice(0, 10).toLowerCase();
  }

  // הורדה כ-blob דרך ה-API (לא קישור חתום — נטפרי חוסם קישורים שנפתחים בטאב חדש)
  async function getBlob(f) {
    if (!window.sb) throw new Error('קבצים זמינים רק במערכת החיה');
    const { data, error } = await window.sb.storage.from(BUCKET).download(f.path);
    if (error || !data) throw new Error('הקובץ לא נטען: ' + ((error && error.message) || 'אין נתונים'));
    return new Blob([data], { type: f.mime || data.type || '' });
  }

  // העלאה עם התקדמות אמיתית: XHR מול ה-Storage REST, כי ה-client של Supabase לא מדווח התקדמות
  async function uploadXhr(path, file, onProgress) {
    const cfg = window.CV3 || {};
    const { data } = await window.sb.auth.getSession();
    const tok = data && data.session && data.session.access_token;
    if (!tok) throw new Error('אין חיבור פעיל — יש להיכנס מחדש');
    const url = cfg.SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/');
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('apikey', cfg.SUPABASE_ANON_KEY);
      xhr.setRequestHeader('Authorization', 'Bearer ' + tok);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error('ההעלאה נכשלה (' + xhr.status + ')'));
      xhr.onerror = () => reject(new Error('ההעלאה נכשלה — בדוק חיבור'));
      xhr.send(file);
    });
  }

  async function removeObject(path) {
    if (!window.sb) return;
    const { error } = await window.sb.storage.from(BUCKET).remove([path]);
    if (error) console.warn('[incidents] מחיקת קובץ מהאחסון נכשלה:', error.message);
    return !error;
  }

  // מעלה כמה קבצים לאירוע אחד. לכל קובץ: אחסון ואז שורת קובץ. כישלון ברשומה מוחק את הקובץ שהועלה.
  async function uploadFiles(incId, studentId, files, onStep) {
    const ok = [], bad = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const kind = kindOf(f);
      if (!kind) { bad.push(f.name + ' (רק תמונות וסרטונים)'); continue; }
      if (f.size > MAX_BYTES) { bad.push(f.name + ' (מעל ' + MAX_MB + 'MB)'); continue; }
      const path = studentId + '/' + rnd() + '-' + safeName(f.name);
      if (onStep) onStep(i, files.length, 0, f.name);
      try {
        await uploadXhr(path, f, p => onStep && onStep(i, files.length, p, f.name));
      } catch (e) { bad.push(f.name + ' — ' + (e.message || e)); continue; }
      const res = await window.store.add('incident_files', {
        incident_id: incId, student_id: studentId, path, title: f.name,
        mime: f.type || null, size_bytes: f.size,
      });
      if (!res || res.ok === false) {
        await removeObject(path);
        bad.push(f.name + ' — הרישום נכשל, הקובץ לא נשמר');
        continue;
      }
      ok.push(f.name);
    }
    return { ok, bad };
  }

  // מחיקת קובץ: קודם שורת המטא-דאטה עם select (כדי לאמת ש-RLS לא חסם בשקט), ורק אז הקובץ
  async function deleteFile(f) {
    if (!window.sb) { await window.store.remove('incident_files', f.id); return true; }
    const { data, error } = await window.sb.from('incident_files').delete().eq('id', f.id).select();
    if (error || !data || !data.length) { toast('המחיקה נכשלה — אין הרשאה לקובץ הזה', 'err'); return false; }
    await removeObject(f.path);
    return true;
  }

  // ── סגנון ──
  function style() {
    if (document.getElementById('incStyle')) return;
    const s = document.createElement('style'); s.id = 'incStyle';
    s.textContent =
      '.inc-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}' +
      '.inc-tile{aspect-ratio:1/1;border:1px solid var(--line,#d1d5db);border-radius:10px;overflow:hidden;display:flex;' +
      'align-items:center;justify-content:center;background:var(--card,#fff);cursor:pointer;font-size:.8rem;text-align:center;padding:6px;position:relative}' +
      '.inc-tile img,.inc-tile video{width:100%;height:100%;object-fit:cover}' +
      '.inc-tile .inc-cap{position:absolute;bottom:0;inset-inline:0;background:rgba(0,0,0,.55);color:#fff;font-size:.72rem;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.inc-err{color:#b91c1c;font-size:.78rem}' +
      '.inc-prog{height:6px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-top:6px}' +
      '.inc-prog>span{display:block;height:100%;width:0;background:var(--primary,#003048);transition:width .15s}' +
      '#incPrintArea{display:none}' +
      '@media print{' +
        'body.printing-incident>*:not(#incPrintArea){display:none !important}' +
        'body.printing-incident #incPrintArea{display:block !important;position:static}' +
        '@page{size:A4;margin:14mm}' +
      '}' +
      '#incPrintArea .ip-page{font-family:inherit;color:#000;direction:rtl;font-size:12pt}' +
      '#incPrintArea .ip-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:10px}' +
      '#incPrintArea .ip-head h1{font-size:16pt;margin:0}' +
      '#incPrintArea table{width:100%;border-collapse:collapse;margin-bottom:8px}' +
      '#incPrintArea td,#incPrintArea th{border:1px solid #444;padding:4px 6px;text-align:start;vertical-align:top}' +
      '#incPrintArea th{width:16%;background:#eee}' +
      '#incPrintArea h4{margin:10px 0 3px;font-size:12pt;border-bottom:1px solid #999}' +
      '#incPrintArea p{margin:2px 0 4px;white-space:pre-wrap}' +
      '#incPrintArea .ip-imgs{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
      '#incPrintArea .ip-imgs img{width:100%;max-height:90mm;object-fit:contain;border:1px solid #999}' +
      '#incPrintArea .ip-sign{margin-top:26px;display:flex;justify-content:space-between;gap:20px}' +
      '#incPrintArea .ip-sign div{flex:1;border-bottom:1px solid #000;padding-bottom:18px}';
    document.head.appendChild(s);
  }

  // ── מסך ──
  let pageRefresh = null;

  async function render(page) {
    if (!canView()) { page.innerHTML = '<div class="empty-state"><i class="bi bi-lock"></i><div>אין הרשאה למסך זה</div></div>'; return; }
    style();
    const pickHtml = await window.cv3Picker.html('incFilt', { placeholder: '🔍 סינון לפי תלמיד…' });
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
      '<h2>אירועים חריגים</h2>' +
      '<div class="head-actions">' +
        (canWrite() ? '<button class="btn-primary sm" id="incAdd"><i class="bi bi-plus-lg"></i> אירוע חדש</button>' : '') +
      '</div></div>' +
      '<div class="demo-note" style="margin:0 2px 12px"><i class="bi bi-shield-lock"></i> ' +
        'מידע רגיש — תיעוד אירועים, פציעות וקבצים מצורפים. הגישה מוגבלת לתפקידים מורשים ונאכפת בשרת.</div>' +
      '<div class="toolbar">' +
        '<div style="min-width:240px">' + pickHtml + '</div>' +
        '<select class="inp mb0" id="incKind"><option value="">כל הסוגים</option>' +
          KINDS.map(k => '<option>' + esc(k) + '</option>').join('') + '</select>' +
        '<select class="inp mb0" id="incStatus"><option value="">כל הסטטוסים</option>' +
          STATUSES.map(k => '<option>' + esc(k) + '</option>').join('') + '</select>' +
        '<label class="cb" style="white-space:nowrap">מ־ <input type="date" class="inp mb0" id="incFrom" style="width:auto"></label>' +
        '<label class="cb" style="white-space:nowrap">עד <input type="date" class="inp mb0" id="incTo" style="width:auto"></label>' +
      '</div>' +
      '<div class="count-line" id="incCount"></div>' +
      '<div id="incWrap" class="table-wrap"></div>' +
      '<div id="incEmpty" class="empty-state" hidden><i class="bi bi-shield-check"></i><div>אין אירועים חריגים מתאימים</div></div>';

    style();
    const fpk = window.cv3Picker.wire(page, 'incFilt', () => draw());
    let D = await loadAll();

    pageRefresh = async () => { if (!page.isConnected) return; D = await loadAll(); draw(); };

    function draw() {
      const sid = fpk.value();
      const k = page.querySelector('#incKind').value;
      const st = page.querySelector('#incStatus').value;
      const from = page.querySelector('#incFrom').value, to = page.querySelector('#incTo').value;
      const fcount = {};
      D.files.forEach(f => { fcount[f.incident_id] = (fcount[f.incident_id] || 0) + 1; });
      const list = D.incs.filter(r =>
          (!sid || String(r.student_id) === sid) && (!k || r.kind === k) && (!st || r.status === st) &&
          (!from || String(r.incident_date) >= from) && (!to || String(r.incident_date) <= to))
        .sort((a, b) => String(b.incident_date).localeCompare(String(a.incident_date)) ||
          String(b.incident_time || '').localeCompare(String(a.incident_time || '')) || (b.id - a.id));

      const head = ['תאריך', 'שעה', 'תלמיד', 'שיעור', 'סוג', 'חומרה', 'מקום', 'סטטוס', 'קבצים'];
      const body = list.map(r => {
        const stu = stuOf(D, r.student_id);
        return '<tr data-open="' + r.id + '" style="cursor:pointer">' +
          '<td>' + esc(fmtDate(r.incident_date)) + '</td>' +
          '<td>' + esc(r.incident_time || '—') + '</td>' +
          '<td><b>' + esc(nm(stu)) + '</b>' + (r.parent_notified ? '' : ' <span class="det-badge" style="background:#fee2e2;color:#991b1b">הורים לא עודכנו</span>') + '</td>' +
          '<td>' + esc(clsName(D, stu) || '—') + '</td>' +
          '<td>' + esc(r.kind) + '</td>' +
          '<td><span class="chip ' + chipSev(r.severity) + '">' + esc(r.severity) + '</span></td>' +
          '<td>' + esc(r.place || '—') + '</td>' +
          '<td><span class="chip ' + chipStatus(r.status) + '">' + esc(r.status) + '</span></td>' +
          '<td>' + (fcount[r.id] || 0) + '</td>' +
          '</tr>';
      }).join('');
      page.querySelector('#incWrap').innerHTML = list.length
        ? '<table class="tbl"><thead><tr>' + head.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table>'
        : '';
      page.querySelector('#incEmpty').hidden = list.length > 0;
      const open = list.filter(r => r.status === 'פתוח').length;
      page.querySelector('#incCount').innerHTML = list.length + ' אירועים' +
        (open ? ' · <b style="color:#b91c1c">' + open + ' פתוחים</b>' : '');
      page.querySelectorAll('tr[data-open]').forEach(tr => tr.addEventListener('click', () => openDetail(tr.dataset.open)));
    }

    ['#incKind', '#incStatus', '#incFrom', '#incTo'].forEach(s => {
      const el = page.querySelector(s);
      el.addEventListener('input', draw); el.addEventListener('change', draw);
    });
    const addBtn = page.querySelector('#incAdd');
    if (addBtn) addBtn.addEventListener('click', () => openForm(null, {}));
    draw();
  }

  // ── טופס הוספה / עריכה ──
  // rec = null → אירוע חדש. opts.student = תלמיד שנבחר מראש (מהכרטיס). opts.onSaved = קריאה אחרי שמירה.
  async function openForm(rec, opts) {
    opts = opts || {};
    if (!canWrite()) { toast('אין הרשאה לרישום אירועים', 'err'); return; }
    if (rec && !canEdit(rec)) { toast('ניתן לערוך רק אירוע שרשמת בעצמך', 'err'); return; }
    const D = await loadAll();
    const fixedId = rec ? rec.student_id : (opts.student ? opts.student.id : null);
    // תלמיד קבוע (עריכה, או פתיחה מהכרטיס). אם התלמיד לא בהיקף הטעינה — לא נופלים לבורר,
    // כי אז השמירה תיכשל על student_id ריק.
    const fixed = fixedId == null ? null
      : (stuOf(D, fixedId).id != null ? stuOf(D, fixedId) : (opts.student || { id: fixedId, name: '' }));
    const pickHtml = fixed ? '' : await window.cv3Picker.html('incNew');
    const v = (k, d) => (rec && rec[k] != null && rec[k] !== '') ? rec[k] : d;
    const F = (label, html, wide) => '<label class="fld' + (wide ? ' fld-wide' : '') + '"><span>' + label + '</span>' + html + '</label>';
    const sel = (id, opts2, cur) => '<select class="inp mb0" id="' + id + '">' +
      opts2.map(o => '<option' + (String(o) === String(cur) ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';

    const stuBlock = fixed
      ? F('תלמיד', '<input class="inp mb0" value="' + esc(nm(fixed)) + '" disabled>')
      : '<div class="fld fld-wide"><span>תלמיד *</span>' + pickHtml + '</div>';

    const body = '<div class="form-grid">' + stuBlock +
      F('תאריך *', '<input type="date" class="inp mb0" id="inc_date" value="' + esc(v('incident_date', todayIso()).slice(0, 10)) + '">') +
      F('שעה', '<input type="time" class="inp mb0" id="inc_time" value="' + esc(v('incident_time', '')) + '">') +
      F('סוג *', sel('inc_kind', KINDS, v('kind', 'אחר'))) +
      F('חומרה', sel('inc_sev', SEVERITIES, v('severity', 'רגילה'))) +
      F('מקום', '<input class="inp mb0" id="inc_place" value="' + esc(v('place', '')) + '" placeholder="חצר, כיתה, אוטובוס…">') +
      F('סטטוס', sel('inc_status', STATUSES, v('status', 'פתוח'))) +
      F('מה קרה *', '<textarea class="inp mb0" id="inc_desc" rows="3">' + esc(v('description', '')) + '</textarea>', true) +
      F('פציעה / נזק', '<textarea class="inp mb0" id="inc_injury" rows="2">' + esc(v('injury', '')) + '</textarea>', true) +
      F('מי טיפל', '<input class="inp mb0" id="inc_treated" value="' + esc(v('treated_by', '')) + '" placeholder="מד״א, אחות, מחנך…">') +
      F('הורים עודכנו', '<label class="cb"><input type="checkbox" id="inc_pn"' + (rec && rec.parent_notified ? ' checked' : '') + '> כן, ההורים עודכנו</label>') +
      F('פרטי עדכון הורים', '<input class="inp mb0" id="inc_pnote" value="' + esc(v('parent_note', '')) + '" placeholder="מתי, איך, מי דיבר">', true) +
      F('תלמידים נוספים', '<textarea class="inp mb0" id="inc_others" rows="2" placeholder="מי היה מעורב או נכח">' + esc(v('other_students', '')) + '</textarea>', true) +
      F('מעקב / המשך', '<textarea class="inp mb0" id="inc_follow" rows="2">' + esc(v('followup_note', '')) + '</textarea>', true) +
      F('קבצים לאירוע (תמונות וסרטונים, עד ' + MAX_MB + 'MB לקובץ)',
        '<input type="file" class="inp mb0" id="inc_files" multiple accept="image/*,video/*">' +
        '<div id="inc_fl" class="tl-note" style="font-size:.82rem;margin-top:4px"></div>' +
        '<div id="inc_prog" class="tl-note" style="font-size:.82rem"></div>', true) +
      '</div>';

    let busy = false;
    const m = window.UI.modal({
      title: rec ? 'עריכת אירוע חריג' : 'אירוע חריג חדש', saveLabel: 'שמירה', bodyHTML: body,
      onSave: async (mel) => {
        if (busy) return false;
        const studentId = fixed ? Number(fixed.id) : Number(pk.value());
        if (!studentId) { toast('חובה לבחור תלמיד', 'err'); return false; }
        const date = mel.querySelector('#inc_date').value;
        const desc = txt(mel.querySelector('#inc_desc').value);
        if (!date) { toast('חובה לבחור תאריך', 'err'); return false; }
        if (!desc) { toast('חובה לכתוב מה קרה', 'err'); return false; }
        const files = [...mel.querySelector('#inc_files').files];
        if (files.length && !window.sb) { toast('העלאת קבצים זמינה רק במערכת החיה', 'err'); return false; }
        const row = {
          student_id: studentId,
          incident_date: date,
          incident_time: txt(mel.querySelector('#inc_time').value),
          kind: mel.querySelector('#inc_kind').value,
          severity: mel.querySelector('#inc_sev').value,
          place: txt(mel.querySelector('#inc_place').value),
          status: mel.querySelector('#inc_status').value,
          description: desc,
          injury: txt(mel.querySelector('#inc_injury').value),
          treated_by: txt(mel.querySelector('#inc_treated').value),
          parent_notified: !!mel.querySelector('#inc_pn').checked,
          parent_note: txt(mel.querySelector('#inc_pnote').value),
          other_students: txt(mel.querySelector('#inc_others').value),
          followup_note: txt(mel.querySelector('#inc_follow').value),
        };
        const prog = mel.querySelector('#inc_prog');
        const saveBtn = mel.querySelector('[data-act="save"]');
        busy = true; if (saveBtn) saveBtn.disabled = true;
        try {
          let incId = rec ? rec.id : null;
          if (rec) {
            const r = await window.store.update('incidents', rec.id, row);
            if (!r || r.ok === false) throw new Error('השמירה נכשלה' + (r && r.error ? ': ' + r.error : ''));
            if (window.sb && (!r.data || !r.data.length)) throw new Error('השמירה לא נקלטה — אין הרשאה לאירוע הזה');
          } else {
            const r = await window.store.add('incidents', row);
            if (!r || r.ok === false) throw new Error('השמירה נכשלה' + (r && r.error ? ': ' + r.error : ''));
            incId = r.data && r.data[0] && r.data[0].id;
            if (!incId) throw new Error('האירוע נשמר בלי מזהה — לבדוק את המסד');
          }
          let up = { ok: [], bad: [] };
          if (files.length) {
            up = await uploadFiles(incId, studentId, files, (i, n, p, name) => {
              if (prog) prog.innerHTML = 'מעלה ' + (i + 1) + ' מתוך ' + n + ' · ' + esc(name) + ' · ' + Math.round(p * 100) + '%' +
                '<div class="inc-prog"><span style="width:' + Math.round(p * 100) + '%"></span></div>';
            });
          }
          if (up.bad.length) toast('לא כל הקבצים הועלו: ' + up.bad.join(' | '), 'err');
          else toast(rec ? 'האירוע עודכן' : 'האירוע נשמר' + (up.ok.length ? ' עם ' + up.ok.length + ' קבצים' : ''));
          m.close();
          if (pageRefresh) pageRefresh();
          if (opts.onSaved) opts.onSaved();
          return false;
        } catch (e) {
          toast(e.message || 'השמירה נכשלה', 'err');
          return false;
        } finally {
          busy = false; if (saveBtn) saveBtn.disabled = false;
        }
      },
    });
    m.el.classList.add('modal-wide');
    const pk = fixed ? null : window.cv3Picker.wire(m.el, 'incNew');

    // תצוגת הקבצים שנבחרו, עם סימון של מה שייפסל מיד
    const fin = m.el.querySelector('#inc_files');
    fin.addEventListener('change', () => {
      const box = m.el.querySelector('#inc_fl');
      box.innerHTML = [...fin.files].map(f => {
        const bad = !kindOf(f) ? ' — לא תמונה או סרטון' : (f.size > MAX_BYTES ? ' — מעל ' + MAX_MB + 'MB' : '');
        return '<div' + (bad ? ' style="color:#b91c1c"' : '') + '>' + esc(f.name) + ' · ' + kb(f.size) + esc(bad) + '</div>';
      }).join('');
    });
  }

  // ── תצוגת אירוע ──
  function detailHTML(inc, stu, clsTxt, fls, can) {
    const kv = (k, val) => '<dt>' + esc(k) + '</dt><dd>' + (val == null || val === '' ? '—' : esc(val)) + '</dd>';
    const sec = (title, inner) => '<div class="det-sec"><h4>' + title + '</h4>' + inner + '</div>';
    const pre = v => v ? '<p style="white-space:pre-wrap;margin:0">' + esc(v) + '</p>' : '<p class="tl-note" style="margin:0">—</p>';
    const tiles = fls.length ? fls.map(f => {
      const k = kindOf(f) || 'other';
      const inner = k === 'image' ? '<span class="tl-note">טוען…</span>'
        : k === 'video' ? '<button class="btn-ghost sm" data-play="' + f.id + '"><i class="bi bi-play-circle"></i> הפעל סרטון</button>'
        : '<i class="bi bi-file-earmark"></i>';
      return '<div class="inc-tile" data-tile="' + f.id + '" data-kind="' + k + '" title="' + esc(f.title) + '">' + inner +
        '<span class="inc-cap">' + esc(f.title) + '</span></div>' +
        '<div style="display:flex;gap:4px;justify-content:center;margin-top:-4px">' +
          '<button class="mini" data-dl="' + f.id + '" title="הורדה"><i class="bi bi-download"></i></button>' +
          (can ? '<button class="mini danger" data-fdel="' + f.id + '" title="מחיקת הקובץ"><i class="bi bi-trash"></i></button>' : '') +
        '</div>';
    }).join('') : '<div class="tl-note">אין קבצים מצורפים לאירוע הזה</div>';

    return '<div class="det-head"><div><div class="det-name">' + esc(nm(stu)) + '</div>' +
      '<span class="chip ' + chipSev(inc.severity) + '">' + esc(inc.severity) + '</span> ' +
      '<span class="chip ' + chipStatus(inc.status) + '">' + esc(inc.status) + '</span> ' +
      '<span class="det-badge">' + esc(inc.kind) + '</span></div></div>' +
      '<div class="det-grid" style="display:grid;grid-template-columns:auto 1fr auto 1fr;gap:4px 12px;font-size:.92rem;margin:8px 0">' +
        kv('תאריך', fmtDate(inc.incident_date) + (hebDate(inc.incident_date) ? ' · ' + hebDate(inc.incident_date) : '')) +
        kv('שעה', inc.incident_time) + kv('מקום', inc.place) + kv('שיעור', clsTxt) +
      '</div>' +
      sec('מה קרה', pre(inc.description)) +
      sec('פציעה וטיפול', pre(inc.injury) + '<p style="margin:6px 0 0"><b>טופל ע"י:</b> ' + esc(inc.treated_by || '—') + '</p>') +
      sec('הורים', '<p style="margin:0"><b>עודכנו:</b> ' + (inc.parent_notified ? 'כן' : 'לא') + '</p>' + pre(inc.parent_note)) +
      sec('תלמידים נוספים', pre(inc.other_students)) +
      sec('מעקב', pre(inc.followup_note)) +
      sec('קבצים (' + fls.length + ')',
        '<div class="inc-tiles">' + tiles + '</div>' +
        (can ? '<div style="margin-top:8px"><button class="btn-ghost sm" data-addf><i class="bi bi-paperclip"></i> הוספת קבצים לאירוע</button></div>' : '') +
        '<div class="tl-note" data-dmsg style="font-size:.82rem;min-height:1.1em;margin-top:4px"></div>') +
      '<div class="det-actions" style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">' +
        (can ? '<button class="btn-primary sm" data-edit><i class="bi bi-pencil"></i> עריכה</button>' : '') +
        (can ? '<button class="btn-ghost sm" data-status="' + (inc.status === 'פתוח' ? 'סגור' : 'פתוח') + '"><i class="bi bi-check2-circle"></i> ' + (inc.status === 'פתוח' ? 'סגור אירוע' : 'פתח מחדש') + '</button>' : '') +
        '<button class="btn-ghost sm" data-print><i class="bi bi-printer"></i> הדפסת דוח אירוע</button>' +
        (can ? '<button class="btn-ghost sm danger" data-del><i class="bi bi-trash"></i> מחיקה (לסל)</button>' : '') +
      '</div>';
  }

  async function openDetail(id, onChange) {
    const D = await loadAll();
    const inc = D.incs.find(x => String(x.id) === String(id));
    if (!inc) { toast('האירוע לא נמצא', 'err'); return; }
    const stu = stuOf(D, inc.student_id);
    const clsTxt = clsName(D, stu);
    const fls = D.files.filter(f => String(f.incident_id) === String(inc.id));
    const can = canEdit(inc);
    const urls = [];
    const m = window.UI.modal({
      title: 'אירוע חריג — ' + esc(nm(stu)), cancelLabel: 'סגור',
      bodyHTML: detailHTML(inc, stu, clsTxt, fls, can),
      onClose: () => urls.forEach(u => URL.revokeObjectURL(u)),
    });
    m.el.classList.add('modal-wide');
    const root = m.el;
    const after = () => { m.close(); if (pageRefresh) pageRefresh(); if (onChange) onChange(); openDetail(inc.id, onChange); };

    // תמונות נטענות ברקע; וידאו רק בלחיצה (הורדה של כמה מגה לא נעשית בלי צורך)
    fls.forEach(f => {
      if (kindOf(f) !== 'image') return;
      const tile = root.querySelector('[data-tile="' + f.id + '"]');
      getBlob(f).then(b => {
        const u = URL.createObjectURL(b); urls.push(u);
        if (!tile.isConnected) return;
        tile.innerHTML = '<img src="' + u + '" alt="' + esc(f.title) + '"><span class="inc-cap">' + esc(f.title) + '</span>';
        tile.addEventListener('click', () => window.UI.modal({ title: esc(f.title), bodyHTML: '<img src="' + u + '" style="max-width:100%;border-radius:10px">' }));
      }).catch(e => { if (tile.isConnected) tile.innerHTML = '<span class="inc-err">' + esc(e.message || e) + '</span>'; });
    });
    root.querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', async () => {
      const f = fls.find(x => String(x.id) === b.dataset.play);
      const tile = b.closest('.inc-tile');
      b.disabled = true; b.textContent = 'טוען…';
      try {
        const u = URL.createObjectURL(await getBlob(f)); urls.push(u);
        tile.innerHTML = '<video controls src="' + u + '" style="width:100%;height:100%;background:#000"></video>';
      } catch (e) { b.disabled = false; b.textContent = 'נסה שוב'; toast(e.message || e, 'err'); }
    }));
    root.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', async () => {
      const f = fls.find(x => String(x.id) === b.dataset.dl);
      try {
        const u = URL.createObjectURL(await getBlob(f));
        const a = document.createElement('a'); a.href = u; a.download = f.title || 'file'; a.click();
        setTimeout(() => URL.revokeObjectURL(u), 30000);
      } catch (e) { toast(e.message || e, 'err'); }
    }));
    root.querySelectorAll('[data-fdel]').forEach(b => b.addEventListener('click', async () => {
      const f = fls.find(x => String(x.id) === b.dataset.fdel);
      if (!await window.UI.confirm('למחוק את הקובץ "' + esc(f.title) + '" מהאירוע? הפעולה אינה הפיכה.')) return;
      if (await deleteFile(f)) { toast('הקובץ נמחק'); after(); }
    }));

    const dmsg = root.querySelector('[data-dmsg]');
    const addf = root.querySelector('[data-addf]');
    if (addf) addf.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*,video/*';
      inp.addEventListener('change', async () => {
        const list = [...inp.files];
        if (!list.length) return;
        if (!window.sb) { toast('העלאת קבצים זמינה רק במערכת החיה', 'err'); return; }
        const r = await uploadFiles(inc.id, inc.student_id, list, (i, n, p, name) => {
          if (dmsg) dmsg.innerHTML = 'מעלה ' + (i + 1) + ' מתוך ' + n + ' · ' + esc(name) + ' · ' + Math.round(p * 100) + '%';
        });
        if (r.bad.length) toast('לא כל הקבצים הועלו: ' + r.bad.join(' | '), 'err');
        else toast('הועלו ' + r.ok.length + ' קבצים');
        after();
      });
      inp.click();
    });

    const ed = root.querySelector('[data-edit]');
    if (ed) ed.addEventListener('click', () => { m.close(); openForm(inc, { onSaved: onChange }); });

    const stb = root.querySelector('[data-status]');
    if (stb) stb.addEventListener('click', async () => {
      const r = await window.store.update('incidents', inc.id, { status: stb.dataset.status });
      if (!r || r.ok === false || (window.sb && (!r.data || !r.data.length))) { toast('העדכון נכשל — אין הרשאה?', 'err'); return; }
      toast('הסטטוס עודכן'); after();
    });

    const pr = root.querySelector('[data-print]');
    if (pr) pr.addEventListener('click', () => printReport(inc, stu, clsTxt, fls));

    const dl = root.querySelector('[data-del]');
    if (dl) dl.addEventListener('click', async () => {
      if (!await window.UI.confirm('להעביר את האירוע לסל? האירוע לא יופיע במסך; הקבצים שלו נשמרים.')) return;
      const r = await window.store.update('incidents', inc.id, { deleted_at: new Date().toISOString(), deleted_by: me() ? me().id : null });
      if (!r || r.ok === false || (window.sb && (!r.data || !r.data.length))) { toast('המחיקה נכשלה — אין הרשאה?', 'err'); return; }
      toast('האירוע הועבר לסל');
      m.close();
      if (pageRefresh) pageRefresh();
      if (onChange) onChange();
    });
  }

  // ── דוח להדפסה ──
  // תצוגה בתוך הדף עצמו (לא חלון חדש — נטפרי וחוסמי חלונות קופצים). רק הדוח מודפס.
  async function printReport(inc, stu, clsTxt, fls) {
    const urls = [];
    const imgs = [];
    for (const f of fls) {
      if (kindOf(f) !== 'image') continue;
      try { const u = URL.createObjectURL(await getBlob(f)); urls.push(u); imgs.push({ f, u }); }
      catch (_) { /* תמונה שלא נטענה — מסומנת בדוח ככתובת בלבד */ }
    }
    const vids = fls.filter(f => kindOf(f) === 'video');
    const others = fls.filter(f => !kindOf(f));
    const today = new Date();
    const printedAt = pad(today.getDate()) + '/' + pad(today.getMonth() + 1) + '/' + today.getFullYear();
    const p = v => v ? esc(v).replace(/\n/g, '<br>') : '—';

    let host = document.getElementById('incPrintArea');
    if (!host) { host = document.createElement('div'); host.id = 'incPrintArea'; document.body.appendChild(host); }
    host.innerHTML =
      '<div class="ip-page">' +
        '<div class="ip-head"><div><h1>דוח אירוע חריג</h1><div>בית התלמוד</div></div>' +
        '<div>הודפס: ' + esc(printedAt) + '</div></div>' +
        '<table>' +
          '<tr><th>תלמיד</th><td>' + esc(nm(stu)) + '</td><th>שיעור</th><td>' + esc(clsTxt || '—') + '</td></tr>' +
          '<tr><th>שם הורה</th><td>' + esc(stu.parent_name || '—') + '</td><th>טלפון הורה</th><td>' + esc(stu.parent_phone || '—') + '</td></tr>' +
          '<tr><th>תאריך</th><td>' + esc(fmtDate(inc.incident_date)) + (hebDate(inc.incident_date) ? ' · ' + esc(hebDate(inc.incident_date)) : '') + '</td>' +
            '<th>שעה</th><td>' + esc(inc.incident_time || '—') + '</td></tr>' +
          '<tr><th>מקום</th><td>' + esc(inc.place || '—') + '</td><th>סוג</th><td>' + esc(inc.kind) + '</td></tr>' +
          '<tr><th>חומרה</th><td>' + esc(inc.severity) + '</td><th>סטטוס</th><td>' + esc(inc.status) + '</td></tr>' +
        '</table>' +
        '<h4>תיאור האירוע</h4><p>' + p(inc.description) + '</p>' +
        '<h4>פציעה וטיפול</h4><p>' + p(inc.injury) + '</p><p><b>טופל ע"י:</b> ' + esc(inc.treated_by || '—') + '</p>' +
        '<h4>עדכון הורים</h4><p><b>עודכנו:</b> ' + (inc.parent_notified ? 'כן' : 'לא') + '</p><p>' + p(inc.parent_note) + '</p>' +
        '<h4>תלמידים נוספים</h4><p>' + p(inc.other_students) + '</p>' +
        '<h4>מעקב</h4><p>' + p(inc.followup_note) + '</p>' +
        (fls.length ? '<h4>קבצים מצורפים (' + fls.length + ')</h4>' +
          (imgs.length ? '<div class="ip-imgs">' + imgs.map(i => '<div><img src="' + i.u + '" alt=""><div style="font-size:9pt">' + esc(i.f.title) + '</div></div>').join('') + '</div>' : '') +
          (vids.length || others.length || imgs.length < fls.filter(f => kindOf(f) === 'image').length
            ? '<p style="font-size:10pt">' + [
                ...vids.map(v => 'סרטון (לא מוטמע בהדפסה): ' + esc(v.title)),
                ...others.map(o => 'קובץ: ' + esc(o.title)),
                ...fls.filter(f => kindOf(f) === 'image' && !imgs.some(i => i.f.id === f.id)).map(f => 'תמונה שלא נטענה: ' + esc(f.title)),
              ].join('<br>') + '</p>' : '')
          : '') +
        '<div class="ip-sign"><div>חתימת המדווח</div><div>חתימת הורה / אחראי</div><div style="flex:.5">תאריך</div></div>' +
      '</div>';

    // מחכים שהתמונות ייטענו לפני הדפסה, אחרת הדפדפן מדפיס תיבות ריקות
    await Promise.all([...host.querySelectorAll('img')].map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve()));
    const done = () => {
      document.body.classList.remove('printing-incident');
      host.innerHTML = '';
      urls.forEach(u => URL.revokeObjectURL(u));
    };
    window.addEventListener('afterprint', done, { once: true });
    setTimeout(() => { if (document.body.classList.contains('printing-incident')) done(); }, 180000);
    document.body.classList.add('printing-incident');
    window.print();
  }

  // ── סעיף בכרטיס התלמיד ──
  // students.js מוסיף את הסעיף לתבנית הכרטיס, וקורא ל-fillCard אחרי שהכרטיס על המסך.
  function cardSection() {
    if (!canView()) return '';
    return '<div class="det-sec" id="incCard"><h4><i class="bi bi-exclamation-triangle"></i> אירועים חריגים ' +
      '<span class="det-badge" data-inc-cnt>…</span></h4>' +
      '<div data-inc-list><div class="ld"><i class="bi bi-hourglass-split"></i> טוען…</div></div>' +
      (canWrite() ? '<button class="btn-ghost sm" data-inc-new type="button" style="margin-top:6px"><i class="bi bi-plus-lg"></i> אירוע חדש לתלמיד</button>' : '') +
      '</div>';
  }

  async function fillCard(root, stu) {
    if (!root || !stu || !canView()) return;
    style();
    const list = root.querySelector('[data-inc-list]');
    const cnt = root.querySelector('[data-inc-cnt]');
    const draw = async () => {
      const D = await loadAll();
      const mine = D.incs.filter(r => String(r.student_id) === String(stu.id))
        .sort((a, b) => String(b.incident_date).localeCompare(String(a.incident_date)) || (b.id - a.id));
      if (cnt) cnt.textContent = mine.length + (mine.some(r => r.status === 'פתוח') ? ' · פתוח' : '');
      if (!list) return;
      list.innerHTML = mine.length ? mine.slice(0, 8).map(r => {
        const nf = D.files.filter(f => String(f.incident_id) === String(r.id)).length;
        return '<div class="det-item" data-inc-open="' + r.id + '" style="cursor:pointer">' +
          '<span class="di-main">' + esc(fmtDate(r.incident_date)) + ' · ' + esc(r.kind) + ' · ' + esc(r.place || '') + '</span>' +
          '<span class="di-meta"><span class="chip ' + chipStatus(r.status) + '">' + esc(r.status) + '</span>' +
          (nf ? ' · ' + nf + ' קבצים' : '') + '</span></div>';
      }).join('') + (mine.length > 8 ? '<div class="tl-note">ועוד ' + (mine.length - 8) + ' — בלשונית "אירועים חריגים"</div>' : '')
        : '<div class="tl-note" style="padding:4px 2px">אין אירועים חריגים רשומים לתלמיד</div>';
      list.querySelectorAll('[data-inc-open]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.incOpen, draw)));
    };
    const nb = root.querySelector('[data-inc-new]');
    if (nb) nb.addEventListener('click', () => openForm(null, { student: stu, onSaved: draw }));
    await draw();
  }

  window.cv3Incidents = { cardSection, fillCard, openForm, openDetail, KINDS, SEVERITIES, STATUSES };
  const R = window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  R.incidents = render;
})();
