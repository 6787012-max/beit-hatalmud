// forms.js — טפסים וחתימות הורים. יצירת טופס עשיר (בונה שדות דינמי) → מטריצת תלמיד×סטטוס → קישור אישי/חתימה + מעקב מלא.
// נתונים דרך המאגר המרכזי (store.js). חתימת הורה חיה מתבצעת ב-sign.html (מול Supabase כשמחובר).
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const tok = () => Math.random().toString(36).slice(2, 10);
  const signBase = () => location.href.replace(/[^/]*$/, '') + 'sign.html';

  const TYPES = [
    { v: 'text', t: 'שורת טקסט' },
    { v: 'textarea', t: 'פסקה' },
    { v: 'select', t: 'רשימה נפתחת' },
    { v: 'checkbox', t: 'תיבת סימון' },
    { v: 'question', t: 'שאלה פתוחה' },
    { v: 'signature', t: 'חתימה ידנית' },
  ];
  const typeLabel = v => { const t = TYPES.find(x => x.v === v); return t ? t.t : v; };

  // נירמול מערך השדות מתוך forms.fields (jsonb) — עמיד לטפסים ישנים.
  function parseFields(f) {
    let arr = f && f.fields;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (_) { arr = null; } }
    if (!Array.isArray(arr)) arr = [];
    return arr.filter(x => x && x.label).map((x, i) => ({
      key: x.key || ('f' + i),
      label: String(x.label),
      type: TYPES.some(t => t.v === x.type) ? x.type : 'text',
      options: Array.isArray(x.options) ? x.options : [],
      required: !!x.required,
    }));
  }
  function parseAnswers(r) {
    let a = r && r.answers;
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = null; } }
    return (a && typeof a === 'object') ? a : {};
  }

  async function students() { return window.cv3Students ? await window.cv3Students.getStudents() : []; }
  async function classes() { return window.cv3Students ? await window.cv3Students.getClasses() : []; }

  async function renderForms(page) {
    const [forms, resp, studs, cls] = await Promise.all([
      window.store.list('forms'), window.store.list('form_responses'), students(), classes(),
    ]);
    const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
    const clsOf = id => { const s = studs.find(x => x.id == id); const c = s && cls.find(x => x.id == s.class_id); return c ? c.name : ''; };
    const respOf = fid => resp.filter(r => r.form_id == fid);
    let resp2 = resp;   // הפניה חיה

    function listView() {
      page.innerHTML =
        '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>טפסים וחתימות הורים</h2>' +
        '<div class="head-actions"><button class="btn-primary sm" id="fNew"><i class="bi bi-plus-lg"></i> טופס חדש</button></div></div>' +
        '<div id="formsList"></div>' +
        '<div id="formsEmpty" class="empty-state" hidden><i class="bi bi-file-earmark-check"></i><div>אין טפסים עדיין — צור טופס חדש לשליחה להורים</div></div>';
      drawList();
      page.querySelector('#fNew').addEventListener('click', () => newFormForm());
    }
    function drawList() {
      const rows = forms.slice().reverse();
      page.querySelector('#formsList').innerHTML = rows.map(f => {
        const rs = respOf(f.id), signed = rs.filter(r => r.status === 'signed').length, pct = rs.length ? Math.round(signed / rs.length * 100) : 0;
        return '<div class="qr-card form-card"><div class="card-h-row"><h3><i class="bi bi-file-earmark-text"></i> ' + esc(f.title) + '</h3>' +
          '<span class="det-badge">' + signed + '/' + rs.length + ' נחתמו</span></div>' +
          (f.body ? '<p class="tl-note" style="margin:.2rem 0 .6rem">' + esc(f.body) + '</p>' : '') +
          '<div class="prog"><div class="prog-bar" style="width:' + pct + '%"></div></div>' +
          '<div class="det-actions" style="margin-top:10px">' +
            '<button class="btn-primary sm" data-open="' + f.id + '"><i class="bi bi-table"></i> מעקב וחתימות</button>' +
            '<button class="btn-ghost sm" data-link="' + f.id + '"><i class="bi bi-link-45deg"></i> קישור כללי</button>' +
            '<button class="btn-ghost sm danger" data-del="' + f.id + '"><i class="bi bi-trash"></i> מחיקה</button>' +
          '</div></div>';
      }).join('');
      page.querySelector('#formsEmpty').hidden = forms.length > 0;
      page.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => detailView(forms.find(f => f.id == b.dataset.open))));
      page.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => copyLink(signBase() + '?f=' + b.dataset.link)));
      page.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const f = forms.find(x => x.id == b.dataset.del); if (!f) return;
        if (!(await window.UI.confirm('למחוק את הטופס "' + esc(f.title) + '" וכל החתימות שלו?'))) return;
        for (const r of respOf(f.id)) await window.store.remove('form_responses', r.id);
        resp2 = resp2.filter(r => r.form_id != f.id); resp.length = 0; resp.push(...resp2);
        await window.store.remove('forms', f.id); const i = forms.indexOf(f); if (i >= 0) forms.splice(i, 1);
        drawList(); window.UI.toast('נמחק');
      }));
    }

    // ---------- בונה שדות דינמי ----------
    function fieldRowHTML(fld) {
      fld = fld || { label: '', type: 'text', options: [], required: false };
      const opts = TYPES.map(t => '<option value="' + t.v + '"' + (t.type === fld.type || t.v === fld.type ? ' selected' : '') + '>' + t.t + '</option>').join('');
      const optsVal = Array.isArray(fld.options) ? fld.options.join(', ') : (fld.options || '');
      const showOpts = fld.type === 'select';
      return '<div class="fb-row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;border:1px solid var(--line,#ddd);border-radius:8px;padding:8px;margin-bottom:8px">' +
        '<input class="inp mb0 fb-label" style="flex:1 1 130px" placeholder="שם השדה *" value="' + esc(fld.label) + '">' +
        '<select class="inp mb0 fb-type" style="flex:0 1 130px">' + opts + '</select>' +
        '<input class="inp mb0 fb-options" style="flex:1 1 130px;' + (showOpts ? '' : 'display:none') + '" placeholder="אפשרויות (פסיק/שורה)" value="' + esc(optsVal) + '">' +
        '<label class="fld mb0" style="flex:0 0 auto;display:flex;flex-direction:row;align-items:center;gap:4px;margin:0"><input type="checkbox" class="fb-req"' + (fld.required ? ' checked' : '') + '> חובה</label>' +
        '<button type="button" class="mini danger fb-del" title="הסר שדה"><i class="bi bi-x-lg"></i></button>' +
        '</div>';
    }
    function wireFieldRow(row) {
      const typeSel = row.querySelector('.fb-type');
      const optInp = row.querySelector('.fb-options');
      typeSel.addEventListener('change', () => { optInp.style.display = typeSel.value === 'select' ? '' : 'none'; });
      row.querySelector('.fb-del').addEventListener('click', () => row.remove());
    }
    function collectFields(host) {
      const out = [];
      host.querySelectorAll('.fb-row').forEach((row, i) => {
        const label = row.querySelector('.fb-label').value.trim();
        if (!label) return;
        const type = row.querySelector('.fb-type').value;
        const optRaw = row.querySelector('.fb-options').value.trim();
        const options = type === 'select' ? optRaw.split(/[\n,]/).map(s => s.trim()).filter(Boolean) : [];
        out.push({ key: 'f' + i, label, type, options, required: row.querySelector('.fb-req').checked });
      });
      return out;
    }

    function newFormForm() {
      const clsOpts = cls.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
      const m = window.UI.modal({
        title: 'טופס חדש', saveLabel: 'צור ושלח',
        bodyHTML: '<div class="form-grid">' +
          '<label class="fld fld-wide"><span>כותרת הטופס *</span><input class="inp mb0" id="nf_title" placeholder="לדוגמה: אישור טיול"></label>' +
          '<label class="fld fld-wide"><span>תוכן / הנחיה להורים</span><textarea class="inp mb0" id="nf_body" rows="3" placeholder="טקסט שההורה יראה לפני החתימה"></textarea></label>' +
          '<label class="fld fld-wide"><span>נמענים</span><select class="inp mb0" id="nf_scope"><option value="">כל התלמידים</option>' + clsOpts + '</select></label>' +
          '</div>' +
          '<div class="fld fld-wide" style="margin-top:6px"><span style="display:block;margin-bottom:6px;font-weight:600">שדות למילוי (אופציונלי)</span>' +
          '<div id="nf_fields"></div>' +
          '<button type="button" class="btn-ghost sm" id="nf_addField"><i class="bi bi-plus-lg"></i> הוסף שדה</button></div>' +
          '<p class="login-hint">ייווצר קישור אישי לכל תלמיד למעקב ולחתימת ההורה. שדה "חתימה ידנית" מאפשר להורה לחתום ביד.</p>',
        onSave: async (mel) => {
          const title = mel.querySelector('#nf_title').value.trim();
          if (!title) { window.UI.toast('כותרת חובה', 'err'); return false; }
          const body = mel.querySelector('#nf_body').value.trim(), scope = mel.querySelector('#nf_scope').value;
          const fields = collectFields(mel.querySelector('#nf_fields'));
          const targets = studs.filter(s => !scope || String(s.class_id) === scope);
          if (!targets.length) { window.UI.toast('אין תלמידים בנמענים שנבחרו', 'err'); return false; }
          const fr = await window.store.add('forms', { title, body, fields, created_at: today() });
          const form = (fr.data && fr.data[0]) || { id: Date.now(), title, body, fields, created_at: today() }; forms.push(form);
          for (const s of targets) {
            const row = { form_id: form.id, student_id: s.id, status: 'pending', signer_name: '', signed_at: null, token: tok() };
            const rr = await window.store.add('form_responses', row); const nr = (rr.data && rr.data[0]) || row; resp.push(nr); resp2 = resp;
          }
          window.UI.toast('הטופס נוצר עבור ' + targets.length + ' תלמידים'); drawList(); return true;
        },
      });
      // אתחול בונה השדות: שדה חתימה כברירת מחדל (ניתן להסרה).
      const host = m.el.querySelector('#nf_fields');
      const addRow = fld => { host.insertAdjacentHTML('beforeend', fieldRowHTML(fld)); wireFieldRow(host.lastElementChild); };
      addRow({ label: 'חתימת הורה', type: 'signature', options: [], required: true });
      m.el.querySelector('#nf_addField').addEventListener('click', () => addRow(null));
    }

    function detailView(f) {
      if (!f) return;
      const rs = respOf(f.id);
      const signed = rs.filter(r => r.status === 'signed').length;
      page.innerHTML =
        '<div class="page-head"><button class="back" id="fBack">→ חזרה לרשימת הטפסים</button><h2>' + esc(f.title) + '</h2>' +
        '<div class="head-actions">' +
          '<button class="btn-ghost sm" id="fPrintAll"><i class="bi bi-printer"></i> הדפס את כל החתומים</button>' +
          '<button class="btn-ghost sm" id="fCsv"><i class="bi bi-download"></i> ייצוא CSV</button></div></div>' +
        (f.body ? '<div class="qr-card"><p style="margin:0">' + esc(f.body) + '</p></div>' : '') +
        '<div class="stat-row">' +
          '<div class="stat-card"><div class="stat-ic"><i class="bi bi-people-fill"></i></div><div class="stat-num">' + rs.length + '</div><div class="stat-lbl">נמענים</div></div>' +
          '<div class="stat-card"><div class="stat-ic"><i class="bi bi-check2-circle"></i></div><div class="stat-num">' + signed + '</div><div class="stat-lbl">נחתמו</div></div>' +
          '<div class="stat-card"><div class="stat-ic"><i class="bi bi-hourglass-split"></i></div><div class="stat-num">' + (rs.length - signed) + '</div><div class="stat-lbl">ממתינים</div></div>' +
        '</div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>תלמיד</th><th>כיתה</th><th>סטטוס</th><th>חתם</th><th>תאריך</th><th>פעולות</th></tr></thead><tbody id="fBody"></tbody></table></div>';
      drawDetail(f);
      page.querySelector('#fBack').addEventListener('click', listView);
      page.querySelector('#fCsv').addEventListener('click', () => exportCsv(f));
      page.querySelector('#fPrintAll').addEventListener('click', () => printAll(f));
    }
    function drawDetail(f) {
      const rs = respOf(f.id);
      page.querySelector('#fBody').innerHTML = rs.map(r => {
        const link = signBase() + '?f=' + f.id + '&t=' + r.token;
        const isSigned = r.status === 'signed';
        return '<tr><td>' + esc(nameOf(r.student_id)) + '</td><td>' + esc(clsOf(r.student_id)) + '</td>' +
          '<td><button class="chip ' + (isSigned ? 'ok' : 'off') + '" data-tog="' + r.id + '">' + (isSigned ? 'נחתם' : 'ממתין') + '</button></td>' +
          '<td>' + esc(r.signer_name || '') + '</td><td>' + esc(r.signed_at || '') + '</td>' +
          '<td class="row-act">' +
            (isSigned ? '<button class="mini" data-viewsig="' + r.id + '" title="צפייה בטופס החתום"><i class="bi bi-eye"></i></button>' : '') +
            '<button class="mini" data-copy="' + esc(link) + '" title="העתק קישור"><i class="bi bi-link-45deg"></i></button>' +
            '<button class="mini" data-wa="' + esc(link) + '" title="שליחה בוואטסאפ"><i class="bi bi-whatsapp"></i></button>' +
          '</td></tr>';
      }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:18px">אין נמענים</td></tr>';
      page.querySelectorAll('[data-tog]').forEach(b => b.addEventListener('click', async () => {
        const r = resp.find(x => x.id == b.dataset.tog); if (!r) return;
        if (r.status === 'signed') { r.status = 'pending'; r.signer_name = ''; r.signed_at = null; }
        else { r.status = 'signed'; r.signer_name = r.signer_name || 'סומן ידנית'; r.signed_at = today(); }
        await window.store.update('form_responses', r.id, { status: r.status, signer_name: r.signer_name, signed_at: r.signed_at });
        detailView(f);
      }));
      page.querySelectorAll('[data-viewsig]').forEach(b => b.addEventListener('click', () => viewSigned(f, resp.find(x => x.id == b.dataset.viewsig))));
      page.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => copyLink(b.dataset.copy)));
      page.querySelectorAll('[data-wa]').forEach(b => b.addEventListener('click', () => {
        window.open('https://wa.me/?text=' + encodeURIComponent('קישור לחתימת אישור: ' + b.dataset.wa), '_blank');
      }));
    }

    // ---------- צפייה בטופס החתום ----------
    function answersHTML(f, r) {
      const fields = parseFields(f), ans = parseAnswers(r);
      let out = '';
      fields.forEach(fld => {
        if (fld.type === 'signature') return;
        let v = ans[fld.key];
        if (v == null || v === '') v = '—';
        if (fld.type === 'checkbox') v = (v === true || v === 'true' || v === 'כן') ? 'כן' : 'לא';
        out += '<div class="det-row"><span class="det-lbl">' + esc(fld.label) + '</span><span class="det-val">' + esc(v) + '</span></div>';
      });
      return out;
    }
    function signatureImg(r) {
      const sig = r && r.signature;
      return (sig && /^data:image\//.test(sig))
        ? '<img src="' + esc(sig) + '" alt="חתימה" style="max-width:100%;border:1px solid var(--line,#ccc);border-radius:8px;background:#fff">'
        : '<span style="color:var(--muted)">אין תמונת חתימה שמורה</span>';
    }
    function signedBlockHTML(f, r) {
      return '<div class="det-head"><div><div class="det-name">' + esc(nameOf(r.student_id)) + '</div>' +
        '<span class="chip">' + esc(clsOf(r.student_id)) + '</span></div></div>' +
        '<div class="det-grid">' +
          '<div class="det-row"><span class="det-lbl">חתם</span><span class="det-val">' + esc(r.signer_name || '') + '</span></div>' +
          '<div class="det-row"><span class="det-lbl">תאריך</span><span class="det-val">' + esc(r.signed_at || '') + '</span></div>' +
          answersHTML(f, r) +
        '</div>' +
        '<div class="det-sec"><h4><i class="bi bi-pen"></i> חתימה</h4>' + signatureImg(r) + '</div>';
    }
    function viewSigned(f, r) {
      if (!r) return;
      const m = window.UI.modal({
        title: 'צפייה בטופס החתום',
        bodyHTML: '<div id="sigView">' + signedBlockHTML(f, r) + '</div>' +
          '<div class="det-actions" style="margin-top:14px"><button class="btn-ghost sm" data-print><i class="bi bi-printer"></i> הדפסה</button></div>',
      });
      const pb = m.el.querySelector('[data-print]');
      if (pb) pb.addEventListener('click', () => printHTML(esc(f.title), '<h2>' + esc(f.title) + '</h2>' + (f.body ? '<p>' + esc(f.body) + '</p>' : '') + signedBlockHTML(f, r)));
    }

    // ---------- הדפסה ----------
    function printHTML(title, inner) {
      const w = window.open('', '_blank');
      if (!w) { window.UI.toast('חלון ההדפסה נחסם', 'err'); return; }
      w.document.write('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>' + title + '</title>' +
        '<style>body{font-family:Heebo,Arial,sans-serif;direction:rtl;padding:24px;color:#222}' +
        'h2{margin:0 0 6px}.det-row{display:flex;gap:10px;padding:3px 0;border-bottom:1px dashed #ddd}' +
        '.det-lbl{font-weight:600;min-width:120px}.det-name{font-size:1.2rem;font-weight:700}' +
        '.det-sec{margin-top:12px}img{max-width:340px;border:1px solid #ccc;border-radius:8px}' +
        '.rec{page-break-inside:avoid;border:1px solid #ccc;border-radius:10px;padding:14px;margin-bottom:16px}' +
        '.chip{display:inline-block;background:#eee;border-radius:12px;padding:1px 8px;font-size:.85rem}h4{margin:.4rem 0}</style>' +
        '</head><body>' + inner + '</body></html>');
      w.document.close();
      w.focus();
      setTimeout(() => { try { w.print(); } catch (_) {} }, 300);
    }
    function printAll(f) {
      const rs = respOf(f.id).filter(r => r.status === 'signed');
      if (!rs.length) { window.UI.toast('אין חתומים להדפסה', 'err'); return; }
      const inner = '<h2>' + esc(f.title) + '</h2>' + (f.body ? '<p>' + esc(f.body) + '</p>' : '') +
        '<p style="color:#666">סה"כ ' + rs.length + ' חתומים</p>' +
        rs.map(r => '<div class="rec">' + signedBlockHTML(f, r) + '</div>').join('');
      printHTML(esc(f.title), inner);
    }

    function exportCsv(f) {
      const rs = respOf(f.id);
      const fields = parseFields(f).filter(fl => fl.type !== 'signature');
      const head = ['תלמיד', 'כיתה', 'סטטוס', 'חתם', 'תאריך'].concat(fields.map(fl => fl.label));
      const lines = [head.join(',')].concat(rs.map(r => {
        const ans = parseAnswers(r);
        const base = [nameOf(r.student_id), clsOf(r.student_id), r.status === 'signed' ? 'נחתם' : 'ממתין', r.signer_name || '', r.signed_at || ''];
        const extra = fields.map(fl => {
          let v = ans[fl.key];
          if (fl.type === 'checkbox') v = (v === true || v === 'true' || v === 'כן') ? 'כן' : (v == null || v === '' ? '' : 'לא');
          return v == null ? '' : v;
        });
        return base.concat(extra).map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',');
      }));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'form_' + f.id + '.csv'; a.click();
    }
    function copyLink(url) {
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => window.UI.toast('הקישור הועתק'), () => window.UI.toast(url));
      else window.UI.toast(url);
    }

    listView();
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.forms = renderForms;
})();
