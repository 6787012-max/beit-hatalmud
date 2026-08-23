// staff.js — ניהול צוות ותיקים אישיים (2026-08-20, בקשת יוסף).
//
// יושב בתוך מסך "הגדרות והרשאות" (מנהל בלבד) לצד "צוות והרשאות":
// שם, מספר עובד, טלפון, אילו מסמכים הוגשו, פרטי בנק לתשלום — ותיק אישי בדרייב.
//
// ⚠️ הטבלה `staff` מכילה ת"ז ופרטי חשבון בנק של עובדים. ה-RLS שלה הוא **מנהל בלבד**
// (`staff_admin_all`), ולכן גם אם המסך ייחשף בטעות, השרת לא יחזיר כלום לצוות רגיל.
// בטבלה עצמה מספר החשבון מוסתר, ונפתח רק בכרטיס — כדי שלא יישאר על המסך במקרה.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const full = r => [r.first_name, r.last_name].filter(Boolean).join(' ');
  const yn = v => v === true ? '<span class="chip ok">יש</span>' : v === false ? '<span class="chip off">אין</span>' : '<span class="tl-note">—</span>';

  const FIELDS = [
    ['emp_no', 'מספר עובד'], ['first_name', 'שם פרטי *'], ['last_name', 'שם משפחה'],
    ['role_label', 'תפקיד'], ['phone', 'טלפון'], ['home_phone', 'טלפון בית'],
    ['tz', 'תעודת זהות'], ['doc_kind', 'סוג מסמך'], ['birthdate', 'תאריך לידה', 'date'],
    ['email', 'אימייל'], ['address', 'כתובת'],
    ['bank_no', 'מספר בנק'], ['branch_no', 'סניף'], ['account_no', 'מספר חשבון'],
  ];

  async function list() {
    const rows = await window.store.list('staff');
    return (rows || []).slice().sort((a, b) =>
      String(full(a)).localeCompare(String(full(b)), 'he'));
  }

  const ROLES = ['מנהל', 'מפקח', 'מזכירה', 'מחנך', 'מלמד'];

  async function render(host) {
    if (!host) return;
    let [rows, profiles, classes] = await Promise.all([
      list(), window.store.list('profiles'), window.store.list('classes'),
    ]);
    const profOf = r => (profiles || []).find(p => p.id === r.user_id);
    host.innerHTML =
      '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-person-badge"></i> צוות — תיקים אישיים</h3>' +
        '<button class="btn-primary sm" id="stAdd"><i class="bi bi-person-plus"></i> איש צוות חדש</button></div>' +
        '<p class="login-hint" style="margin:0 0 8px">פרטי העסקה ומסמכים. <b>מנהל בלבד</b> — כולל פרטי בנק. ' +
        'התיק האישי נשמר בתיקייה של איש הצוות בגוגל דרייב.</p>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr>' +
          '<th>שם</th><th>מס׳</th><th>תפקיד</th><th>טלפון</th><th>תעודה</th><th>ת״ז</th><th>משתמש</th><th></th>' +
        '</tr></thead><tbody id="stBody"></tbody></table></div></div>';

    function draw() {
      // מיון אחיד גם לצוות — לפי שם משפחה ואז שם מלא
      rows.sort((a, b) =>
        String(a.family || '').localeCompare(String(b.family || ''), 'he') ||
        String(full(a) || '').localeCompare(String(full(b) || ''), 'he'));
      host.querySelector('#stBody').innerHTML = rows.length ? rows.map(r =>
        '<tr' + (r.active === false ? ' style="opacity:.6"' : '') + '>' +
          '<td><b>' + esc(full(r)) + '</b>' + (r.active === false ? ' <span class="det-badge">לא פעיל</span>' : '') + '</td>' +
          '<td>' + esc(r.emp_no || '—') + '</td>' +
          '<td>' + esc(r.role_label || '—') + '</td>' +
          '<td>' + esc(r.phone || '—') + '</td>' +
          '<td>' + yn(r.has_cert) + '</td>' +
          '<td>' + yn(r.has_id_copy) + '</td>' +
          '<td>' + (profOf(r)
            ? '<span class="chip ok" title="יש לו חשבון כניסה למערכת">' + esc(profOf(r).role || 'משתמש') + '</span>'
            : '<button class="mini" data-user="' + r.id + '" title="צור לו משתמש למערכת"><i class="bi bi-person-plus"></i></button>') + '</td>' +
          '<td class="row-act">' +
            '<button class="mini" data-file="' + r.id + '" title="תיק אישי בדרייב"><i class="bi bi-folder2-open"></i></button>' +
            '<button class="mini" data-edit="' + r.id + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
            '<button class="mini danger" data-del="' + r.id + '" title="מחיקה"><i class="bi bi-trash"></i></button>' +
          '</td></tr>').join('')
        : '<tr><td colspan="8" class="tl-note" style="padding:10px">אין אנשי צוות עדיין</td></tr>';

      host.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () =>
        form(rows.find(r => String(r.id) === b.dataset.edit))));
      host.querySelectorAll('[data-user]').forEach(b => b.addEventListener('click', () =>
        makeUser(rows.find(r => String(r.id) === b.dataset.user))));
      host.querySelectorAll('[data-file]').forEach(b => b.addEventListener('click', () => openFile(
        rows.find(r => String(r.id) === b.dataset.file))));
      host.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const r = rows.find(x => String(x.id) === b.dataset.del); if (!r) return;
        if (!await window.UI.confirm('למחוק את "' + esc(full(r)) + '" מרשימת הצוות? התיקייה בדרייב לא תימחק.')) return;
        const res = await window.store.remove('staff', r.id);
        if (!res || res.ok === false) { window.UI.toast('המחיקה נכשלה', 'err'); return; }
        rows = rows.filter(x => x.id !== r.id); draw(); window.UI.toast('נמחק');
      }));
    }

    function openFile(r) {
      if (!r) return;
      if (!r.drive_id) { window.UI.toast('אין עדיין תיקייה בדרייב לאיש הצוות הזה', 'err'); return; }
      window.cv3StudentDocs.openManager(null, null, {
        kind: 'staff', id: r.id, name: full(r),
        folders: [{ drive_id: r.drive_id, title: full(r), drive_url: r.drive_url }],
      });
    }

    // ── הפיכת איש צוות למשתמש במערכת ──
    // אותו מסלול שבו נוצר משתמש במסך "צוות והרשאות": הרשמה דרך client זמני
    // (כדי לא להחליף את הסשן של המנהל), ואז השלמת הפרופיל. אם המספר כבר רשום —
    // מקשרים לפרופיל הקיים במקום להיכשל.
    async function makeUser(r) {
      if (!r) return;
      const phone = String(r.phone || '').replace(/[^0-9]/g, '');
      if (phone.length < 6) { window.UI.toast('צריך מספר טלפון תקין (6 ספרות לפחות) — זו גם הסיסמה הראשונית', 'err'); return; }
      const name = full(r);
      const clsBoxes = (classes || []).map(c =>
        '<label class="cb"><input type="checkbox" value="' + c.id + '"> ' + esc(c.name) + '</label>').join('');
      window.UI.modal({
        title: 'יצירת משתמש — ' + esc(name), saveLabel: 'צור משתמש',
        bodyHTML: '<div class="form-grid">' +
          '<label class="fld"><span>שם הכניסה</span><input class="inp mb0" value="' + esc(name) + '" readonly></label>' +
          '<label class="fld"><span>טלפון (שם משתמש)</span><input class="inp mb0" value="' + esc(phone) + '" readonly></label>' +
          '<label class="fld"><span>תפקיד</span><select class="inp mb0" id="muRole">' +
            ROLES.map(x => '<option' + (x === (r.role_label || 'מחנך') ? ' selected' : '') + '>' + x + '</option>').join('') +
          '</select></label>' +
          '<label class="fld"><span>סיסמה ראשונית</span><input class="inp mb0" id="muPw" value="' + esc(phone) + '"></label>' +
          '<div class="fld fld-wide"><span>כיתות מורשות <small style="font-weight:400;color:var(--muted)">— בלי שיוך לא יראה נתוני תלמידים</small></span>' +
            '<div class="cb-grid" id="muCls">' + (clsBoxes || '<span class="tl-note">אין כיתות</span>') + '</div></div>' +
          '</div>',
        onSave: async (m) => {
          const role = m.querySelector('#muRole').value;
          const pw = (m.querySelector('#muPw').value || '').trim() || phone;
          if (pw.length < 6) { window.UI.toast('הסיסמה חייבת 6 תווים לפחות', 'err'); return false; }
          const email = phone + '@bht.co.il';
          let uid = (profiles || []).find(p => String(p.email || '').toLowerCase() === email) || null;
          uid = uid && uid.id;
          if (!uid) {
            const C = window.CV3 || {};
            const tmp = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY,
              { auth: { persistSession: false, autoRefreshToken: false } });
            const { data, error } = await tmp.auth.signUp({ email, password: pw, options: { data: { name } } });
            uid = data && data.user && data.user.id;
            if (error && !uid) { window.UI.toast('יצירת המשתמש נכשלה: ' + error.message, 'err'); return false; }
            if (!uid) { window.UI.toast('המשתמש לא נוצר (ייתכן שהמספר כבר רשום)', 'err'); return false; }
            await new Promise(x => setTimeout(x, 600));   // הטריגר שיוצר את הפרופיל
          }
          const upd = await window.store.update('profiles', uid, { name, role, tz: phone, active: true });
          if (!upd || upd.ok === false) { window.UI.toast('הפרופיל לא עודכן: ' + ((upd && upd.error) || ''), 'err'); return false; }
          // שיוך כיתות — נקי קודם, כדי שלא יישארו כיתות ישנות
          await window.store.removeBy('user_class_access', { user_id: uid });
          for (const cb of m.querySelectorAll('#muCls input:checked')) {
            await window.store.add('user_class_access', { user_id: uid, class_id: Number(cb.value) });
          }
          const link = await window.store.update('staff', r.id, { user_id: uid });
          if (!link || link.ok === false) { window.UI.toast('המשתמש נוצר אך הקישור לתיק נכשל', 'err'); }
          [rows, profiles] = await Promise.all([list(), window.store.list('profiles')]);
          draw();
          window.UI.toast('נוצר משתמש — כניסה: ' + phone + ' · סיסמה: ' + pw);
          return true;
        },
      });
    }

    function form(existing) {
      const r = existing || {};
      const inp = ([k, label, type]) =>
        '<label class="fld"><span>' + esc(label) + '</span><input class="inp mb0" data-f="' + k + '"' +
        (type ? ' type="' + type + '"' : '') + ' value="' + esc(r[k] == null ? '' : String(r[k]).slice(0, type === 'date' ? 10 : 999)) + '"></label>';
      const tri = (k, label) => '<label class="fld"><span>' + esc(label) + '</span><select class="inp mb0" data-f="' + k + '">' +
        [['', '—'], ['true', 'יש'], ['false', 'אין']].map(o =>
          '<option value="' + o[0] + '"' + (String(r[k]) === o[0] || (r[k] == null && o[0] === '') ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
        '</select></label>';
      window.UI.modal({
        title: existing ? ('עריכה — ' + esc(full(r))) : 'איש צוות חדש', saveLabel: 'שמירה',
        bodyHTML: '<div class="form-grid">' + FIELDS.map(inp).join('') +
          tri('has_cert', 'תעודה הוגשה') + tri('has_id_copy', 'צילום ת״ז הוגש') +
          '<label class="fld"><span>פעיל</span><select class="inp mb0" data-f="active">' +
            '<option value="true"' + (r.active !== false ? ' selected' : '') + '>כן</option>' +
            '<option value="false"' + (r.active === false ? ' selected' : '') + '>לא</option></select></label>' +
          '<label class="fld fld-wide"><span>הערה</span><input class="inp mb0" data-f="note" value="' + esc(r.note || '') + '"></label>' +
          '</div>',
        onSave: async (m) => {
          const row = {};
          m.querySelectorAll('[data-f]').forEach(el => {
            const k = el.dataset.f; let v = (el.value || '').trim();
            if (k === 'has_cert' || k === 'has_id_copy') row[k] = v === '' ? null : v === 'true';
            else if (k === 'active') row[k] = v === 'true';
            else row[k] = v === '' ? null : v;
          });
          if (!row.first_name) { window.UI.toast('שם פרטי חובה', 'err'); return false; }
          let res;
          if (existing) res = await window.store.update('staff', r.id, row);
          else res = await window.store.add('staff', row);
          // RLS חוסם בשקט: בלי בדיקת השורה שחזרה היינו מציגים "נשמר" שקרי
          const okRow = res && res.ok !== false && !(Array.isArray(res.data) && !res.data.length && !res.demo);
          if (!okRow) { window.UI.toast('השמירה נכשלה' + (res && res.error ? ': ' + res.error : ' (מנהל בלבד)'), 'err'); return false; }
          rows = await list(); draw();
          window.UI.toast(existing ? 'נשמר' : 'נוסף. אפשר לפתוח לו תיק אישי בדרייב מהכפתור בשורה.');
          return true;
        },
      });
    }

    host.querySelector('#stAdd').addEventListener('click', () => form(null));
    draw();
  }

  window.cv3Staff = { render, list };
})();
