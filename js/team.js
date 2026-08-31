// team.js — טבלת הסקירה של פאנל "ניהול צוות" (31/08/2026, בקשת יוסף).
//
// עד היום אותו איש צוות היה מפוזר על שלוש טבלאות בלי שום מבט משותף:
//   profiles      — מי נכנס למערכת, באיזה תפקיד, לאילו שיעורים ומסכים
//   staff         — התיק האישי: מספר עובד, ת"ז, בנק, מסמכים, תיקייה בדרייב
//   staff_salary  — שכר חודשי, שורה לכל (אדם × מוסד)
// כדי לראות תמונה על אדם אחד היה צריך לרוץ בין שלושה כרטיסים ולהצליב בעיניים,
// ובפועל אף אחד לא עשה את זה — 16 מתוך 25 שורות השכר היו שמות חופשיים של
// אנשים שאין להם תיק אישי ואין להם משתמש, ואיש לא ידע.
//
// המסך הזה מאחד אותם לשורה אחת לאדם, מסמן בדיוק מה חסר, ופותח לכל מימד את
// **העורך הקיים** (cv3Admin.userForm / cv3Staff.form / cv3Salary.form) —
// אין כאן לוגיקת שמירה משוכפלת.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const nis = n => '₪' + num(n).toLocaleString('he-IL');
  const digits = v => String(v == null ? '' : v).replace(/\D/g, '');
  const fullStaff = r => [r.first_name, r.last_name].filter(Boolean).join(' ').trim();

  // מפתח איחוד. הקישור הרשמי הוא staff.user_id; הטלפון הוא רשת ביטחון לאנשים
  // שנוצרו בשני המקומות בנפרד ולא קושרו. השוואה על ספרות בלבד — במסד יש גם
  // "052-761..." וגם "052761...".
  const phoneKey = v => { const d = digits(v); return d.length >= 6 ? d.slice(-9) : ''; };

  async function loadAll() {
    const safe = async t => { try { const r = await window.store.list(t); return Array.isArray(r) ? r : []; } catch (_) { return []; } };
    const [profiles, staff, salary, classes, access] = await Promise.all([
      safe('profiles'), safe('staff'), safe('staff_salary'), safe('classes'), safe('user_class_access'),
    ]);
    return { profiles, staff, salary, classes, access };
  }

  // ── האיחוד ────────────────────────────────────────────────────────────
  function merge(d) {
    const people = [];
    const byProfile = {}, byPhone = {};
    const put = p => {
      people.push(p);
      if (p.profile) byProfile[String(p.profile.id)] = p;
      const k = phoneKey(p.phone); if (k && !byPhone[k]) byPhone[k] = p;
      return p;
    };
    // 1. כל מי שיש לו תיק אישי — זו רשומת האמת של המוסד
    d.staff.forEach(s => put({
      name: fullStaff(s) || s.emp_no || '—',
      phone: s.phone || '',
      staff: s,
      profile: s.user_id ? d.profiles.find(p => String(p.id) === String(s.user_id)) || null : null,
      salary: [],
    }));
    // 2. משתמשים שאין להם תיק
    d.profiles.forEach(p => {
      if (people.some(x => x.profile && String(x.profile.id) === String(p.id))) return;
      const k = phoneKey(p.tz || p.phone);
      const hit = k && byPhone[k];
      if (hit && !hit.profile) { hit.profile = p; byProfile[String(p.id)] = hit; return; }
      put({ name: p.name || '—', phone: p.tz || p.phone || '', staff: null, profile: p, salary: [] });
    });
    // 3. שורות שכר — למקושרות יש staff_id; לשאר יש רק שם חופשי
    d.salary.forEach(r => {
      let target = null;
      if (r.staff_id != null) target = people.find(x => x.staff && String(x.staff.id) === String(r.staff_id));
      if (!target && r.person_name) {
        const nm = String(r.person_name).trim();
        target = people.find(x => x.name && x.name.trim() === nm)
              || put({ name: nm, phone: '', staff: null, profile: null, salary: [] });
      }
      if (target) target.salary.push(r);
    });
    people.forEach(p => {
      p.pay = p.salary.filter(r => r.active !== false)
        .reduce((s, r) => s + (window.cv3Salary && window.cv3Salary.rowTotal ? window.cv3Salary.rowTotal(r) : num(r.amount)), 0);
      p.institutions = [...new Set(p.salary.map(r => r.institution).filter(Boolean))];
      p.inactive = (p.staff && p.staff.active === false) || (p.profile && p.profile.active === false);
      p.gaps = [];
      if (!p.profile) p.gaps.push('משתמש');
      if (!p.staff) p.gaps.push('תיק');
      if (!p.salary.length) p.gaps.push('שכר');
    });
    return people.sort((a, b) =>
      Number(!!a.inactive) - Number(!!b.inactive) ||
      String(a.name).localeCompare(String(b.name), 'he'));
  }

  async function render(host) {
    if (!host) return;
    let d, people;
    let filter = 'all';

    host.innerHTML = '<div class="tl-note" style="padding:10px">טוען סקירת צוות…</div>';

    async function reload() { d = await loadAll(); people = merge(d); draw(); }

    // רענון גם של הכרטיסים שמתחת, כדי ששלושתם לא יסתרו זה את זה אחרי עריכה
    async function reloadAll() {
      await reload();
      try { if (window.cv3Admin && window.cv3Admin.reloadUsers) window.cv3Admin.reloadUsers(); } catch (_) {}
      const sc = document.getElementById('staffCard'), sl = document.getElementById('salaryCard');
      try { if (window.cv3Staff && sc) window.cv3Staff.render(sc); } catch (_) {}
      try { if (window.cv3Salary && sl) window.cv3Salary.render(sl); } catch (_) {}
    }

    const clsNames = uid => d.access.filter(a => String(a.user_id) === String(uid))
      .map(a => { const c = d.classes.find(x => String(x.id) === String(a.class_id)); return c && c.name; })
      .filter(Boolean);

    function permCell(p) {
      if (!p.profile) return '<span class="tm-gap">אין משתמש</span>';
      const role = p.profile.role || '—';
      if (role === 'מנהל') return '<span class="chip ok">מנהל</span> <span class="tl-note">כל המערכת</span>';
      const cls = clsNames(p.profile.id);
      const scr = (p.profile.perms && p.profile.perms.length) ? p.profile.perms.length + ' מסכים' : 'לפי תפקיד';
      return '<span class="chip off">' + esc(role) + '</span> ' +
        '<span class="tl-note">' + (cls.length ? esc(cls.join(', ')) : 'ללא שיוך שיעור') + ' · ' + esc(scr) + '</span>';
    }
    function loginCell(p) {
      if (!p.profile) return '<span class="tm-gap">—</span>';
      if (p.profile.active === false) return '<span class="chip off">מושבת</span>';
      return p.profile.pw_changed_at
        ? '<span class="chip ok">סיסמה הוחלפה</span>'
        : '<span class="chip warn">סיסמת ברירת מחדל</span>';
    }
    function fileCell(p) {
      if (!p.staff) return '<span class="tm-gap">אין תיק</span>';
      const have = [p.staff.has_cert, p.staff.has_id_copy, !!p.staff.account_no].filter(Boolean).length;
      const cls = have === 3 ? 'ok' : have === 0 ? 'warn' : 'off';
      return '<span class="chip ' + cls + '" title="תעודה · צילום ת״ז · פרטי בנק">' + have + '/3 מסמכים</span>' +
        (p.staff.drive_id ? ' <i class="bi bi-folder2-open" title="יש תיקייה בדרייב"></i>' : '');
    }
    function payCell(p) {
      if (!p.salary.length) return '<span class="tm-gap">אין שכר</span>';
      return '<b>' + nis(p.pay) + '</b>' +
        (p.institutions.length > 1 ? ' <span class="tl-note">' + esc(p.institutions.join(' + ')) + '</span>' : '');
    }

    function draw() {
      const shown = people.filter(p => filter === 'all' ? true
        : filter === 'gaps' ? p.gaps.length && !p.inactive
        : filter === 'inactive' ? p.inactive
        : true);
      const withGaps = people.filter(p => p.gaps.length && !p.inactive).length;
      const totalPay = people.filter(p => !p.inactive).reduce((s, p) => s + p.pay, 0);

      host.innerHTML =
        '<div class="tm-bar">' +
          '<div class="tm-tabs">' +
            ['all|כל הצוות (' + people.length + ')', 'gaps|חסר משהו (' + withGaps + ')', 'inactive|לא פעילים']
              .map(x => { const [k, l] = x.split('|');
                return '<button class="tm-tab' + (filter === k ? ' on' : '') + '" data-f="' + k + '">' + esc(l) + '</button>'; }).join('') +
          '</div>' +
          '<span class="tm-total">סה״כ שכר חודשי (פעילים): <b>' + nis(totalPay) + '</b></span>' +
        '</div>' +
        '<div class="table-wrap"><table class="tbl tm-tbl"><thead><tr>' +
          '<th>שם</th><th>טלפון</th><th>הרשאות</th><th>כניסה</th><th>תיק אישי</th><th>שכר</th><th style="width:132px"></th>' +
        '</tr></thead><tbody>' +
        (shown.length ? shown.map((p, i) =>
          '<tr' + (p.inactive ? ' class="tm-off"' : '') + '>' +
            '<td><b>' + esc(p.name) + '</b>' + (p.inactive ? ' <span class="det-badge">לא פעיל</span>' : '') +
              (p.gaps.length && !p.inactive ? ' <span class="tm-gap-dot" title="חסר: ' + esc(p.gaps.join(', ')) + '">●</span>' : '') + '</td>' +
            '<td>' + esc(p.phone || '—') + '</td>' +
            '<td>' + permCell(p) + '</td>' +
            '<td>' + loginCell(p) + '</td>' +
            '<td>' + fileCell(p) + '</td>' +
            '<td>' + payCell(p) + '</td>' +
            '<td class="row-act">' +
              '<button class="mini" data-perm="' + i + '" title="' + (p.profile ? 'הרשאות וכניסה' : 'אין משתמש — נוצר מתוך התיק') + '"' +
                (p.profile ? '' : ' disabled') + '><i class="bi bi-shield-lock"></i></button>' +
              '<button class="mini" data-file="' + i + '" title="' + (p.staff ? 'תיק אישי' : 'פתיחת תיק אישי') + '"><i class="bi bi-person-badge"></i></button>' +
              '<button class="mini" data-pay="' + i + '" title="שכר"><i class="bi bi-cash-coin"></i></button>' +
            '</td></tr>').join('')
          : '<tr><td colspan="7" class="tl-note" style="padding:12px">אין שורות בסינון הזה</td></tr>') +
        '</tbody></table></div>' +
        (filter === 'gaps' && withGaps
          ? '<p class="login-hint" style="margin:8px 2px 0">נקודה כתומה = חסר לאדם אחד מהשלושה: משתמש למערכת, תיק אישי, או שורת שכר. ' +
            'לחיצה על סמל בשורה פותחת בדיוק את החלק החסר.</p>'
          : '');

      host.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; draw(); }));
      host.querySelectorAll('[data-perm]').forEach(b => b.addEventListener('click', () => {
        const p = shown[Number(b.dataset.perm)];
        if (!p || !p.profile) return;
        if (!window.cv3Admin || !window.cv3Admin.userForm) { window.UI.toast('מסך ההרשאות עדיין נטען', 'err'); return; }
        // מעבירים את שורת המשתמש כפי ש-admin.js מכיר אותה, אחרת העריכה תיצור משתמש חדש
        const u = (window.cv3Admin.findUser && window.cv3Admin.findUser(p.profile.id)) || p.profile;
        window.cv3Admin.userForm(u);
      }));
      host.querySelectorAll('[data-file]').forEach(b => b.addEventListener('click', () => {
        const p = shown[Number(b.dataset.file)];
        if (!p || !window.cv3Staff || !window.cv3Staff.form) return;
        // אין תיק — פותחים טופס חדש עם מה שכבר ידוע עליו, כדי שלא יקליד מחדש
        window.cv3Staff.form(p.staff || null, reloadAll);
        if (!p.staff) prefill(seedFromPerson(p));
      }));
      host.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => {
        const p = shown[Number(b.dataset.pay)];
        if (!p || !window.cv3Salary || !window.cv3Salary.form) return;
        if (p.salary.length === 1) { window.cv3Salary.form(p.salary[0], reloadAll); return; }
        if (p.salary.length > 1) { payPicker(p); return; }
        window.cv3Salary.form(null, reloadAll);
      }));
    }

    // מילוי מוקדם של טופס תיק חדש מתוך מה שכבר ידוע (שם/טלפון) — הטופס נבנה
    // מ-UI.modal ולכן ממלאים אחרי שהוא כבר ב-DOM.
    function seedFromPerson(p) {
      const parts = String(p.name || '').trim().split(/\s+/);
      return { first_name: parts[0] || '', last_name: parts.slice(1).join(' '), phone: p.phone || '' };
    }
    function prefill(seed) {
      setTimeout(() => {
        const m = document.querySelector('.modal-ov:last-of-type .modal-card') || document.querySelector('.modal-card');
        if (!m) return;
        ['first_name', 'last_name', 'phone'].forEach(k => {
          const el = m.querySelector('[data-f="' + k + '"]');
          if (el && !el.value) el.value = seed[k] || '';
        });
      }, 60);
    }

    // לאדם עם שכר בכמה מוסדות — לבחור איזו שורה עורכים
    function payPicker(p) {
      window.UI.modal({
        title: 'שכר — ' + esc(p.name),
        bodyHTML: '<div class="tm-pick">' + p.salary.map((r, i) =>
          '<button class="qk-item" data-i="' + i + '"><b>' + esc(r.institution || 'ללא מוסד') + '</b> · ' +
          nis(window.cv3Salary.rowTotal ? window.cv3Salary.rowTotal(r) : r.amount) +
          (r.active === false ? ' <span class="det-badge">לא פעיל</span>' : '') + '</button>').join('') +
          '<button class="qk-item" data-i="new"><i class="bi bi-plus-lg"></i> שורת שכר נוספת</button></div>',
        onClose: () => {},
      });
      setTimeout(() => {
        document.querySelectorAll('.tm-pick [data-i]').forEach(b => b.addEventListener('click', () => {
          const ov = b.closest('.modal-ov'); if (ov) ov.remove();
          window.cv3Salary.form(b.dataset.i === 'new' ? null : p.salary[Number(b.dataset.i)], reloadAll);
        }));
      }, 50);
    }

    await reload();
  }

  window.cv3Team = { render };
})();
