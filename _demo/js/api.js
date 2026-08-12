// api.js — שכבת נתונים דקה מעל Supabase (או מצב הדגמה).
// כל קריאה עוברת דרך window.sb → ה-RLS בצד-שרת מחליט מה מותר. אין טוקנים בקוד.
// בהמשך (חלקים 3+) המודולים ישתמשו ב-db.list/insert/update/remove.
(function () {
  'use strict';
  const DEMO = !window.sb;

  async function list(table, opts) {
    if (DEMO) return { ok: true, data: [], demo: true };
    let q = window.sb.from(table).select(opts && opts.select || '*');
    if (opts && opts.eq) for (const k in opts.eq) q = q.eq(k, opts.eq[k]);
    if (opts && opts.order) q = q.order(opts.order, { ascending: opts.asc !== false });
    const { data, error } = await q;
    return { ok: !error, data: data || [], error: error && error.message };
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
