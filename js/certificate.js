// certificate.js — אישור לימודים להדפסה (הוספה 2026-08-17, בקשת עמנואל).
// עוצב לפי התבנית הרשמית של בית התלמוד: בס"ד, תאריך(עברי+לועזי), כותרת,
// "הרינו מאשרים שהתלמיד: [שם] ת.ז. [מספר] לומד במוסדנו החל מתאריך [תאריך]",
// בברכה / מזכירות [מוסד] / סמל מוסד. רק שם/ת"ז/תאריך משתנים לפי התלמיד.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isAdmin = () => !!(window.currentUser && window.currentUser.role === 'מנהל');
  const instName = () => (window.CV3 && window.CV3.INSTANCE_NAME) || 'המוסד';

  async function getSettings() {
    const l = await window.store.list('institution_settings');
    return (l && l[0]) || { id: 1, stamp_x: 30, stamp_y: 74, stamp_size: 120 };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hebLine(d) {
    let wd = '', heb = '';
    try { wd = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(d); } catch (_) {}
    try { heb = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch (_) {}
    const greg = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    return (wd ? wd + ' ' : '') + (heb ? heb + '  ' : '') + greg;
  }
  function acadStart() { const d = new Date(); const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear(); return '01/09/' + y; }

  // חותמת ברירת-מחדל אם לא הועלתה
  function defaultStamp() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="130" height="130" viewBox="0 0 130 130">' +
      '<circle cx="65" cy="65" r="60" fill="none" stroke="#1a4d8f" stroke-width="3"/>' +
      '<circle cx="65" cy="65" r="50" fill="none" stroke="#1a4d8f" stroke-width="1.5"/>' +
      '<text x="65" y="62" text-anchor="middle" font-family="Arial" font-size="12" fill="#1a4d8f" font-weight="bold">' + esc(instName().slice(0, 16)) + '</text>' +
      '<text x="65" y="80" text-anchor="middle" font-family="Arial" font-size="9" fill="#1a4d8f">אישור רשמי</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function certHtml(student, opts, st) {
    const stampImg = st.stamp_data ? '<img class="stamp" src="' + st.stamp_data + '" alt="חותמת">' : '';
    const full = window.UI.fullName(student);
    const bg = st.letterhead_data ? 'background-image:url(' + st.letterhead_data + ');background-size:100% 100%;background-repeat:no-repeat;' : '';
    const sym = st.moses_symbol ? '<div class="sym">סמל מוסד ' + esc(st.moses_symbol) + '</div>' : '';
    return '<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>אישור לימודים</title>' +
      '<style>@page{size:A4;margin:0}*{box-sizing:border-box}' +
      'body{margin:0;font-family:"David","Narkisim","Times New Roman",serif;color:#111}' +
      '.page{position:relative;width:210mm;height:297mm;padding:' + (st.letterhead_data ? '54mm 28mm 34mm' : '32mm 28mm') + ';' + bg + '}' +
      (st.letterhead_data ? '' : '.hdr{text-align:center;margin-bottom:8mm}.hdr h1{font-size:26pt;color:#1a4d8f;margin:0}') +
      '.bsd{text-align:center;font-size:13pt;margin-bottom:5mm}' +
      '.date{text-align:left;font-size:13pt;margin-bottom:14mm}' +
      '.title{text-align:center;font-size:27pt;font-weight:bold;text-decoration:underline;margin:6mm 0 16mm}' +
      '.body{font-size:17pt;line-height:2.5;text-align:center}.body .nm{font-weight:bold}' +
      '.sign{margin-top:20mm;text-align:center;font-size:14pt;line-height:1.9}.sym{margin-top:3mm;font-size:12pt;color:#333}' +
      '.stamp{position:absolute;left:' + (st.stamp_x || 30) + '%;top:' + (st.stamp_y || 74) + '%;transform:translate(-50%,-50%);width:' + (st.stamp_size || 120) + 'px;height:auto}' +
      '@media print{.noprint{display:none}}.noprint{position:fixed;top:8px;left:8px;background:#1a4d8f;color:#fff;border:0;padding:8px 16px;border-radius:6px;font-size:14px;cursor:pointer}' +
      '</style></head><body>' +
      '<button class="noprint" onclick="window.print()">🖨️ הדפסה</button>' +
      '<div class="page">' +
      (st.letterhead_data ? '' : '<div class="hdr"><h1>' + esc(instName()) + '</h1></div>') +
      '<div class="bsd">בס"ד</div>' +
      '<div class="date">' + esc(opts.issueDate) + '</div>' +
      '<div class="title">אישור לימודים</div>' +
      '<div class="body">הרינו מאשרים שהתלמיד: <span class="nm">' + esc(full) + '</span>' +
      (student.tz ? ' &nbsp;&nbsp; ת.ז. <span class="nm">' + esc(student.tz) + '</span>' : '') + '<br>' +
      'לומד במוסדנו החל מתאריך <span class="nm">' + esc(opts.from) + '</span></div>' +
      '<div class="sign">בברכה,<br>מזכירות ' + esc(instName()) + sym + '</div>' +
      stampImg +
      '</div></body></html>';
  }

  async function openCertificate(student) {
    const st = await getSettings();
    const today = new Date();
    const iso = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    const body = '<div class="form-grid">' +
      '<label class="fld"><span>תלמיד</span><input class="inp mb0" value="' + esc(window.UI.fullName(student)) + '" readonly></label>' +
      '<label class="fld"><span>תעודת זהות</span><input class="inp mb0" id="ct_tz" value="' + esc(student.tz || '') + '"></label>' +
      '<label class="fld"><span>תאריך האישור</span><input type="date" class="inp mb0" id="ct_issue" value="' + iso + '"></label>' +
      '<label class="fld"><span>לומד החל מתאריך</span><input class="inp mb0" id="ct_from" value="' + esc(st.cert_from || acadStart()) + '"></label>' +
      '</div>' +
      (isAdmin() ? '<button class="btn-ghost sm" id="ct_settings" style="margin-top:8px"><i class="bi bi-gear"></i> חותמת / בלנק / מיקום / סמל מוסד</button>' : '');
    window.UI.modal({
      title: 'אישור לימודים', bodyHTML: body, saveLabel: 'הדפסה / תצוגה',
      onSave: (m) => {
        const iv = m.querySelector('#ct_issue').value;
        const d = iv ? new Date(iv + 'T00:00:00') : new Date();
        const opts = { issueDate: hebLine(d), from: m.querySelector('#ct_from').value.trim() };
        const stud = Object.assign({}, student, { tz: m.querySelector('#ct_tz').value.trim() });
        const w = window.open('', '_blank');
        if (!w) { window.UI.toast('חלון קופץ נחסם — אפשר חלונות קופצים לאתר', 'err'); return false; }
        w.document.open(); w.document.write(certHtml(stud, opts, st)); w.document.close();
        return true;
      },
    });
    setTimeout(() => { const b = document.querySelector('#ct_settings'); if (b) b.addEventListener('click', () => openSettings()); }, 60);
  }

  // ── הגדרות מוסד: חותמת/בלנק/מיקום/סמל (מנהל) ──
  async function openSettings() {
    const st = await getSettings();
    let stampData = st.stamp_data || '', letterData = st.letterhead_data || '';
    let x = st.stamp_x || 30, ys = st.stamp_y || 74, size = st.stamp_size || 120;
    const body =
      '<div class="cert-set">' +
      '<label class="fld fld-wide"><span>חותמת (תמונה)</span><input type="file" accept="image/*" id="cs_stamp" class="inp mb0"></label>' +
      '<label class="fld fld-wide"><span>בלנק / רקע (תמונה מלאה A4)</span><input type="file" accept="image/*" id="cs_letter" class="inp mb0"></label>' +
      '<label class="fld"><span>סמל מוסד</span><input class="inp mb0" id="cs_sym" value="' + esc(st.moses_symbol || '') + '"></label>' +
      '<label class="fld"><span>"החל מתאריך" ברירת מחדל</span><input class="inp mb0" id="cs_from" value="' + esc(st.cert_from || acadStart()) + '"></label>' +
      '<label class="fld"><span>מיקום חותמת אופקי (%)</span><input type="range" id="cs_x" min="0" max="100" value="' + x + '"></label>' +
      '<label class="fld"><span>מיקום חותמת אנכי (%)</span><input type="range" id="cs_y" min="0" max="100" value="' + ys + '"></label>' +
      '<label class="fld"><span>גודל חותמת (px)</span><input type="range" id="cs_size" min="60" max="260" value="' + size + '"></label>' +
      '<div id="cs_preview" style="position:relative;border:1px solid var(--line);border-radius:8px;height:230px;overflow:hidden;background:#fff;margin-top:8px"></div>' +
      '</div>';
    window.UI.modal({
      title: 'הגדרות אישור לימודים', bodyHTML: body, saveLabel: 'שמירה',
      onSave: async (m) => {
        const r = await window.store.update('institution_settings', 1, {
          stamp_data: stampData || null, letterhead_data: letterData || null,
          stamp_x: x, stamp_y: ys, stamp_size: size,
          moses_symbol: (m.querySelector('#cs_sym').value || '').trim() || null,
          cert_from: (m.querySelector('#cs_from').value || '').trim() || null,
        });
        if (!r.ok) { window.UI.toast('שגיאה: ' + (r.error || ''), 'err'); return false; }
        window.UI.toast('הגדרות נשמרו'); return true;
      },
    });
    setTimeout(() => {
      const prev = document.querySelector('#cs_preview');
      const draw = () => {
        prev.style.backgroundImage = letterData ? 'url(' + letterData + ')' : 'none';
        prev.style.backgroundSize = '100% 100%';
        prev.innerHTML = '<img src="' + (stampData || defaultStamp()) + '" style="position:absolute;left:' + x + '%;top:' + ys + '%;transform:translate(-50%,-50%);width:' + Math.round(size * 0.7) + 'px">';
      };
      const readFile = (input, cb) => { const f = input.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => cb(rd.result); rd.readAsDataURL(f); };
      document.querySelector('#cs_stamp').addEventListener('change', e => readFile(e.target, d => { stampData = d; draw(); }));
      document.querySelector('#cs_letter').addEventListener('change', e => readFile(e.target, d => { letterData = d; draw(); }));
      document.querySelector('#cs_x').addEventListener('input', e => { x = +e.target.value; draw(); });
      document.querySelector('#cs_y').addEventListener('input', e => { ys = +e.target.value; draw(); });
      document.querySelector('#cs_size').addEventListener('input', e => { size = +e.target.value; draw(); });
      draw();
    }, 60);
  }

  window.cv3Cert = { openCertificate, openSettings };
})();
