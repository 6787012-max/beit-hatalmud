// author.js — "מי מילא את זה".
//
// בכל טבלאות המעקב יש עמודת created_by (מזהה משתמש), אבל אף מסך לא הציג
// אותה: אפשר היה לראות שנרשמה הערת התנהגות ולא מי הרב שרשם אותה. הבעיה
// הייתה כפולה — גם לא נכתב וגם לא הוצג. הכתיבה תוקנה מרכזית ב-store.add
// (stampAuthor), וההצגה נעשית דרך המודול הזה כדי שהניסוח יהיה זהה בכל מסך.
//
// שים לב: רשומות שנוצרו לפני התיקון לא ישאו שם — יוצג "לא ידוע". זה נכון
// יותר מלנחש, ואל תמלא אותן בדיעבד בשם של מישהו.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let map = null;          // uid -> {name, role}
  let loading = null;

  async function load(force) {
    if (map && !force) return map;
    if (loading) return loading;
    loading = (async () => {
      const m = {};
      // ספריית הצוות לפני profiles: `prof_self_read` מתיר את הטבלה **רק
      // למנהל**, ולכן לכל שאר הצוות המפה יצאה ריקה וכל "מי רשם" במערכת הציג
      // "לא ידוע". `staff_directory()` מחזיר שם+תפקיד בלבד (בלי tz/מייל)
      // לכל איש צוות פעיל — ראה migration_weekly_reports.sql.
      try {
        if (window.sb) {
          const { data, error } = await window.sb.rpc('staff_directory');
          if (!error) (data || []).forEach(p => { if (p && p.id) m[p.id] = { name: p.name || '', role: p.role || '', active: true }; });
        }
      } catch (e) { /* נופלים ל-profiles */ }
      try {
        const profs = await window.store.list('profiles');
        // ⚠️ שומרים גם אנשי צוות שכבר אינם פעילים — רשומות ישנות שלהם עדיין
        // צריכות להציג שם ולא "לא ידוע". הדגל active מועבר הלאה כדי
        // ש-all() יאפשר לסנן אותם ברשימות של "מי עוד לא עשה".
        (profs || []).forEach(p => { if (p && p.id) m[p.id] = { name: p.name || '', role: p.role || '', active: p.active !== false }; });
      } catch (e) { /* בלי פרופילים פשוט לא יוצג שם */ }
      try {
        const staff = await window.store.list('staff');
        (staff || []).forEach(s => {
          if (!s || !s.user_id || m[s.user_id]) return;
          const n = [s.first_name, s.last_name].filter(Boolean).join(' ');
          if (n) m[s.user_id] = { name: n, role: s.role_label || '' };
        });
      } catch (e) { /* staff הוא תוספת, לא חובה */ }
      map = m;
      loading = null;
      return m;
    })();
    return loading;
  }

  function rec(uid) { return (map && uid && map[uid]) || null; }

  // שם בלבד — לטבלאות ולייצוא
  function name(uid) {
    const r = rec(uid);
    return r && r.name ? r.name : (uid ? 'לא ידוע' : '—');
  }

  function role(uid) {
    const r = rec(uid);
    return r ? (r.role || '') : '';
  }

  // תא לטבלה: שם + תפקיד ב-tooltip
  function cell(uid) {
    const r = rec(uid);
    if (!r || !r.name) {
      return '<span class="au au-none" title="' +
        (uid ? 'הרשומה נוצרה לפני שהמערכת התחילה לתעד מי רשם' : 'אין מידע') +
        '">' + (uid ? 'לא ידוע' : '—') + '</span>';
    }
    return '<span class="au" title="' + esc(r.role || '') + '">' + esc(r.name) + '</span>';
  }

  // שורת "נרשם ע"י" לכרטיסים ולציר זמן
  function line(row, opts) {
    const o = opts || {};
    const uid = row && (row.created_by || row.createdBy);
    const when = o.when || (row && (row.created_at || row.event_date || row.date));
    const d = when ? String(when).slice(0, 10) : '';
    return '<span class="au-line"><i class="bi bi-person-badge"></i> נרשם ע"י ' +
      cell(uid) + (d ? ' · ' + esc(d) : '') + '</span>';
  }

  function style() {
    if (document.getElementById('auStyle')) return;
    const s = document.createElement('style'); s.id = 'auStyle';
    s.textContent =
      '.au{white-space:nowrap}' +
      '.au-none{color:var(--muted,#9ca3af);font-style:italic}' +
      '.au-line{display:inline-flex;align-items:center;gap:5px;font-size:.8rem;' +
      'color:var(--muted,#6b7280)}';
    document.head.appendChild(s);
  }

  // כל אנשי הצוות כמערך — למסכים שצריכים לדעת מי *לא* עשה משהו (למשל
  // "טרם דיווחו" בסיכום השבועי), ולא רק לתרגם מזהה לשם.
  function all() {
    if (!map) return [];
    return Object.keys(map).map(id => ({ id: id, name: map[id].name, role: map[id].role, active: map[id].active !== false }));
  }

  style();
  window.Author = { load, name, role, cell, line, all, get map() { return map; } };
})();
