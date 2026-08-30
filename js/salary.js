// salary.js — ניהול שכר צוות (2026-08-30, בקשת יוסף).
//
// יושב במסך "הגדרות והרשאות" (מנהל בלבד) מתחת לכרטיס "צוות — תיקים אישיים".
// טבלת שכר מקובצת לפי מוסד, סכומי ביניים וסה"כ, הוספה/עריכה/מחיקה, ועורך
// תוספות חודשיות לכל אדם. מוצג גם בכרטיס איש הצוות (cardSection).
//
// ⚠️ הטבלה `staff_salary` היא מנהל-בלבד ב-RLS (`staff_salary_admin_all`),
// כמו `staff`. שורה לכל (אדם × מוסד) — אדם יכול לקבל שכר משני מוסדות.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const nis = n => '₪' + num(n).toLocaleString('he-IL');
  const yn = v => v === true ? '<span class="chip ok">כן</span>' : v === false ? '<span class="chip off">לא</span>' : '<span class="tl-note">—</span>';
  const full = r => [r.first_name, r.last_name].filter(Boolean).join(' ');
  const INSTITUTIONS = ['בית התלמוד', 'משמרת חיים'];

  // מערך התוספות תמיד מגיע כ-jsonb; מגן מפני מחרוזת/null
  const addsOf = r => {
    let a = r && r.additions;
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = []; } }
    return Array.isArray(a) ? a : [];
  };
  const addsSum = r => addsOf(r).reduce((s, x) => s + num(x && x.amount), 0);
  // סה"כ שכר = בסיס + השלמה + תוספות חודשיות (נסיעות/ביגוד לרוב "מגולם" ולא מספר)
  const rowTotal = r => num(r.amount) + num(r.supplement) + addsSum(r);

  let staffCache = [];
  const nameOf = r => {
    if (r.staff_id != null) {
      const s = staffCache.find(x => String(x.id) === String(r.staff_id));
      if (s) return full(s);
    }
    return r.person_name || '—';
  };

  async function loadAll() {
    const [rows, staff] = await Promise.all([
      window.store.list('staff_salary'), window.store.list('staff'),
    ]);
    staffCache = staff || [];
    return (rows || []);
  }

  // ── עורך תוספות חודשיות בתוך הטופס ──
  function addsEditorHtml(list) {
    const row = (a, i) =>
      '<div class="qr-grid sal-add-row" style="grid-template-columns:1fr 120px auto;gap:6px;margin-bottom:6px">' +
        '<input class="inp mb0" data-add-label="' + i + '" placeholder="תיאור התוספת" value="' + esc(a.label || '') + '">' +
        '<input class="inp mb0" type="number" data-add-amount="' + i + '" placeholder="סכום" value="' + esc(a.amount == null ? '' : a.amount) + '">' +
        '<button type="button" class="mini danger" data-add-del="' + i + '" title="הסר"><i class="bi bi-x-lg"></i></button>' +
      '</div>';
    return '<div id="salAdds">' + list.map(row).join('') + '</div>' +
      '<button type="button" class="mini" id="salAddMore"><i class="bi bi-plus-lg"></i> הוסף תוספת חודשית</button>';
  }
  function wireAddsEditor(m) {
    let list = addsOf({ additions: m._adds || [] });
    const host = m.querySelector('#salAdds');
    const redraw = () => {
      host.innerHTML = list.map((a, i) =>
        '<div class="qr-grid sal-add-row" style="grid-template-columns:1fr 120px auto;gap:6px;margin-bottom:6px">' +
          '<input class="inp mb0" data-add-label="' + i + '" placeholder="תיאור התוספת" value="' + esc(a.label || '') + '">' +
          '<input class="inp mb0" type="number" data-add-amount="' + i + '" placeholder="סכום" value="' + esc(a.amount == null ? '' : a.amount) + '">' +
          '<button type="button" class="mini danger" data-add-del="' + i + '" title="הסר"><i class="bi bi-x-lg"></i></button>' +
        '</div>').join('');
      host.querySelectorAll('[data-add-del]').forEach(b => b.addEventListener('click', () => {
        sync(); list.splice(Number(b.dataset.addDel), 1); redraw();
      }));
    };
    const sync = () => {
      host.querySelectorAll('.sal-add-row').forEach((el, i) => {
        list[i] = {
          label: (el.querySelector('[data-add-label]').value || '').trim(),
          amount: num(el.querySelector('[data-add-amount]').value),
        };
      });
    };
    host.querySelectorAll('[data-add-del]').forEach(b => b.addEventListener('click', () => {
      sync(); list.splice(Number(b.dataset.addDel), 1); redraw();
    }));
    m.querySelector('#salAddMore').addEventListener('click', () => { sync(); list.push({ label: '', amount: '' }); redraw(); });
    m._readAdds = () => { sync(); return list.filter(a => a.label || a.amount); };
  }

  function form(existing, onDone) {
    const r = existing || {};
    const staffOpts = ['<option value="">— שם חופשי —</option>'].concat(
      staffCache.slice().sort((a, b) => String(full(a)).localeCompare(String(full(b)), 'he'))
        .map(s => '<option value="' + s.id + '"' + (String(r.staff_id) === String(s.id) ? ' selected' : '') + '>' + esc(full(s)) + '</option>')
    ).join('');
    const instOpts = INSTITUTIONS.map(x => '<option' + (r.institution === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
    const tri = (k, label) => '<label class="fld"><span>' + esc(label) + '</span><select class="inp mb0" data-f="' + k + '">' +
      [['', '—'], ['true', 'כן'], ['false', 'לא']].map(o =>
        '<option value="' + o[0] + '"' + (String(r[k]) === o[0] || (r[k] == null && o[0] === '') ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
      '</select></label>';
    const txt = (k, label, type) => '<label class="fld"><span>' + esc(label) + '</span><input class="inp mb0" data-f="' + k + '"' +
      (type ? ' type="' + type + '"' : '') + ' value="' + esc(r[k] == null ? '' : r[k]) + '"></label>';

    const m = window.UI.modal({
      title: existing ? ('עריכת שכר — ' + esc(nameOf(r))) : 'שורת שכר חדשה', saveLabel: 'שמירה',
      bodyHTML: '<div class="form-grid">' +
        '<label class="fld"><span>איש צוות</span><select class="inp mb0" data-f="staff_id">' + staffOpts + '</select></label>' +
        '<label class="fld"><span>שם (אם אינו ברשימה)</span><input class="inp mb0" data-f="person_name" value="' + esc(r.person_name || '') + '"></label>' +
        '<label class="fld"><span>מוסד</span><select class="inp mb0" data-f="institution">' + instOpts + '</select></label>' +
        txt('role_label', 'תפקיד') +
        txt('amount', 'סכום', 'number') + txt('supplement', 'השלמה', 'number') +
        txt('travel', 'נסיעות') + txt('clothing', 'ביגוד והבראה') +
        tri('pension', 'פנסיה') + tri('study_fund', 'קרן השתלמות') +
        txt('hours', 'שעות', 'number') +
        '<label class="fld"><span>פעיל</span><select class="inp mb0" data-f="active">' +
          '<option value="true"' + (r.active !== false ? ' selected' : '') + '>כן</option>' +
          '<option value="false"' + (r.active === false ? ' selected' : '') + '>לא</option></select></label>' +
        '<div class="fld fld-wide"><span>תוספות חודשיות</span>' + addsEditorHtml(addsOf(r)) + '</div>' +
        '<label class="fld fld-wide"><span>הערות</span><textarea class="inp mb0 ta-auto" data-f="note" rows="2">' + esc(r.note || '') + '</textarea></label>' +
      '</div>',
      onSave: async (el) => {
        const row = {};
        el.querySelectorAll('[data-f]').forEach(x => {
          const k = x.dataset.f; let v = (x.value || '').trim();
          if (k === 'pension' || k === 'study_fund') row[k] = v === '' ? null : v === 'true';
          else if (k === 'active') row[k] = v === 'true';
          else if (k === 'staff_id') row[k] = v === '' ? null : Number(v);
          else if (k === 'amount' || k === 'supplement' || k === 'hours') row[k] = v === '' ? null : num(v);
          else row[k] = v === '' ? null : v;
        });
        row.additions = el._readAdds ? el._readAdds() : addsOf(r);
        if (row.staff_id == null && !row.person_name) { window.UI.toast('צריך לבחור איש צוות או להזין שם', 'err'); return false; }
        let res;
        if (existing) res = await window.store.update('staff_salary', r.id, row);
        else res = await window.store.add('staff_salary', row);
        const okRow = res && res.ok !== false && !(Array.isArray(res.data) && !res.data.length && !res.demo);
        if (!okRow) { window.UI.toast('השמירה נכשלה' + (res && res.error ? ': ' + res.error : ' (מנהל בלבד)'), 'err'); return false; }
        window.UI.toast(existing ? 'נשמר' : 'נוסף');
        if (onDone) onDone();
        return true;
      },
    });
    m._adds = addsOf(r);
    wireAddsEditor(m.el);
  }

  async function render(host) {
    if (!host) return;
    let rows = await loadAll();

    host.innerHTML =
      '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-cash-coin"></i> ניהול שכר</h3>' +
        '<button class="btn-primary sm" id="salAdd"><i class="bi bi-plus-lg"></i> שורת שכר חדשה</button></div>' +
      '<p class="login-hint" style="margin:0 0 8px">שכר חודשי לכל איש צוות — כולל השלמה, נסיעות, שעות ותוספות. ' +
      '<b>מנהל בלבד</b>. אדם שעובד בשני מוסדות מופיע בשורה לכל מוסד.</p>' +
      '<div id="salBody"></div></div>';

    function tableFor(list) {
      if (!list.length) return '';
      const body = list.map(r =>
        '<tr' + (r.active === false ? ' style="opacity:.55"' : '') + '>' +
          '<td><b>' + esc(nameOf(r)) + '</b>' + (r.active === false ? ' <span class="det-badge">לא פעיל</span>' : '') + '</td>' +
          '<td>' + esc(r.role_label || '—') + '</td>' +
          '<td>' + (num(r.amount) ? nis(r.amount) : '—') + '</td>' +
          '<td>' + (num(r.supplement) ? nis(r.supplement) : '—') + '</td>' +
          '<td>' + esc(r.travel || '—') + '</td>' +
          '<td>' + esc(r.clothing || '—') + '</td>' +
          '<td>' + yn(r.pension) + '</td>' +
          '<td>' + yn(r.study_fund) + '</td>' +
          '<td>' + (r.hours != null && r.hours !== '' ? esc(r.hours) : '—') + '</td>' +
          '<td>' + (addsOf(r).length ? '<span title="' + esc(addsOf(r).map(a => a.label + ': ' + nis(a.amount)).join(' · ')) + '">' + nis(addsSum(r)) + ' <small>(' + addsOf(r).length + ')</small></span>' : '—') + '</td>' +
          '<td><b>' + nis(rowTotal(r)) + '</b></td>' +
          '<td class="row-act">' +
            '<button class="mini" data-edit="' + r.id + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
            '<button class="mini danger" data-del="' + r.id + '" title="מחיקה"><i class="bi bi-trash"></i></button>' +
          '</td></tr>').join('');
      const sub = list.filter(r => r.active !== false).reduce((s, r) => s + rowTotal(r), 0);
      return '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>שם</th><th>תפקיד</th><th>סכום</th><th>השלמה</th><th>נסיעות</th><th>ביגוד</th><th>פנסיה</th><th>קרן</th><th>שעות</th><th>תוספות</th><th>סה״כ</th><th></th>' +
        '</tr></thead><tbody>' + body + '</tbody>' +
        '<tfoot><tr><td colspan="10" style="text-align:left"><b>סה״כ (פעילים)</b></td><td><b>' + nis(sub) + '</b></td><td></td></tr></tfoot>' +
        '</table></div>';
    }

    function draw() {
      const byInst = {};
      rows.forEach(r => { const k = r.institution || 'ללא מוסד'; (byInst[k] = byInst[k] || []).push(r); });
      const order = INSTITUTIONS.concat(Object.keys(byInst).filter(k => INSTITUTIONS.indexOf(k) < 0));
      let html = '';
      order.forEach(k => {
        const list = (byInst[k] || []).slice().sort((a, b) => String(nameOf(a)).localeCompare(String(nameOf(b)), 'he'));
        if (!list.length) return;
        html += '<h4 style="margin:14px 2px 6px"><i class="bi bi-building"></i> ' + esc(k) + '</h4>' + tableFor(list);
      });
      const grand = rows.filter(r => r.active !== false).reduce((s, r) => s + rowTotal(r), 0);
      html += '<div class="count-line" style="margin:12px 2px 0;font-size:1rem"><b>סה״כ כללי (כל המוסדות, פעילים): ' + nis(grand) + '</b></div>';
      host.querySelector('#salBody').innerHTML = rows.length ? html : '<div class="tl-note" style="padding:10px">אין עדיין נתוני שכר</div>';

      host.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () =>
        form(rows.find(r => String(r.id) === b.dataset.edit), reload)));
      host.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const r = rows.find(x => String(x.id) === b.dataset.del); if (!r) return;
        if (!await window.UI.confirm('למחוק את שורת השכר של "' + esc(nameOf(r)) + '"?')) return;
        const res = await window.store.remove('staff_salary', r.id);
        if (!res || res.ok === false) { window.UI.toast('המחיקה נכשלה', 'err'); return; }
        rows = rows.filter(x => x.id !== r.id); draw(); window.UI.toast('נמחק');
      }));
    }
    async function reload() { rows = await loadAll(); draw(); }

    host.querySelector('#salAdd').addEventListener('click', () => form(null, reload));
    draw();
  }

  // ── מקטע שכר לכרטיס איש הצוות ──
  // הכרטיס ממופתח לפי מזהה הפרופיל (profiles.id), בעוד שהשכר מקושר ל-staff.id.
  // לכן ממפים: פרופיל → שורות staff שה-user_id שלהן = הפרופיל → שורות השכר שלהן.
  // בשקט מחזיר '' אם ה-RLS חוסם (מי שאינו מנהל) — הכרטיס לא נופל בגלל זה.
  async function cardSection(profileId) {
    let rows, staff;
    try { [rows, staff] = await Promise.all([window.store.list('staff_salary'), window.store.list('staff')]); }
    catch (_) { return ''; }
    if (!Array.isArray(rows) || !rows.length) return '';
    const myStaffIds = (staff || []).filter(s => String(s.user_id) === String(profileId)).map(s => String(s.id));
    if (!myStaffIds.length) return '';
    const mine = rows.filter(r => myStaffIds.indexOf(String(r.staff_id)) >= 0);
    if (!mine.length) return '';
    const line = r => '<div class="det-item"><span class="sev-dot ' + (r.active === false ? 'lo' : 'mid') + '"></span>' +
      '<span class="di-main"><strong>' + esc(r.institution || 'שכר') + '</strong>' +
      (r.role_label ? ' <span class="tl-note">' + esc(r.role_label) + '</span>' : '') +
      (r.hours != null && r.hours !== '' ? ' · ' + esc(r.hours) + ' שעות' : '') +
      (addsSum(r) ? ' · תוספות ' + nis(addsSum(r)) : '') + '</span>' +
      '<span class="di-meta"><b>' + nis(rowTotal(r)) + '</b></span></div>';
    const total = mine.filter(r => r.active !== false).reduce((s, r) => s + rowTotal(r), 0);
    return '<div class="det-sec"><h4><i class="bi bi-cash-coin"></i> שכר <span class="det-badge">' + nis(total) + '</span></h4>' +
      mine.map(line).join('') + '</div>';
  }

  window.cv3Salary = { render, cardSection };
})();
