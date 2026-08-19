// api.js — שכבת נתונים דקה מעל Supabase (או מצב הדגמה).
// כל קריאה עוברת דרך window.sb → ה-RLS בצד-שרת מחליט מה מותר. אין טוקנים בקוד.
// בהמשך (חלקים 3+) המודולים ישתמשו ב-db.list/insert/update/remove.
(function () {
  'use strict';
  const DEMO = !window.sb;

  // PostgREST של הפרויקט מוגדר max_rows=1000: קריאה בלי range נחתכת בשקט,
  // בלי שגיאה. עם 37 תלמידים, טבלת attendance חוצה 1000 שורות תוך כחודש
  // לימודים — ומאז הדוחות, הכרטיס והייצוא היו מחשבים על תת-קבוצה שרירותית.
  // לכן כל קריאה מדפדפת עד שהעמוד חוזר חלקי.
  const PAGE = 1000;
  const noIdCol = {};   // טבלאות שאין בהן עמודת id (student_links, user_class_access) — נלמד בזמן ריצה

  async function list(table, opts) {
    if (DEMO) return { ok: true, data: [], demo: true };
    const explicitOrder = opts && opts.order;
    const asc = explicitOrder ? opts.asc !== false : true;
    let orderCol = explicitOrder || (noIdCol[table] ? null : 'id');
    let out = [], from = 0;
    for (;;) {
      let q = window.sb.from(table).select(opts && opts.select || '*');
      if (opts && opts.eq) for (const k in opts.eq) q = q.eq(k, opts.eq[k]);
      if (orderCol) q = q.order(orderCol, { ascending: asc });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) {
        // 42703 = העמודה לא קיימת. קורה בטבלאות ללא id; מנסים שוב בלי מיון
        // במקום להחזיר שגיאה (בגרסה קודמת זה שבר את user_class_access,
        // ומחנכים נשארו בלי הרשאות כיתה).
        if (!explicitOrder && orderCol && (error.code === '42703' || /column .* does not exist/i.test(error.message || ''))) {
          noIdCol[table] = 1; orderCol = null; continue;
        }
        return { ok: false, data: out, error: error.message };
      }
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
      if (from >= 100000) {   // בלם ביטחון — טבלה בסדר גודל כזה צריכה סינון בצד-שרת
        console.warn('[cv3] ' + table + ': נעצר ב-100k שורות; צריך סינון בצד-שרת');
        break;
      }
    }
    return { ok: true, data: out };
  }
  async function insert(table, row) {
    if (DEMO) return { ok: true, demo: true };
    // id מיוצר ע"י המסד; מחרוזות ריקות לשדות מספריים → null (Postgres דוחה '' ל-numeric)
    const { id: _i, ...clean } = row || {};
    for (const k of ['amount', 'grade', 'score']) if (clean[k] === '') clean[k] = null;
    const { data, error } = await window.sb.from(table).insert(clean).select();
    return { ok: !error, data, error: error && error.message };
  }
  async function update(table, id, patch) {
    if (DEMO) return { ok: true, demo: true };
    // id הוא GENERATED ALWAYS IDENTITY — אסור לשלוח אותו ב-patch (Postgres דוחה); גם created_at לא לעדכן
    const { id: _i, created_at: _c, ...clean } = patch || {};
    const { data, error } = await window.sb.from(table).update(clean).eq('id', id).select();
    return { ok: !error, data, error: error && error.message };
  }
  async function remove(table, id) {
    if (DEMO) return { ok: true, demo: true };
    const { error } = await window.sb.from(table).delete().eq('id', id);
    return { ok: !error, error: error && error.message };
  }

  window.db = { DEMO, list, insert, update, remove };
})();
