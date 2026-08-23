// student-docs.js — "תיק המסמכים" של התלמיד, **ישירות בגוגל דרייב** (2026-08-20).
//
// הקבצים לא נשמרים במערכת אלא בתיקייה של התלמיד בדרייב ("תיקי תלמידים - בית התלמוד"),
// כך שמה שמעלים כאן נמצא גם בדרייב, ומה שכבר קיים בדרייב נראה כאן.
//
// הדפדפן לא מדבר עם גוגל בכלל: אין לו טוקן (ואסור שיהיה לו), ונטפרי חוסם את
// google/script APIs. כל פעולה עוברת דרך Edge Function של Supabase בשם `drive`,
// שמחזיקה את הטוקן בצד-שרת ומאמתת הרשאה מול ה-RLS לפני כל פעולה.
//
// מגבלה ידועה: ההרשאה של האפליקציה בדרייב היא `drive.file` — כלומר היא יכולה
// *לראות* את כל הקבצים בתיקייה, אבל להוריד/למחוק רק את מה שהיא עצמה העלתה.
// לקבצים הישנים מוצג "פתח בדרייב" במקום הורדה, וזה מסומן למשתמש.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MAX_MB = 25;
  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  // סיווג לפי שם הקובץ — כך גם מאות הקבצים הישנים שבדרייב מקבלים קטגוריה בלי הזנה ידנית
  const KIND_RULES = [
    ['ויתור סודיות', /ויתור/],
    ['שאלון הפניה', /שאלון/],
    ['אבחונים ורקע קודם', /אבחון|אבחונים|פסיכו|דידקטי|מוקסו|פסיכיאטר/],
    // נעמי לוי ביקשה שהחלטת ועדה תהיה קטגוריה בפני עצמה ולא תיבלע ב"מסמך קביל".
    // חייב להופיע *לפני* "מסמך קביל", כי הכלל שם מכיל גם הוא "ועדה".
    ['החלטת ועדה', /ועד[הת]|השמ[הת]|פרוטוקול/],
    ['מסמך קביל', /קביל|זכאות|אפיון|זימון/],
    ['תעודות ומסמכי זהות', /תעודת זהות|ת"ז|תז |ספח/],
  ];
  const KINDS = KIND_RULES.map(r => r[0]).concat(['אחר']);
  // מסמכי החובה: ארבעת מסמכי האפיון + החלטת ועדה שנעמי הגדירה כחשובה לתיק
  const NEED = ['ויתור סודיות', 'שאלון הפניה', 'אבחונים ורקע קודם', 'מסמך קביל', 'החלטת ועדה'];
  // כמה מתיקיות התלמידים בדרייב הן למעשה מזבלה: קבצי עזר של וורד (~$),
  // חומרי הוראה כלליים וסריקות בשם מכונה — עד 200 קבצים אצל תלמיד אחד,
  // שמטביעים את המסמכים האמיתיים. מסתירים אותם כברירת מחדל, עם מתג להצגה.
  const JUNK = /^~\$|פורים מהגמרא|האותיות שבסוגריים|דף מידע להורים|getUserFile|^SKM_|^IMG[-_]?\d|^Doc \w+ \d|^Scan|^\d{6,}\./i;
  const isJunk = f => JUNK.test(String(f && f.name || ''));

  function classify(name) {
    const n = String(name || '');
    for (const [kind, re] of KIND_RULES) if (re.test(n)) return kind;
    return 'אחר';
  }

  function icon(mime, name) {
    const t = String(name || '').toLowerCase(), m = String(mime || '');
    if (m === FOLDER_MIME) return 'bi-folder2-open';
    if (m.indexOf('pdf') > -1 || /\.pdf$/.test(t)) return 'bi-file-earmark-pdf';
    if (m.indexOf('image') > -1 || /\.(png|jpe?g|gif|webp|heic)$/.test(t)) return 'bi-file-earmark-image';
    if (m.indexOf('word') > -1 || m.indexOf('document') > -1 || /\.docx?$/.test(t)) return 'bi-file-earmark-word';
    if (m.indexOf('sheet') > -1 || /\.xlsx?$/.test(t)) return 'bi-file-earmark-spreadsheet';
    return 'bi-file-earmark';
  }
  const kb = n => { n = Number(n || 0); return !n ? '' : (n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'); };

  // ── קריאה ל-Edge Function ──
  async function fnUrl() { return ((window.CV3 || {}).SUPABASE_URL || '') + '/functions/v1/drive'; }
  async function authHeaders() {
    const { data } = await window.sb.auth.getSession();
    const tok = data && data.session && data.session.access_token;
    if (!tok) throw new Error('אין חיבור פעיל — יש להיכנס מחדש');
    return { apikey: (window.CV3 || {}).SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tok };
  }
  async function call(action, params, body, contentType) {
    const qs = new URLSearchParams(Object.assign({ action }, params || {})).toString();
    const h = await authHeaders();
    if (contentType) h['Content-Type'] = contentType;
    const res = await fetch((await fnUrl()) + '?' + qs, { method: 'POST', headers: h, body: body || undefined });
    return res;
  }
  async function callJson(action, params, body, contentType) {
    const res = await call(action, params, body, contentType);
    let d = null;
    try { d = await res.json(); } catch (_) { d = null; }
    if (!res.ok) throw new Error((d && d.error) || ('שגיאה ' + res.status));
    return d;
  }

  // ── רשומות התיקיות מהמסד (מקור ההרשאה, וגם הקישור לדרייב) ──
  async function forStudent(sid) {
    const rows = await window.store.byStudent('student_docs', sid);
    return (rows || []).filter(r => r.source === 'drive');
  }

  // ── סקשן קצר בכרטיס: כמה תיקיות יש, וכפתור. הרשימה עצמה נטענת בפתיחת התיק ──
  function cardSection(folders) {
    folders = folders || [];
    if (!folders.length) {
      return '<div class="det-sec"><h4><i class="bi bi-folder2-open"></i> תיק מסמכים</h4>' +
        '<div class="tl-note" style="padding:4px 2px">אין לתלמיד תיקייה בדרייב. אפשר לפתוח אחת מתוך "תיק מסמכים".</div></div>';
    }
    return '<div class="det-sec"><h4><i class="bi bi-folder2-open"></i> תיק מסמכים ' +
      '<span class="det-badge">' + folders.length + ' תיקיות בדרייב</span></h4>' +
      folders.map(d => '<div class="det-item"><span class="di-main"><i class="bi bi-folder2-open"></i> ' + esc(d.title) + '</span>' +
        '<span class="di-meta"><a href="' + esc(d.drive_url) + '" target="_blank" rel="noopener">פתח בדרייב ↗</a></span></div>').join('') +
      '</div>';
  }

  // ── חלון הניהול ──
  // owner = {kind:'staff', id, name, folders:[{drive_id,title,drive_url}]} — לתיק אישי של צוות.
  // אותו מנגנון בדיוק; רק פרמטר ההרשאה משתנה (staffId במקום studentId), וההרשאה
  // בצד-שרת נבדקת מול טבלת staff שמוגבלת למנהל.
  async function openManager(student, onChange, owner) {
    if (!window.sb) { window.UI.toast('ניהול קבצים זמין רק במערכת החיה', 'err'); return; }
    const isStaff = !!(owner && owner.kind === 'staff');
    const idParam = isStaff ? 'staffId' : 'studentId';
    const ownerId = isStaff ? owner.id : student.id;
    const idArg = () => { const o = {}; o[idParam] = ownerId; return o; };
    const folderRows = isStaff ? (owner.folders || []) : await forStudent(student.id);
    const name = isStaff ? (owner.name || '')
      : (window.UI && window.UI.fullName ? window.UI.fullName(student) : (student.name || ''));

    const body =
      '<div id="sdWrap">' +
        '<div class="tl-note" style="font-size:.82rem;margin-bottom:8px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
          '<span><i class="bi bi-google"></i> הקבצים נשמרים ישירות ב' + (isStaff ? 'תיק האישי' : 'תיקיית התלמיד') + ' ב<b>גוגל דרייב</b>.</span>' +
          folderRows.filter(f => f.drive_url).map(f =>
            '<a href="' + esc(f.drive_url) + '" target="_blank" rel="noopener">' +
            '<i class="bi bi-box-arrow-up-left"></i> פתח את ' + esc(f.title) + ' בדרייב</a>').join('') +
        '</div>' +
        '<div id="sdChips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px"></div>' +
        '<div class="qr-grid" style="grid-template-columns:1fr 1fr auto;gap:6px;margin:6px 0;align-items:end">' +
          '<label class="fld"><span>קטגוריה</span><select class="inp mb0" id="sdKind">' +
            KINDS.map(k => '<option>' + esc(k) + '</option>').join('') + '</select></label>' +
          '<label class="fld"><span>לאיזו תיקייה</span><select class="inp mb0" id="sdTarget"></select></label>' +
          '<button class="btn-primary sm" id="sdPick"><i class="bi bi-upload"></i> העלאה לדרייב</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:6px"><button class="btn-ghost sm" id="sdMkdir"><i class="bi bi-folder-plus"></i> תיקייה חדשה</button>' +
          '<button class="btn-ghost sm" id="sdReload"><i class="bi bi-arrow-clockwise"></i> רענון</button>' +
          '<label class="cb" style="margin-inline-start:auto"><input type="checkbox" id="sdAll"> הצג גם קבצים כלליים</label></div>' +
        '<input type="file" id="sdFile" multiple style="display:none">' +
        '<div id="sdMsg" class="tl-note" style="min-height:1.1em;font-size:.82rem"></div>' +
        '<div id="sdJunkNote" class="tl-note" style="font-size:.78rem;color:#92400e"></div>' +
        '<div id="sdList"><div class="ld"><i class="bi bi-hourglass-split"></i> טוען מהדרייב…</div></div>' +
      '</div>';

    const m = window.UI.modal({ title: (isStaff ? 'תיק אישי — ' : 'תיק מסמכים — ') + esc(name), bodyHTML: body });
    m.el.classList.add('modal-wide');
    const el = m.el;
    const msg = t => { const e = el.querySelector('#sdMsg'); if (e) e.innerHTML = t || ''; };
    let files = [], folders = [], hiddenJunk = 0;

    const folderTitle = id => {
      const r = folderRows.find(x => x.drive_id === id);
      if (r) return r.title;
      const f = files.find(x => x.id === id);
      return f ? f.name : 'תיקייה';
    };

    async function load() {
      try {
        const d = await callJson('list', idArg());
        const showAll = !!(el.querySelector('#sdAll') && el.querySelector('#sdAll').checked);
        const raw = (d.files || []).filter(f => f.mimeType !== FOLDER_MIME);
        hiddenJunk = raw.filter(isJunk).length;
        files = showAll ? raw : raw.filter(f => !isJunk(f));
        folders = d.folders || [];
        const subs = (d.files || []).filter(f => f.mimeType === FOLDER_MIME);
        // בורר יעד ההעלאה: התיקיות הראשיות + תיקיות המשנה שנוצרו בתוכן
        el.querySelector('#sdTarget').innerHTML =
          folderRows.map(r => '<option value="' + esc(r.drive_id) + '">' + esc(r.title) + '</option>').join('') +
          subs.map(f => '<option value="' + esc(f.id) + '">↳ ' + esc(f.name) + '</option>').join('');
        draw(subs);
      } catch (e) {
        el.querySelector('#sdList').innerHTML = '<div class="tl-note" style="color:#b91c1c;padding:10px">' + esc(e.message || e) + '</div>';
      }
    }

    function draw(subs) {
      el.querySelector('#sdChips').innerHTML = isStaff ? '' : NEED.map(k => {
        const has = files.some(f => classify(f.name) === k);
        return '<span class="det-badge" style="background:' + (has ? '#dcfce7' : '#fee2e2') + ';color:' + (has ? '#166534' : '#991b1b') + '">' +
          (has ? '✓ ' : '✗ ') + esc(k) + '</span>';
      }).join('');

      const jn = el.querySelector('#sdJunkNote');
      if (jn) jn.textContent = hiddenJunk ? ('הוסתרו ' + hiddenJunk + ' קבצים כלליים שאינם שייכים לתלמיד') : '';
      if (!files.length && !(subs || []).length) {
        el.querySelector('#sdList').innerHTML = '<div class="empty-state"><i class="bi bi-folder2-open"></i><div>אין קבצים בתיקיות הדרייב של התלמיד</div></div>';
        return;
      }
      const byFolder = {};
      (subs || []).forEach(f => { (byFolder[f.folderId] = byFolder[f.folderId] || { subs: [], files: [] }).subs.push(f); });
      files.forEach(f => { (byFolder[f.folderId] = byFolder[f.folderId] || { subs: [], files: [] }).files.push(f); });

      // סדר קבוע: בתוך כל תיקייה — לפי סדר הקטגוריות (ויתור סודיות ראשון,
      // "אחר" אחרון) ואז לפי שם. תיקיות ממוספרות ("1. ויתור סודיות") ממוינות
      // לפי המספר, כך שהמבנה החדש בדרייב מוצג בדיוק בסדר שבו בנו אותו.
      const catOrder = k => { const i = KINDS.indexOf(k); return i < 0 ? 98 : i; };
      const numOf = t => { const m = /^(\d+)\s*\./.exec(String(t || '')); return m ? +m[1] : 999; };
      Object.keys(byFolder).forEach(fid => {
        byFolder[fid].files.sort((a, b) =>
          (catOrder(classify(a.name)) - catOrder(classify(b.name))) ||
          String(a.name).localeCompare(String(b.name), 'he'));
        byFolder[fid].subs.sort((a, b) =>
          (numOf(a.name) - numOf(b.name)) || String(a.name).localeCompare(String(b.name), 'he'));
      });
      const order = Object.keys(byFolder).sort((a, b) => {
        const ta = folderTitle(a), tb = folderTitle(b);
        return (numOf(ta) - numOf(tb)) || String(ta).localeCompare(String(tb), 'he');
      });

      el.querySelector('#sdList').innerHTML = order.map(fid => {
        const g = byFolder[fid];
        const subRows = g.subs.map(f =>
          '<div class="tl-item"><i class="bi bi-folder" style="color:var(--muted)"></i>' +
          '<div class="tl-main">' + esc(f.name) + '<div class="tl-note" style="font-size:.76rem">תיקייה</div></div>' +
          '<a class="mini" href="' + esc(f.webViewLink || '#') + '" target="_blank" rel="noopener" title="פתח בדרייב"><i class="bi bi-box-arrow-up-left"></i></a>' +
          '<button class="mini danger" data-del="' + esc(f.id) + '" data-name="' + esc(f.name) + '" title="מחיקה"><i class="bi bi-trash"></i></button></div>').join('');
        const rows = g.files.map(f =>
          '<div class="tl-item">' +
            '<i class="bi ' + icon(f.mimeType, f.name) + '" style="font-size:1.05rem;color:var(--muted)"></i>' +
            '<div class="tl-main">' + esc(f.name) +
              '<div class="tl-note" style="font-size:.76rem">' + esc(classify(f.name)) + (f.size ? ' · ' + kb(f.size) : '') +
              (f.modifiedTime ? ' · ' + esc(String(f.modifiedTime).slice(0, 10)) : '') + '</div></div>' +
            '<button class="mini" data-view="' + esc(f.id) + '" data-name="' + esc(f.name) + '" data-link="' + esc(f.webViewLink || '') + '" title="תצוגה מקדימה"><i class="bi bi-eye"></i></button>' +
            '<button class="mini" data-dl="' + esc(f.id) + '" data-name="' + esc(f.name) + '" title="הורדה"><i class="bi bi-download"></i></button>' +
            '<a class="mini" href="' + esc(f.webViewLink || '#') + '" target="_blank" rel="noopener" title="פתח בדרייב"><i class="bi bi-box-arrow-up-left"></i></a>' +
            '<button class="mini danger" data-del="' + esc(f.id) + '" data-name="' + esc(f.name) + '" title="מחיקה"><i class="bi bi-trash"></i></button>' +
          '</div>').join('');
        return '<div class="det-sec"><h4><i class="bi bi-folder2-open"></i> ' + esc(folderTitle(fid)) +
          ' <span class="det-badge">' + g.files.length + '</span></h4>' + subRows + rows + '</div>';
      }).join('');
      wire();
    }

    // הקובץ חוזר כ-base64 בתוך JSON (נטפרי חוסם גוף בינארי — ראה הערה ב-Edge Function),
    // ולכן מרכיבים אותו כאן בחזרה ל-Blob עם ה-mime המקורי.
    async function grab(id, forPreview) {
      const d = await callJson(forPreview ? 'preview' : 'download', Object.assign(idArg(), { fileId: id }));
      const bin = atob(d.dataB64 || '');
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return { blob: new Blob([buf], { type: d.mimeType || 'application/octet-stream' }), name: d.name };
    }
    // ── תצוגה מקדימה בתוך המערכת ──
    // PDF/תמונה/טקסט מוצגים כמו שהם; Word/Excel/PowerPoint מומרים ל-PDF בצד-שרת
    // (ראה toPdfIfOffice ב-Edge Function), כדי שלא יהיה צריך לצאת לדרייב בשביל להציץ.
    async function preview(id, nm, link) {
      const pm = window.UI.modal({
        title: 'תצוגה מקדימה — ' + esc(nm),
        bodyHTML: '<div id="pvBody" style="min-height:320px;display:flex;align-items:center;justify-content:center">' +
          '<div class="ld"><i class="bi bi-hourglass-split"></i> טוען…</div></div>' +
          '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button class="btn-primary sm" id="pvDl"><i class="bi bi-download"></i> הורדה</button>' +
            (link ? '<a class="btn-ghost sm" href="' + esc(link) + '" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-left"></i> פתח בדרייב</a>' : '') +
          '</div>',
      });
      pm.el.classList.add('modal-wide');
      const host = pm.el.querySelector('#pvBody');
      let url = null;
      try {
        const got = await grab(id, true);
        url = URL.createObjectURL(got.blob);
        const t = String(got.blob.type || '');
        if (t.indexOf('pdf') > -1) {
          host.innerHTML = '<iframe src="' + url + '" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:10px"></iframe>';
        } else if (t.indexOf('image') > -1) {
          host.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:70vh;border-radius:10px">';
        } else if (t.indexOf('text') > -1 || t.indexOf('json') > -1 || t.indexOf('csv') > -1) {
          const txt = await got.blob.text();
          host.innerHTML = '<pre style="white-space:pre-wrap;max-height:70vh;overflow:auto;width:100%;text-align:start;direction:rtl;font-size:.85rem">' + esc(txt.slice(0, 20000)) + '</pre>';
        } else {
          host.innerHTML = '<div class="empty-state"><i class="bi bi-file-earmark"></i>' +
            '<div>אין תצוגה מקדימה לפורמט הזה — אפשר להוריד או לפתוח בדרייב</div></div>';
        }
        const dl = pm.el.querySelector('#pvDl');
        dl.addEventListener('click', () => {
          const a = document.createElement('a'); a.href = url; a.download = got.name || nm; a.click();
        });
      } catch (e) {
        host.innerHTML = '<div class="tl-note" style="color:#b91c1c">' + esc(e.message || e) + '</div>';
      }
      // משחררים את ה-blob כשסוגרים, כדי לא לצבור זיכרון בכרטיסים ארוכים
      const origClose = pm.close;
      pm.el.querySelector('.modal-x').addEventListener('click', () => { if (url) URL.revokeObjectURL(url); });
    }

    function wire() {
      el.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () =>
        preview(b.dataset.view, b.dataset.name, b.dataset.link || '')));
      el.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', async () => {
        try {
          msg('מוריד…');
          const got = await grab(b.dataset.dl);
          const url = URL.createObjectURL(got.blob);
          const a = document.createElement('a'); a.href = url; a.download = got.name || b.dataset.name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          msg('');
        } catch (e) { msg('<span style="color:#b91c1c">' + esc(e.message || e) + '</span>'); }
      }));
      el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        if (!await window.UI.confirm('להעביר את "' + esc(b.dataset.name) + '" לפח האשפה של הדרייב?')) return;
        try {
          msg('מוחק…');
          await callJson('delete', Object.assign(idArg(), { fileId: b.dataset.del }));
          msg('נמחק (נמצא בפח האשפה של הדרייב).');
          await load(); if (onChange) onChange();
        } catch (e) { msg('<span style="color:#b91c1c">' + esc(e.message || e) + '</span>'); }
      }));
    }

    // ── העלאה ──
    const fileInput = el.querySelector('#sdFile');
    el.querySelector('#sdPick').addEventListener('click', () => {
      if (!folderRows.length) { msg('<span style="color:#b91c1c">אין לתלמיד תיקייה בדרייב</span>'); return; }
      fileInput.click();
    });
    fileInput.addEventListener('change', async () => {
      const list = [...fileInput.files]; fileInput.value = '';
      if (!list.length) return;
      const kind = el.querySelector('#sdKind').value;
      const target = el.querySelector('#sdTarget').value;
      const rule = KIND_RULES.find(r => r[0] === kind);
      let ok = 0; const bad = [];
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        msg('מעלה לדרייב ' + (i + 1) + ' מתוך ' + list.length + '…');
        if (f.size > MAX_MB * 1048576) { bad.push(f.name + ' (מעל ' + MAX_MB + 'MB)'); continue; }
        // אם השם לא מסגיר את הקטגוריה, מקדימים אותה — כך גם בדרייב עצמו רואים מה זה
        const nm = (rule && !rule[1].test(f.name)) ? (kind + ' - ' + f.name) : f.name;
        try {
          await callJson('upload', Object.assign(idArg(), { folderId: target, name: nm }), f, f.type || 'application/octet-stream');
          ok++;
        } catch (e) { bad.push(f.name + ' — ' + (e.message || e)); }
      }
      await load(); if (onChange) onChange();
      msg((ok ? '✓ הועלו ' + ok + ' לדרייב. ' : '') + (bad.length ? '<span style="color:#b91c1c">נכשלו: ' + esc(bad.join(' | ')) + '</span>' : ''));
    });

    el.querySelector('#sdMkdir').addEventListener('click', async () => {
      const nm = prompt('שם התיקייה החדשה בתוך תיקיית התלמיד:');
      if (!nm || !nm.trim()) return;
      try {
        msg('יוצר תיקייה…');
        await callJson('mkdir', Object.assign(idArg(), { folderId: folderRows[0] && folderRows[0].drive_id, name: nm.trim() }));
        msg('נוצרה תיקייה.');
        await load();
      } catch (e) { msg('<span style="color:#b91c1c">' + esc(e.message || e) + '</span>'); }
    });
    el.querySelector('#sdReload').addEventListener('click', () => { msg(''); load(); });
    el.querySelector('#sdAll').addEventListener('change', () => { msg(''); load(); });

    load();
  }

  // ── סריקת תיק לצורך דוחות ──────────────────────────────────────────────
  // רשומות student_docs מחזיקות רק את *התיקיות*, לא את הקבצים. לכן דוח
  // "מה קיים ומה חסר" חייב לשאול את הדרייב עצמו. מסננים את הזבל, מסווגים
  // לפי שם, ומחזירים אילו מסמכי חובה נמצאו. תוצאה נשמרת לזיכרון הדף.
  const _scan = {};
  async function scanStudent(sid) {
    if (_scan[sid]) return _scan[sid];
    try {
      const d = await callJson('list', { studentId: sid });
      const files = (d.files || []).filter(f => f.mimeType !== FOLDER_MIME && !isJunk(f));
      const kinds = {};
      files.forEach(f => { kinds[classify(f.name)] = (kinds[classify(f.name)] || 0) + 1; });
      _scan[sid] = { ok: true, total: files.length, kinds: kinds };
    } catch (e) {
      _scan[sid] = { ok: false, total: 0, kinds: {}, error: e.message || String(e) };
    }
    return _scan[sid];
  }

  window.cv3StudentDocs = { forStudent, cardSection, openManager, KINDS, classify, NEED, scanStudent };
})();
