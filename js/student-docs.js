// student-docs.js — "תיק המסמכים" של התלמיד (2026-08-20, בקשת יוסף מתוך אפיון "תיק תל"א").
//
// עד היום לא היתה שום דרך לצרף קובץ לתלמיד. כאן: העלאה / צפייה / הורדה / מחיקה,
// חלוקה לקטגוריות האפיון ולתיקיות משנה, ולצידן קישור לתיקיות שכבר קיימות בגוגל דרייב.
//
// אחסון: bucket **פרטי** `student-docs` ב-Supabase (לא דרייב) — עובר נטפרי, ומוגן
// באותו RLS של הכרטיס (מנהל, או מי שיש לו גישה לכיתת התלמיד). מוסכמת נתיב:
// `{student_id}/{אקראי}-{שם הקובץ}` — התיקייה הראשונה היא מזהה התלמיד, וכך ה-policy
// על storage.objects יכול לאכוף הרשאה גם על הקובץ עצמו ולא רק על שורת המטא-דאטה.
// ההורדה תמיד דרך ה-API של Supabase (blob) ולא בקישור חיצוני — נטפרי חוסם את השני.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BUCKET = 'student-docs';
  const MAX_MB = 25;
  const DRIVE_KIND = 'תיקיית דרייב';
  // ארבע הקטגוריות מהאפיון + כללי
  const KINDS = ['ויתור סודיות', 'מסמך קביל', 'שאלון הפניה', 'אבחונים ורקע קודם', 'תעודות ומסמכי זהות', 'אחר'];

  const isAdmin = () => !!(window.currentUser && window.currentUser.role === 'מנהל');
  const sb = () => window.sb;

  function icon(mime, title) {
    const t = String(title || '').toLowerCase(), m = String(mime || '');
    if (m.indexOf('folder') > -1) return 'bi-folder2-open';
    if (m.indexOf('pdf') > -1 || /\.pdf$/.test(t)) return 'bi-file-earmark-pdf';
    if (m.indexOf('image') > -1 || /\.(png|jpe?g|gif|webp|heic)$/.test(t)) return 'bi-file-earmark-image';
    if (m.indexOf('word') > -1 || /\.docx?$/.test(t)) return 'bi-file-earmark-word';
    if (m.indexOf('sheet') > -1 || /\.xlsx?$/.test(t)) return 'bi-file-earmark-spreadsheet';
    return 'bi-file-earmark';
  }
  const kb = n => !n ? '' : (n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  // מפתח האובייקט ב-Supabase Storage מוגבל ל-ASCII — שם קובץ בעברית מוחזר עם
  // "Invalid key". לכן הנתיב מנוקה ל-ASCII בלבד, והשם המקורי (עברית וכל השאר)
  // נשמר בעמודה title — זה מה שמוצג למשתמש וזה שם הקובץ בהורדה.
  function safeKey(n) {
    const name = String(n || 'file');
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) : '';
    let base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 60);
    if (!base) base = 'file';
    return base + (ext ? '.' + ext : '');
  }

  async function forStudent(sid) {
    const rows = await window.store.byStudent('student_docs', sid);
    return (rows || []).slice().sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || a.id - b.id);
  }

  // ── סקשן בכרטיס התלמיד: מה יש ומה חסר מתוך רשימת האפיון ──
  function cardSection(docs) {
    docs = docs || [];
    const files = docs.filter(d => d.source !== 'drive');
    const drive = docs.filter(d => d.source === 'drive');
    const need = KINDS.slice(0, 4);
    const chips = need.map(k => {
      const has = files.some(d => d.kind === k);
      return '<span class="det-badge" style="background:' + (has ? '#dcfce7' : '#fee2e2') + ';color:' + (has ? '#166534' : '#991b1b') + '">' +
        (has ? '✓ ' : '✗ ') + esc(k) + '</span>';
    }).join(' ');
    return '<div class="det-sec"><h4><i class="bi bi-folder2-open"></i> תיק מסמכים ' +
      '<span class="det-badge">' + files.length + ' קבצים</span>' +
      (drive.length ? '<span class="det-badge">' + drive.length + ' בדרייב</span>' : '') + '</h4>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:2px 0 6px">' + chips + '</div>' +
      (files.length ? files.slice(0, 4).map(d =>
        '<div class="det-item"><span class="di-main"><i class="bi ' + icon(d.mime, d.title) + '"></i> ' + esc(d.title) + '</span>' +
        '<span class="di-meta">' + esc(d.kind) + '</span></div>').join('') : '') +
      '</div>';
  }

  // ── חלון הניהול המלא ──
  async function openManager(student, onChange) {
    if (!sb()) { window.UI.toast('ניהול קבצים זמין רק במערכת החיה', 'err'); return; }
    let docs = await forStudent(student.id);
    const name = window.UI && window.UI.fullName ? window.UI.fullName(student) : (student.name || '');

    const body =
      '<div id="sdWrap">' +
        '<div id="sdDrive"></div>' +
        '<div class="qr-grid" style="grid-template-columns:1fr 1fr auto;gap:6px;margin:10px 0 4px;align-items:end">' +
          '<label class="fld"><span>קטגוריה</span><select class="inp mb0" id="sdKind">' +
            KINDS.map(k => '<option>' + esc(k) + '</option>').join('') + '</select></label>' +
          '<label class="fld"><span>תיקייה (רשות)</span><input class="inp mb0" id="sdFolder" list="sdFolders" placeholder="ללא"></label>' +
          '<button class="btn-primary sm" id="sdPick"><i class="bi bi-upload"></i> העלאת קבצים</button>' +
        '</div>' +
        '<datalist id="sdFolders"></datalist>' +
        '<input type="file" id="sdFile" multiple style="display:none">' +
        '<div id="sdMsg" class="tl-note" style="min-height:1.1em;font-size:.82rem"></div>' +
        '<div id="sdList"></div>' +
      '</div>';

    const m = window.UI.modal({ title: 'תיק מסמכים — ' + esc(name), bodyHTML: body, saveLabel: null });
    m.el.classList.add('modal-wide');
    const el = m.el;
    const msg = t => { el.querySelector('#sdMsg').innerHTML = t || ''; };

    function draw() {
      const drive = docs.filter(d => d.source === 'drive');
      const files = docs.filter(d => d.source !== 'drive');
      el.querySelector('#sdDrive').innerHTML = drive.length
        ? '<div class="det-sec" style="margin:0"><h4><i class="bi bi-google"></i> תיקיות בדרייב על שם התלמיד</h4>' +
          drive.map(d => '<div class="det-item"><span class="di-main"><i class="bi bi-folder2-open"></i> ' + esc(d.title) + '</span>' +
            '<span class="di-meta"><a href="' + esc(d.drive_url) + '" target="_blank" rel="noopener">פתח בדרייב ↗</a></span></div>').join('') +
          '</div>'
        : '';
      const folders = [...new Set(files.map(d => d.folder).filter(Boolean))];
      el.querySelector('#sdFolders').innerHTML = folders.map(f => '<option value="' + esc(f) + '">').join('');

      if (!files.length) {
        el.querySelector('#sdList').innerHTML = '<div class="empty-state"><i class="bi bi-folder2-open"></i><div>אין עדיין קבצים בתיק</div></div>';
        return;
      }
      // קיבוץ: תיקייה ← קטגוריה
      const groups = {};
      files.forEach(d => { const g = d.folder || ''; (groups[g] = groups[g] || []).push(d); });
      el.querySelector('#sdList').innerHTML = Object.keys(groups).sort().map(g => {
        const rows = groups[g].map(d =>
          '<div class="tl-item" data-doc="' + d.id + '">' +
            '<i class="bi ' + icon(d.mime, d.title) + '" style="font-size:1.05rem;color:var(--muted)"></i>' +
            '<div class="tl-main">' + esc(d.title) +
              '<div class="tl-note" style="font-size:.76rem">' + esc(d.kind) + (d.size_bytes ? ' · ' + kb(d.size_bytes) : '') +
              (d.created_at ? ' · ' + esc(String(d.created_at).slice(0, 10)) : '') + '</div></div>' +
            '<button class="mini" data-view="' + d.id + '" title="צפייה"><i class="bi bi-eye"></i></button>' +
            '<button class="mini" data-dl="' + d.id + '" title="הורדה"><i class="bi bi-download"></i></button>' +
            '<button class="mini danger" data-del="' + d.id + '" title="מחיקה"><i class="bi bi-trash"></i></button>' +
          '</div>').join('');
        const head = g
          ? '<h4><i class="bi bi-folder"></i> ' + esc(g) + ' <span class="det-badge">' + groups[g].length + '</span>' +
            '<button class="mini danger" data-delfolder="' + esc(g) + '" title="מחיקת התיקייה וכל הקבצים שבה" style="margin-inline-start:6px"><i class="bi bi-trash"></i></button></h4>'
          : '<h4><i class="bi bi-files"></i> כללי <span class="det-badge">' + groups[g].length + '</span></h4>';
        return '<div class="det-sec">' + head + rows + '</div>';
      }).join('');
      wireRows();
    }

    async function refresh() { docs = await forStudent(student.id); draw(); if (onChange) onChange(); }

    // ── הורדה/צפייה: תמיד blob דרך ה-API (קישור חיצוני נחסם ע"י נטפרי) ──
    async function fetchBlob(d) {
      const { data, error } = await sb().storage.from(BUCKET).download(d.path);
      if (error) throw error;
      return data;
    }
    async function view(d) {
      try {
        msg('פותח…');
        const blob = await fetchBlob(d);
        const url = URL.createObjectURL(blob);
        const w = window.open(url, '_blank');
        if (!w) {   // חוסם חלונות קופצים — נופלים להורדה במקום להשאיר את המשתמש בלי כלום
          const a = document.createElement('a'); a.href = url; a.download = d.title; a.click();
          msg('הדפדפן חסם חלון חדש — הקובץ ירד למחשב.');
        } else { msg(''); }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) { msg('<span style="color:#b91c1c">שגיאה בפתיחה: ' + esc(e.message || e) + '</span>'); }
    }
    async function download(d) {
      try {
        msg('מוריד…');
        const blob = await fetchBlob(d);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = d.title; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        msg('');
      } catch (e) { msg('<span style="color:#b91c1c">שגיאה בהורדה: ' + esc(e.message || e) + '</span>'); }
    }
    // מוחקים קודם את שורת המטא-דאטה (עם אימות שה-RLS לא חסם בשקט) ורק אז את הקובץ:
    // ההפך היה משאיר שורה שמצביעה על קובץ שכבר לא קיים.
    async function removeDoc(d, silent) {
      const { data, error } = await sb().from('student_docs').delete().eq('id', d.id).select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('אין הרשאה למחוק מסמך זה (מנהל או מי שהעלה אותו)');
      if (d.path) { try { await sb().storage.from(BUCKET).remove([d.path]); } catch (_) { /* השורה כבר ירדה */ } }
      if (!silent) msg('נמחק.');
    }

    function wireRows() {
      el.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
        const d = docs.find(x => String(x.id) === b.dataset.view); if (d) view(d);
      }));
      el.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', () => {
        const d = docs.find(x => String(x.id) === b.dataset.dl); if (d) download(d);
      }));
      el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const d = docs.find(x => String(x.id) === b.dataset.del); if (!d) return;
        if (!await window.UI.confirm('למחוק לצמיתות את "' + esc(d.title) + '"?')) return;
        try { await removeDoc(d); await refresh(); }
        catch (e) { msg('<span style="color:#b91c1c">' + esc(e.message || e) + '</span>'); }
      }));
      el.querySelectorAll('[data-delfolder]').forEach(b => b.addEventListener('click', async () => {
        const g = b.dataset.delfolder;
        const inFolder = docs.filter(d => d.source !== 'drive' && (d.folder || '') === g);
        if (!await window.UI.confirm('למחוק את התיקייה "' + esc(g) + '" ואת ' + inFolder.length + ' הקבצים שבה? הפעולה אינה הפיכה.')) return;
        let failed = 0;
        for (const d of inFolder) { try { await removeDoc(d, true); } catch (_) { failed++; } }
        await refresh();
        msg(failed ? '<span style="color:#b91c1c">' + failed + ' קבצים לא נמחקו (אין הרשאה)</span>' : 'התיקייה נמחקה.');
      }));
    }

    // ── העלאה ──
    const fileInput = el.querySelector('#sdFile');
    el.querySelector('#sdPick').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const list = [...fileInput.files];
      fileInput.value = '';
      if (!list.length) return;
      const kind = el.querySelector('#sdKind').value;
      const folder = (el.querySelector('#sdFolder').value || '').trim();
      let ok = 0, bad = [];
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        msg('מעלה ' + (i + 1) + ' מתוך ' + list.length + '…');
        if (f.size > MAX_MB * 1048576) { bad.push(f.name + ' (גדול מ-' + MAX_MB + 'MB)'); continue; }
        const rand = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID().slice(0, 8)
          : Math.floor(Math.random() * 1e9).toString(36);
        const path = student.id + '/' + rand + '-' + safeKey(f.name);
        const up = await sb().storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || undefined });
        if (up.error) { bad.push(f.name + ' — ' + up.error.message); continue; }
        const ins = await sb().from('student_docs').insert({
          student_id: student.id, kind: kind, folder: folder, title: f.name,
          source: 'upload', path: path, mime: f.type || null, size_bytes: f.size,
        }).select('id');
        if (ins.error || !ins.data || !ins.data.length) {
          // הקובץ עלה אבל הרישום נכשל — מנקים כדי לא להשאיר קובץ יתום ב-bucket
          try { await sb().storage.from(BUCKET).remove([path]); } catch (_) {}
          bad.push(f.name + ' — ' + ((ins.error && ins.error.message) || 'הרישום נכשל'));
          continue;
        }
        ok++;
      }
      await refresh();
      msg((ok ? '✓ הועלו ' + ok + ' קבצים. ' : '') +
          (bad.length ? '<span style="color:#b91c1c">נכשלו: ' + esc(bad.join(' | ')) + '</span>' : ''));
    });

    draw();
  }

  window.cv3StudentDocs = { forStudent, cardSection, openManager, KINDS };
})();
