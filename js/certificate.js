// certificate.js — אישור לימודים להדפסה (הוספה 2026-08-17, בקשת עמנואל).
// כפתור בכרטיס תלמיד → אישור עם שם/ת"ז/תאריכים(ניתנים לעריכה)/חותמת/בלנק.
// הגדרות מוסד (חותמת, בלנק, מיקום) ב-institution_settings; העלאה/מיקום = מנהל.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isAdmin = () => !!(window.currentUser && window.currentUser.role === 'מנהל');
  const instName = () => (window.CV3 && window.CV3.INSTANCE_NAME) || 'המוסד';

  async function getSettings() {
    const l = await window.store.list('institution_settings');
    return (l && l[0]) || { id: 1, stamp_x: 72, stamp_y: 80, stamp_size: 130 };
  }
  function hebYear() {
    try { return new Intl.DateTimeFormat('he-u-ca-hebrew', { year: 'numeric' }).format(new Date()).replace(/^ה?תש/, 'תש'); }
    catch (_) { return ''; }
  }

  // חותמת ברירת-מחדל מובנית (SVG) אם לא הועלתה חותמת
  function defaultStamp() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="130" height="130" viewBox="0 0 130 130">' +
      '<circle cx="65" cy="65" r="60" fill="none" stroke="#1a4d8f" stroke-width="3"/>' +
      '<circle cx="65" cy="65" r="50" fill="none" stroke="#1a4d8f" stroke-width="1.5"/>' +
      '<text x="65" y="60" text-anchor="middle" font-family="Arial" font-size="12" fill="#1a4d8f" font-weight="bold">' + esc(instName().slice(0, 16)) + '</text>' +
      '<text x="65" y="78" text-anchor="middle" font-family="Arial" font-size="9" fill="#1a4d8f">אישור רשמי</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function certHtml(student, opts, st) {
    const stampSrc = st.stamp_data || defaultStamp();
    const full = [student.family, student.name].filter(Boolean).join(' ');
    const bg = st.letterhead_data ? 'background-image:url(' + st.letterhead_data + ');background-size:100% 100%;background-repeat:no-repeat;' : '';
    return '<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>אישור לימודים</title>' +
      '<style>@page{size:A4;margin:0}*{box-sizing:border-box}' +
      'body{margin:0;font-family:"David","Times New Roman",serif;color:#1a1a1a}' +
      '.page{position:relative;width:210mm;height:297mm;padding:38mm 26mm;' + bg + '}' +
      '.hdr{text-align:center;margin-bottom:10mm}.hdr h1{font-size:30pt;margin:0;color:#1a4d8f}' +
      '.hdr .sub{font-size:13pt;color:#555;margin-top:2mm}' +
      '.title{text-align:center;font-size:22pt;font-weight:bold;text-decoration:underline;margin:12mm 0}' +
      '.body{font-size:15pt;line-height:2.1;text-align:justify}' +
      '.body b{font-size:16pt}.sign{margin-top:20mm;font-size:13pt}' +
      '.stamp{position:absolute;left:' + (st.stamp_x || 72) + '%;top:' + (st.stamp_y || 80) + '%;transform:translate(-50%,-50%);width:' + (st.stamp_size || 130) + 'px;height:auto}' +
      '@media print{.noprint{display:none}}' +
      '.noprint{position:fixed;top:8px;left:8px;background:#1a4d8f;color:#fff;border:0;padding:8px 16px;border-radius:6px;font-size:14px;cursor:pointer}' +
      '</style></head><body>' +
      '<button class="noprint" onclick="window.print()">🖨️ הדפסה</button>' +
      '<div class="page">' +
      (st.letterhead_data ? '' : '<div class="hdr"><h1>' + esc(instName()) + '</h1><div class="sub">בס"ד</div></div>') +
      '<div class="title">' + esc(st.cert_title || 'אישור לימודים') + '</div>' +
      '<div class="body">הרינו לאשר בזאת כי התלמיד <b>' + esc(full) + '</b>' +
      (student.tz ? ', ת.ז. <b>' + esc(student.tz) + '</b>' : '') + ',<br>' +
      'לומד/ת במוסדנו <b>' + esc(instName()) + '</b>' + (opts.year ? ' בשנת הלימודים <b>' + esc(opts.year) + '</b>' : '') + ',<br>' +
      'מתאריך <b>' + esc(opts.from) + '</b> ועד <b>' + esc(opts.to) + '</b>.<br><br>' +
      'אישור זה ניתן לבקשת ההורים ולכל מטרה חוקית.' +
      '<div class="sign">בברכה,<br>הנהלת ' + esc(instName()) + '</div></div>' +
      '<img class="stamp" src="' + stampSrc + '" alt="חותמת">' +
      '</div></body></html>';
  }

  async function openCertificate(student) {
    const st = await getSettings();
    const y = hebYear();
    const body = '<div class="form-grid">' +
      '<label class="fld"><span>תלמיד</span><input class="inp mb0" value="' + esc([student.family, student.name].filter(Boolean).join(' ')) + '" readonly></label>' +
      '<label class="fld"><span>תעודת זהות</span><input class="inp mb0" id="ct_tz" value="' + esc(student.tz || '') + '"></label>' +
      '<label class="fld"><span>שנת לימודים</span><input class="inp mb0" id="ct_year" value="' + esc(y ? y : '') + '"></label>' +
      '<label class="fld"><span>מתאריך</span><input class="inp mb0" id="ct_from" value="' + esc(y ? ('א׳ תשרי ' + y) : '') + '"></label>' +
      '<label class="fld"><span>עד תאריך</span><input class="inp mb0" id="ct_to" value="' + esc(y ? ('כ״ט אלול ' + y) : '') + '"></label>' +
      '</div>' +
      (isAdmin() ? '<button class="btn-ghost sm" id="ct_settings" style="margin-top:8px"><i class="bi bi-gear"></i> חותמת / בלנק / מיקום</button>' : '');
    window.UI.modal({
      title: 'אישור לימודים', bodyHTML: body, saveLabel: 'הדפסה / תצוגה',
      onSave: (m) => {
        const opts = {
          year: m.querySelector('#ct_year').value.trim(),
          from: m.querySelector('#ct_from').value.trim(),
          to: m.querySelector('#ct_to').value.trim(),
        };
        const s2 = Object.assign({}, st, { /* tz override */ });
        const stud = Object.assign({}, student, { tz: m.querySelector('#ct_tz').value.trim() });
        const w = window.open('', '_blank');
        if (!w) { window.UI.toast('חלון קופץ נחסם — אפשר חלונות קופצים לאתר', 'err'); return false; }
        w.document.open(); w.document.write(certHtml(stud, opts, s2)); w.document.close();
        return true;
      },
    });
    setTimeout(() => { const b = document.querySelector('#ct_settings'); if (b) b.addEventListener('click', () => openSettings()); }, 60);
  }

  // ── הגדרות מוסד: העלאת חותמת/בלנק + מיקום (מנהל) ──
  async function openSettings() {
    const st = await getSettings();
    let stampData = st.stamp_data || '', letterData = st.letterhead_data || '';
    let x = st.stamp_x || 72, ys = st.stamp_y || 80, size = st.stamp_size || 130;
    const body =
      '<div class="cert-set">' +
      '<label class="fld fld-wide"><span>חותמת (תמונה)</span><input type="file" accept="image/*" id="cs_stamp" class="inp mb0"></label>' +
      '<label class="fld fld-wide"><span>בלנק / רקע (תמונה מלאה A4)</span><input type="file" accept="image/*" id="cs_letter" class="inp mb0"></label>' +
      '<label class="fld"><span>מיקום חותמת אופקי (%)</span><input type="range" id="cs_x" min="0" max="100" value="' + x + '"></label>' +
      '<label class="fld"><span>מיקום חותמת אנכי (%)</span><input type="range" id="cs_y" min="0" max="100" value="' + ys + '"></label>' +
      '<label class="fld"><span>גודל חותמת (px)</span><input type="range" id="cs_size" min="60" max="260" value="' + size + '"></label>' +
      '<div id="cs_preview" style="position:relative;border:1px solid var(--line);border-radius:8px;height:220px;overflow:hidden;background:#fff;margin-top:8px"></div>' +
      '</div>';
    window.UI.modal({
      title: 'הגדרות אישור לימודים', bodyHTML: body, saveLabel: 'שמירה',
      onSave: async () => {
        const r = await window.store.update('institution_settings', 1, {
          stamp_data: stampData || null, letterhead_data: letterData || null,
          stamp_x: x, stamp_y: ys, stamp_size: size,
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
        const src = stampData || defaultStamp();
        prev.innerHTML = '<img src="' + src + '" style="position:absolute;left:' + x + '%;top:' + ys + '%;transform:translate(-50%,-50%);width:' + Math.round(size * 0.7) + 'px">';
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
