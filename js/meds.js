// meds.js — לשונית "כדורים" (2026-11-22, בקשת יוסף לרב קליין).
//
// טבלה של כל התלמידים עם הכדורים שלהם, סטטוס (לוקח / לא לוקח / לבדוק),
// עריכה, הוספה, הפסקה ומחיקה, וציר זמן "היה ← עכשיו" לכל תלמיד.
// הגישה: מנהל, או מי שיש לו 'meds' ב-perms (ראה can_manage_meds במסד).
// הכתיבה עוברת דרך RPC `med_save` — השינוי והערת העדכון נשמרים יחד ביומן.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s && s.name) || '';
  const today = () => new Date().toISOString().slice(0, 10);
  const STALE_DAYS = 31;
  const STATUSES = ['לוקח', 'לא לוקח', 'לבדוק', 'אמור לקחת ועדיין לא'];
  const STATUS_CLS = { 'לוקח': 'mds-ok', 'לא לוקח': 'mds-off', 'לבדוק': 'mds-warn', 'אמור לקחת ועדיין לא': 'mds-pend' };
  // תצוגה מקוצרת בתוך ה-select בלבד (הערך השמור הוא המחרוזת המלאה)
  const STATUS_SHORT = { 'אמור לקחת ועדיין לא': 'אמור לקחת' };
  const stLabel = x => STATUS_SHORT[x] || x;
  const stOptions = cur => STATUSES.map(x => '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + ' title="' + esc(x) + '">' + esc(stLabel(x)) + '</option>').join('');
  const normName = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();

  // שדות של רשומת תרופה (אותם שדות כמו בלשונית הרפואי)
  const medFields = () => (window.cv3Medical && window.cv3Medical.FIELDS && window.cv3Medical.FIELDS['תרופה']) || [];
  const LABEL = { name: 'שם התרופה', purpose: 'מטרת הנטילה', dose: 'מינון', hours: 'שעות השפעה', take_time: 'זמן נטילה',
    take_how: 'אופן נטילה', side_during: 'תופעות בזמן ההשפעה', side_after: 'תופעות אחרי ההשפעה',
    second: 'כדור נוסף בצהריים', dose2: 'מינון הכדור השני', hours2: 'שעות השפעה — שני', notes: 'הערות ההורים',
    active: 'פעיל', updated_on: 'עודכן בתאריך' };
  const DIFF_KEYS = Object.keys(LABEL);

  // ───────── נתונים ─────────
  const live = () => !window.store.DEMO && !!window.sb;

  async function loadAll() {
    const [studs, classes, meds] = await Promise.all([
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
      window.store.list('classes'),
      window.store.list('medications'),
    ]);
    let statuses = [];
    if (live()) {
      const r = await window.sb.from('student_med_status').select('*');
      if (r.error) throw new Error(r.error.message);
      statuses = r.data || [];
    } else {
      statuses = (await window.store.list('student_med_status')) || [];
    }
    return {
      studs: studs || [], classes: classes || [],
      meds: (meds || []).filter(m => (m.category || 'תרופה') === 'תרופה'),
      statuses,
    };
  }

  async function loadHistory(sid) {
    if (!live()) return [];
    const r = await window.sb.from('medication_history').select('*').eq('student_id', sid)
      .order('changed_at', { ascending: false }).limit(300);
    if (r.error) throw new Error(r.error.message);
    return r.data || [];
  }

  // כתיבה: בשרת דרך RPC; בדמו (בלי שרת) על הזיכרון המקומי בלבד
  async function save(op, sid, id, data, note) {
    if (!live()) return demoSave(op, sid, id, data);
    const r = await window.sb.rpc('med_save', { p_op: op, p_student: sid, p_id: id, p_data: data, p_note: note || null });
    if (r.error) throw new Error(r.error.message);
    return r.data;
  }

  async function demoSave(op, sid, id, data) {
    const S = window.store;
    if (op === 'insert') return (await S.add('medications', Object.assign({}, data, { student_id: sid, kind: 'תרופה', category: 'תרופה', source: 'ידני' }))).data[0].id;
    if (op === 'update') { await S.update('medications', id, data); return id; }
    if (op === 'delete') { await S.remove('medications', id); return id; }
    if (op === 'status') {
      const cur = ((await S.list('student_med_status')) || []).find(x => x.student_id == sid);
      const row = { student_id: sid, status: data.status, note: data.note || null, updated_at: new Date().toISOString() };
      if (cur) await S.update('student_med_status', cur.id, row); else await S.add('student_med_status', row);
      return null;
    }
    return null;
  }

  // ───────── עזרים לתצוגה ─────────
  const fmtDate = s => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '—');
  const fmtTs = s => { try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return String(s || ''); } };
  const shown = (k, v) => {
    if (v === true) return 'כן';
    if (v === false) return 'לא';
    if (v == null || v === '') return '—';
    if (k === 'updated_on') return fmtDate(v);
    return String(v);
  };
  const daysSince = s => { if (!s) return null; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return Math.floor((Date.now() - d) / 86400000); };

  function statusOf(sid, statuses, meds) {
    const row = statuses.find(x => x.student_id == sid);
    if (row) return row;
    const active = meds.some(m => m.student_id == sid && m.active);
    return { status: active ? 'לוקח' : 'לא לוקח', note: null };
  }

  function describe(h) {
    const o = h.old_data || {}, n = h.new_data || {};
    if (h.kind === 'הערה') return esc(h.note || '');
    if (h.kind === 'סטטוס') {
      let s = o.status ? 'סטטוס: ' + esc(o.status) + ' ← ' + esc(n.status) : 'סטטוס: ' + esc(n.status);
      if ((o.note || '') !== (n.note || '')) s += '<br>הערת סטטוס: היה ' + esc(o.note || '—') + ' ← עכשיו ' + esc(n.note || '—');
      return s;
    }
    if (h.action === 'insert') return 'נוסף כדור: <b>' + esc(n.name) + '</b>';
    if (h.action === 'delete') return 'נמחק כדור: <b>' + esc(o.name) + '</b>';
    const lines = DIFF_KEYS.filter(k => String(o[k] == null ? '' : o[k]) !== String(n[k] == null ? '' : n[k]))
      .map(k => esc(LABEL[k]) + ': היה ' + esc(shown(k, o[k])) + ' ← עכשיו ' + esc(shown(k, n[k])));
    return lines.length ? lines.join('<br>') : 'עדכון';
  }

  // ───────── עמודות ─────────
  // fixed = לא ניתן להסתיר. def = ברירת מחדל (ברירת מחדל: מוצג). w = משקל רוחב.
  const COLS = [
    { k: 'name', t: 'תלמיד', sort: 'family', w: 13, fixed: true },
    { k: 'status', t: 'סטטוס', sort: 'status', w: 10 },
    { k: 'med', t: 'תרופה', sort: 'med', w: 14, fixed: true },
    { k: 'dose', t: 'מינון', sort: 'dose', w: 8 },
    { k: 'take_time', t: 'זמן נטילה', sort: 'take', w: 9 },
    { k: 'hours', t: 'שעות השפעה', sort: 'hours', w: 8 },
    { k: 'updated', t: 'עודכן', sort: 'updated', w: 8 },
    { k: 'notes', t: 'הערות', w: 16, fixed: true },
    { k: 'take_how', t: 'אופן נטילה', w: 9, def: false },
    { k: 'noon', t: 'כדור בצהריים', w: 9, def: false },
    { k: 'side', t: 'תופעות לוואי', w: 12, def: false },
    { k: 'purpose', t: 'מטרה', w: 10, def: false },
  ];
  const SEL_W = 3;
  const PREF_KEY = 'cv3.mdsCols';

  // בעיות ברישום: לכל כדור (mid) או ברמת התלמיד (mid = null)
  function issuesOf(r) {
    const out = [];
    const act = r.meds.filter(m => m.active);
    const cnt = {};
    act.forEach(m => { const k = normName(m.name); cnt[k] = (cnt[k] || 0) + 1; });
    act.forEach(m => {
      if (cnt[normName(m.name)] > 1) out.push({ mid: m.id, text: 'כדור פעיל רשום פעמיים לאותו תלמיד' });
      if (!String(m.dose || '').trim()) out.push({ mid: m.id, text: 'כדור פעיל בלי מינון' });
      if (!String(m.take_time || '').trim()) out.push({ mid: m.id, text: 'כדור פעיל בלי זמן נטילה' });
    });
    if (r.st.status === 'לוקח' && !act.length) out.push({ mid: null, text: 'סטטוס "לוקח" בלי אף כדור פעיל' });
    if (r.st.status === 'לא לוקח' && act.length) out.push({ mid: null, text: 'סטטוס "לא לוקח" עם כדור פעיל' });
    if (r.st.status === 'אמור לקחת ועדיין לא' && !r.meds.length) out.push({ mid: null, text: 'חסר שם הכדור שאמור לקחת' });
    return out;
  }

  // לא עודכן מעל חודש: העדכון האחרון של התלמיד ישן מ-31 יום (או שאין עדכון בכלל)
  function isStale(r) {
    if (!r.meds.length) return false;
    const ds = r.meds.map(m => daysSince(m.updated_on)).filter(x => x != null);
    if (!ds.length) return true;
    return Math.min.apply(null, ds) > STALE_DAYS;
  }

  function makeOverlay(title) {
    const ov = document.createElement('div'); ov.className = 'mds-ov';
    ov.innerHTML = '<div class="mds-card" role="dialog" aria-modal="true"><div class="mds-head"><h3></h3>' +
      '<button class="modal-x" aria-label="סגור"><i class="bi bi-x-lg"></i></button></div><div class="mds-body"></div></div>';
    ov.querySelector('h3').textContent = title;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('.modal-x').addEventListener('click', close);
    return { ov, body: ov.querySelector('.mds-body'), close };
  }

  // הסבר על תרופה מתוך window.cv3MedsInfo (אם יש התאמה לשם)
  function openInfo(medName) {
    const list = Array.isArray(window.cv3MedsInfo) ? window.cv3MedsInfo : [];
    const n = normName(medName);
    const it = list.find(x => (x.match || []).some(mm => n.includes(normName(mm))));
    const { body, close } = makeOverlay(it ? it.title : medName);
    const sec = (h, inner) => '<div class="mds-sec"><h4>' + esc(h) + '</h4>' + inner + '</div>';
    const p = v => '<p style="margin:0">' + esc(v || '—') + '</p>';
    const ul = arr => (arr && arr.length) ? '<ul style="margin:0;padding-right:20px">' + arr.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : p('');
    const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '#';
    let html = '<div class="mds-banner">מידע כללי מעלון התרופה הרשמי. לא תחליף להוראות הרופא.</div>';
    if (it) {
      if (it.brands && it.brands.length) html += '<p style="margin:0 0 10px"><b>שמות מסחריים:</b> ' + it.brands.map(x => esc(x)).join(', ') + '</p>';
      html += sec('מה זה', p(it.what)) + sec('למה נותנים', p(it.why)) + sec('איך זה פועל', p(it.how)) +
        sec('משך השפעה', p(it.duration)) +
        (Array.isArray(it.doses) && it.doses.length
          ? sec('מינונים (לפי העלון)', '<ul style="margin:0;padding-right:20px">' + it.doses.map((x, i) =>
              '<li>' + (i === 0 ? '<b>' + esc(x) + '</b>' : esc(x)) + '</li>').join('') + '</ul>')
          : '') +
        sec('תופעות לוואי נפוצות', ul(it.side)) + sec('מתי לפנות לרופא', ul(it.warn)) +
        sec('מקורות', (it.sources || []).map(s => '<a href="' + esc(safeUrl(s.u)) + '" target="_blank" rel="noopener">' + esc(s.t) + '</a>').join('<br>') || p(''));
      html += '<p style="font-size:12px;color:#64748b">נבדק לאחרונה: ' + esc(it.checked || '—') + '</p>';
    } else {
      html += '<p>אין עדיין הסבר לתרופה הזאת.</p>' +
        '<p><a href="https://israeldrugs.health.gov.il/#!/byDrug" target="_blank" rel="noopener">חיפוש במאגר התרופות של משרד הבריאות</a></p>';
    }
    body.innerHTML = html;
    return close;
  }

  // פענוח הדבקה מאקסל: שם תלמיד, תרופה, מינון, זמן נטילה, הערות (מופרדים בטאב)
  function parsePaste(text, D) {
    const seen = {};
    return String(text || '').split(/\r?\n/).filter(l => l.trim()).map(line => {
      const c = line.split('\t').map(x => x.trim());
      const sname = (c[0] || '').replace(/\s+/g, ' ');
      const mname = c[1] || '', dose = c[2] || '', take = c[3] || '', notes = c[4] || '';
      const hits = D.studs.filter(s => nm(s).replace(/\s+/g, ' ').trim() === sname);
      const sid = hits.length === 1 ? hits[0].id : null;
      const x = { sname, mname, dose, take, notes, sid, existing: null, ok: false, reason: '' };
      if (!sid) { x.reason = hits.length > 1 ? 'שם כפול' : 'לא זוהה'; return x; }
      if (!mname) { x.reason = 'חסר שם תרופה'; return x; }
      const key = sid + '|' + normName(mname);
      if (seen[key]) { x.reason = 'שורה כפולה בהדבקה'; return x; }
      seen[key] = true;
      const same = D.meds.filter(m => m.student_id == sid && normName(m.name) === normName(mname));
      x.existing = same.find(m => m.active) || same[0] || null;
      x.ok = true;
      return x;
    });
  }

  // ───────── טבלה ─────────
  const CSS = `
  .mds-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
  .mds-chip{border:1px solid var(--line,#d1d5db);background:var(--card,#fff);border-radius:999px;padding:6px 14px;cursor:pointer;font:inherit;color:inherit}
  .mds-chip.on{background:var(--primary,#003048);color:#fff;border-color:var(--primary,#003048)}
  .mds-tbl{width:100%;border-collapse:collapse;font-size:14px;table-layout:fixed;min-width:0 !important}
  .mds-tbl th{position:sticky;top:0;background:var(--card,#fff);text-align:right;padding:6px 5px;border-bottom:2px solid var(--line,#d1d5db);white-space:normal;font-size:13px;overflow:hidden;z-index:1}
  .mds-tbl td{padding:6px 5px;border-bottom:1px solid var(--line,#e5e7eb);vertical-align:middle;overflow:hidden;height:38px}
  .mds-tbl tr.mds-first td{border-top:2px solid var(--line,#cbd5e1)}
  .mds-sortable{cursor:pointer;user-select:none}
  .mds-sortable:hover{background:#f1f5f9}
  .mds-arr{color:#334155;font-size:11px;margin-inline-start:2px}
  .mds-selc{text-align:center}
  .mds-selc input{margin:0;cursor:pointer}
  .mds-stu{cursor:pointer;color:var(--primary,#003048);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;max-width:100%;vertical-align:middle}
  .mds-stu:hover{text-decoration:underline}
  .mds-chip-s{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;white-space:nowrap}
  .mds-ok{background:#dcfce7;color:#166534} .mds-off{background:#e5e7eb;color:#374151} .mds-warn{background:#fef3c7;color:#92400e} .mds-pend{background:#dbeafe;color:#1e40af}
  .mds-stop{text-decoration:line-through;color:#94a3b8}
  .mds-stale{background:#fff5f5}
  #main:has(#page-meds.active){max-width:none;padding-left:16px;padding-right:16px}
  .mds-wrap{overflow:visible !important;width:100%}
  .mds-1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mds-nwrap{display:flex;align-items:center;gap:4px;min-width:0}
  .mds-nwrap .mds-1{flex:1;min-width:0}
  .mds-more{flex:none;border:0;background:#e0f2fe;color:#075985;border-radius:6px;padding:1px 6px;font:inherit;font-size:12px;cursor:pointer}
  td.mds-open .mds-1{white-space:pre-line}
  td.mds-open .mds-nwrap{align-items:flex-start}
  .mds-ed{cursor:text} .mds-ed:hover{background:#f1f5f9;outline:1px dashed #94a3b8;outline-offset:-2px}
  .mds-in{width:100%;padding:4px 6px;font:inherit}
  .mds-ssel{border:0;border-radius:999px;padding:3px 8px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;max-width:100%}
  .mds-add{flex:none;border:1px solid var(--line,#cbd5e1);background:transparent;border-radius:6px;width:22px;height:22px;line-height:18px;padding:0;cursor:pointer;color:var(--primary,#003048)}
  .mds-same{color:#cbd5e1}
  .mds-warnm{color:#b45309;font-weight:700;cursor:help}
  .mds-empty{color:#94a3b8}
  .mds-hint{font-size:12px;color:#64748b;margin:4px 2px 6px}
  .mds-sortbar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;background:#f8fafc;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:8px 10px;margin:6px 0;font-size:14px}
  .mds-sortbar label{display:flex;gap:6px;align-items:center;white-space:nowrap}
  .mds-sortbar select{width:auto;max-width:100%}
  .mds-sb-lbl{font-weight:600;color:#334155}
  .mds-group td{background:#eef2f7;font-weight:600;cursor:pointer;border-top:2px solid var(--line,#cbd5e1);white-space:normal}
  .mds-gc{font-weight:400;color:#64748b;font-size:12px}
  .mds-gt{color:#475569;display:inline-block;width:14px}
  .mds-menu-wrap{position:relative}
  .mds-menu{position:absolute;top:calc(100% + 4px);right:0;background:var(--card,#fff);border:1px solid var(--line,#d1d5db);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:8px 10px;z-index:250;min-width:200px;display:flex;flex-direction:column;gap:6px}
  .mds-menu[hidden]{display:none}
  .mds-mi{display:flex;gap:6px;align-items:center;font-size:14px;cursor:pointer}
  .mds-bulk{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#e0f2fe;border-radius:10px;padding:8px 12px;margin:6px 0;font-size:14px}
  .mds-bulk[hidden]{display:none}
  .mds-bulk label{display:flex;gap:6px;align-items:center}
  .mds-undo{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;border-radius:999px;padding:10px 16px;display:flex;gap:14px;align-items:center;z-index:300;box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:14px}
  .mds-undo-b{background:transparent;border:1px solid #93c5fd;color:#bfdbfe;border-radius:999px;padding:3px 12px;cursor:pointer;font:inherit}
  .mds-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:260;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px}
  .mds-card{background:var(--card,#fff);color:inherit;border-radius:14px;width:min(760px,100%);box-shadow:0 20px 50px rgba(0,0,0,.3)}
  .mds-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line,#e5e7eb)}
  .mds-head h3{margin:0;font-size:18px}
  .mds-body{padding:16px 18px}
  .mds-banner{background:#fef9c3;border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:12px}
  .mds-sec{margin:0 0 18px;padding-bottom:14px;border-bottom:1px dashed var(--line,#e5e7eb)}
  .mds-sec h4{margin:0 0 8px;font-size:15px;color:var(--primary,#003048)}
  .mds-med{border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap}
  .mds-med small{color:#475569;display:block;line-height:1.6}
  .mds-hist{max-height:320px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:10px}
  .mds-hist div{padding:8px 10px;border-bottom:1px solid var(--line,#f1f5f9);font-size:13px;line-height:1.6}
  .mds-hist div:last-child{border-bottom:0}
  .mds-hist time{color:#64748b;font-size:12px}
  .mds-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .mds-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
  .mds-form label{display:flex;flex-direction:column;gap:4px;font-size:13px}
  .mds-form .wide{grid-column:1/-1}
  @media (max-width:560px){ .mds-card{width:100%} .mds-form{grid-template-columns:1fr} }`;

  function style() {
    if (document.getElementById('mdsStyle')) return;
    const s = document.createElement('style'); s.id = 'mdsStyle'; s.textContent = CSS; document.head.appendChild(s);
  }

  // ───────── מיון וקיבוץ ─────────
  const STATUS_ORDER = ['לוקח', 'אמור לקחת ועדיין לא', 'לבדוק', 'לא לוקח'];
  const TAKE_ORDER = ['בוקר (עד 11:00)', 'צהריים (11:00-14:00)', 'אחה"צ ואילך', 'לא ידוע'];
  // lvl: 's' = ברמת התלמיד, 'm' = ברמת הכדור (לתלמיד — לפי הכדור המוביל)
  const SORT_KEYS = {
    first: { t: 'שם פרטי', lvl: 's', def: 1 },
    family: { t: 'שם משפחה', lvl: 's', def: 1 },
    class: { t: 'שיעור', lvl: 's', def: 1 },
    status: { t: 'סטטוס', lvl: 's', def: 1 },
    med: { t: 'תרופה', lvl: 'm', def: 1 },
    take: { t: 'זמן נטילה', lvl: 'm', def: 1 },
    dose: { t: 'מינון', lvl: 'm', def: 1 },
    hours: { t: 'שעות השפעה', lvl: 'm', def: 1 },
    updated: { t: 'עודכן לאחרונה', lvl: 'm', def: -1 },
    stale: { t: 'הכי פחות מעודכן', lvl: 's', def: -1 },
    issues: { t: 'מספר בעיות ברישום', lvl: 's', def: -1 },
    count: { t: 'מספר כדורים לתלמיד', lvl: 's', def: -1 },
  };
  const SORT_DEFAULT = { s1: 'class', s2: 'family', dir: 1, grp: '' };
  const GROUP_OPTS = [['', 'ללא'], ['class', 'שיעור'], ['status', 'סטטוס'], ['med', 'תרופה'], ['take', 'זמן נטילה']];
  const sortOpts = withNone => (withNone ? '<option value="">ללא</option>' : '') +
    Object.keys(SORT_KEYS).map(k => '<option value="' + k + '">' + esc(SORT_KEYS[k].t) + '</option>').join('');

  // זמן נטילה: "08:00", "8:30", "7", "בוקר", "צהריים", "אחה\"צ", "ערב". לא מזוהה = null
  function parseTime(s) {
    const t = String(s == null ? '' : s).trim();
    if (!t) return null;
    const mm = /(\d{1,2})[:.](\d{2})/.exec(t);
    let h, min = 0;
    if (mm) { h = +mm[1]; min = +mm[2]; }
    else {
      const bare = /(\d{1,2})/.exec(t);
      if (bare) h = +bare[1];
      else if (/בוקר/.test(t)) return 7 * 60 + 30;
      else if (/ערב/.test(t)) return 19 * 60;
      else if (/אחה|אחר הצהריים|אחרי הצהריים/.test(t)) return 15 * 60;
      else if (/צהריים|צהרים/.test(t)) return 12 * 60 + 30;
      else return null;
    }
    if (!mm && h < 12 && /ערב|אחה|אחר הצהריים|אחרי הצהריים/.test(t)) h += 12;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  function bucketOf(t) {
    const mins = parseTime(t);
    if (mins == null) return 'לא ידוע';
    if (mins < 11 * 60) return TAKE_ORDER[0];
    if (mins < 14 * 60) return TAKE_ORDER[1];
    return TAKE_ORDER[2];
  }
  // המספר הראשון בטקסט ("10 מ\"ג" = 10, "5+5" = 5). אין = null
  function firstNum(s) {
    const x = /\d+(?:[.,]\d+)?/.exec(String(s == null ? '' : s));
    return x ? parseFloat(x[0].replace(',', '.')) : null;
  }
  // השוואה: ריק תמיד בסוף (בכל כיוון). מספרים מספרית, טקסט בעברית
  function cmpV(a, b, dir) {
    const ea = a == null || a === '', eb = b == null || b === '';
    if (ea || eb) return ea === eb ? 0 : (ea ? 1 : -1);
    if (typeof a === 'number' && typeof b === 'number') return dir * (a - b);
    return dir * String(a).localeCompare(String(b), 'he', { numeric: true });
  }
  function lastDays(r) {
    const ds = r.meds.map(m => daysSince(m.updated_on)).filter(x => x != null);
    return ds.length ? Math.min.apply(null, ds) : null;
  }
  // ערך ברמת התלמיד
  function sv(k, r, iss) {
    switch (k) {
      case 'first': return r.s.name || '';
      case 'family': return r.s.family || '';
      case 'class': return r.cls || '';
      case 'status': { const i = STATUS_ORDER.indexOf(r.st.status); return i < 0 ? 99 : i; }
      case 'stale': { const d = lastDays(r); return d == null ? 99999 : d; }
      case 'issues': return iss[r.s.id].length;
      case 'count': return r.meds.length;
      default: return null;
    }
  }
  // ערך ברמת הכדור
  function mv(k, m) {
    switch (k) {
      case 'med': return m.name || '';
      case 'take': return parseTime(m.take_time);
      case 'dose': return firstNum(m.dose);
      case 'hours': return firstNum(m.hours);
      case 'updated': return m.updated_on || null;
      default: return null;
    }
  }
  // ערך של תלמיד לפי כדור מוביל: הכדור הפעיל הראשון לפי השדה (או מתוך כל הכדורים אם אין פעילים)
  function leadVal(k, r, dir) {
    const act = r.meds.filter(m => m.active);
    const pool = act.length ? act : r.meds;
    let bv = null, first = true;
    pool.forEach(m => { const v = mv(k, m); if (first || cmpV(v, bv, dir) < 0) { bv = v; first = false; } });
    return bv;
  }
  function orderStudents(list, iss, S) {
    const val = (k, r, dir) => (SORT_KEYS[k].lvl === 's' ? sv(k, r, iss) : leadVal(k, r, dir));
    const rows = list.map((r, i) => ({ r, i, a: val(S.s1, r, S.dir), b: S.s2 ? val(S.s2, r, 1) : null }));
    rows.sort((x, y) => cmpV(x.a, y.a, S.dir) || cmpV(x.b, y.b, 1) || (x.i - y.i));
    return rows.map(x => x.r);
  }
  // כדורים של תלמיד: לפי המיון אם הוא ברמת הכדור, אחרת פעילים קודם
  function orderMeds(meds, S) {
    const k1 = SORT_KEYS[S.s1].lvl === 'm' ? S.s1 : null;
    const k2 = S.s2 && SORT_KEYS[S.s2] && SORT_KEYS[S.s2].lvl === 'm' ? S.s2 : null;
    return meds.slice().sort((a, b) => {
      if (k1) { const c = cmpV(mv(k1, a), mv(k1, b), S.dir); if (c) return c; }
      if (k2) { const c = cmpV(mv(k2, a), mv(k2, b), 1); if (c) return c; }
      return (b.active - a.active) || (a.id - b.id);
    });
  }
  function orderGroups(groups, S) {
    if (S.grp === 'take') return groups.slice().sort((a, b) => TAKE_ORDER.indexOf(a.key) - TAKE_ORDER.indexOf(b.key));
    if (S.grp === 'status') return groups.slice().sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key));
    return groups.slice().sort((a, b) => ((a.key === '~none') - (b.key === '~none')) ||
      (S.dir * String(a.label).localeCompare(String(b.label), 'he', { numeric: true })));
  }

  async function render(page) {
    style();
    page.innerHTML = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
      '<h2>כדורים</h2><div class="head-actions"><button class="btn-ghost sm" id="mdsImport"><i class="bi bi-clipboard"></i> הדבקה מאקסל</button>' +
      '<button class="btn-ghost sm" id="mdsXls"><i class="bi bi-download"></i> ייצוא לאקסל</button></div></div>' +
      '<div class="demo-note" style="margin:0 2px 10px"><i class="bi bi-shield-lock"></i> מידע רפואי — גישה למנהל ולמי שמורשה לנהל כדורים. כל שינוי נרשם ביומן.</div>' +
      '<div class="mds-filters" id="mdsChips"></div>' +
      '<div class="mds-sortbar" id="mdsSortBar"><span class="mds-sb-lbl">סדר ותצוגה:</span>' +
      '<label>מיין לפי <select class="inp mb0" id="mdsS1">' + sortOpts(false) + '</select></label>' +
      '<button class="btn-ghost sm" id="mdsDir" type="button" title="כיוון המיון">↑</button>' +
      '<label>ואחר כך לפי <select class="inp mb0" id="mdsS2">' + sortOpts(true) + '</select></label>' +
      '<label>קבץ לפי <select class="inp mb0" id="mdsG">' + GROUP_OPTS.map(o => '<option value="' + o[0] + '">' + esc(o[1]) + '</option>').join('') + '</select></label>' +
      '<button class="btn-ghost sm" id="mdsReset" type="button">איפוס</button></div>' +
      '<div class="mds-filters"><select class="inp mb0" id="mdsCls"><option value="">כל השיעורים</option></select>' +
      '<input type="search" class="inp mb0" id="mdsQ" placeholder="חיפוש תלמיד / תרופה…">' +
      '<div class="mds-menu-wrap"><button class="btn-ghost sm" id="mdsColsBtn"><i class="bi bi-layout-three-columns"></i> עמודות</button>' +
      '<div class="mds-menu" id="mdsColsMenu" hidden></div></div></div>' +
      '<div class="count-line" id="mdsCount"></div>' +
      '<div class="mds-bulk" id="mdsBulk" hidden></div>' +
      '<div class="mds-hint"><i class="bi bi-pencil"></i> לוחצים על תא כדי לערוך. Tab ו-Shift+Tab עוברים לתא הבא והקודם, החצים למעלה ולמטה עוברים לשורה, וכולם שומרים. Enter שומר, Esc מבטל. לחיצה על כותרת עמודה ממיינת.</div>' +
      '<div class="table-wrap mds-wrap"><table class="mds-tbl"><thead id="mdsHead"></thead><tbody id="mdsBody"></tbody></table></div>' +
      '<datalist id="mdsNames"></datalist>';

    let D = null, filter = 'הכל', cls = '', q = '', probOnly = false, hideStopped = false;
    // מיון וקיבוץ: נשמרים ב-localStorage (try/catch)
    let S = Object.assign({}, SORT_DEFAULT);
    try {
      const x = JSON.parse(localStorage.getItem('cv3.mdsSort') || 'null');
      if (x && SORT_KEYS[x.s1]) {
        S.s1 = x.s1; S.s2 = x.s2 && SORT_KEYS[x.s2] ? x.s2 : '';
        S.dir = x.dir === -1 ? -1 : 1;
        S.grp = GROUP_OPTS.some(o => o[0] === x.grp) ? x.grp : '';
      }
    } catch (_) { S = Object.assign({}, SORT_DEFAULT); }
    const collapsed = new Set();
    const saveSort = () => { try { localStorage.setItem('cv3.mdsSort', JSON.stringify({ s1: S.s1, s2: S.s2, dir: S.dir, grp: S.grp })); } catch (_) { /* בלי שמירה — הכל עדיין עובד */ } };
    const syncBar = () => {
      if (!$('#mdsS1')) return;
      $('#mdsS1').value = S.s1; $('#mdsS2').value = S.s2; $('#mdsG').value = S.grp;
      const d = $('#mdsDir'); d.textContent = S.dir === 1 ? '↑' : '↓';
      d.title = S.dir === 1 ? 'סדר עולה (לחצו להפוך)' : 'סדר יורד (לחצו להפוך)';
    };
    const flags = { stale: false, week: false };
    const openNotes = new Set();
    const selected = new Set();
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (_) { prefs = {}; }
    const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) { /* בלי שמירה — הכל עדיין עובד */ } };
    const isOn = c => (prefs[c.k] !== undefined ? !!prefs[c.k] : c.def !== false);
    const visibleCols = () => COLS.filter(c => c.fixed || isOn(c));
    const $ = sel => page.querySelector(sel);

    async function reload() {
      try { D = await loadAll(); }
      catch (e) { window.UI.toast('טעינת הכדורים נכשלה: ' + e.message, 'err'); return; }
      const sel = $('#mdsCls');
      if (!sel.dataset.ready) {
        sel.innerHTML = '<option value="">כל השיעורים</option>' + D.classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
        sel.dataset.ready = '1';
      }
      fillNames();
      draw();
    }

    // רשימת שמות תרופות להשלמה: ייחודיים, לפי שכיחות
    function fillNames() {
      const cnt = {}, disp = {};
      D.meds.forEach(m => {
        const n = String(m.name || '').trim(); if (!n) return;
        const k = normName(n); cnt[k] = (cnt[k] || 0) + 1; if (!disp[k]) disp[k] = n;
      });
      const names = Object.keys(cnt).sort((a, b) => (cnt[b] - cnt[a]) || disp[a].localeCompare(disp[b], 'he'));
      $('#mdsNames').innerHTML = names.map(k => '<option value="' + esc(disp[k]) + '"></option>').join('');
    }

    function rowsFor() {
      const byId = {}; D.classes.forEach(c => byId[c.id] = c.name);
      const cn = s => byId[s.class_id] || 'ללא שיעור';
      const studs = D.studs.slice().sort((a, b) =>
        String(cn(a)).localeCompare(String(cn(b)), 'he') ||
        String(a.family || '').localeCompare(String(b.family || ''), 'he') ||
        String(a.name || '').localeCompare(String(b.name || ''), 'he'));
      return studs.map(s => {
        const st = statusOf(s.id, D.statuses, D.meds);
        const meds = D.meds.filter(m => m.student_id == s.id).sort((a, b) => (b.active - a.active) || (a.id - b.id));
        return { s, cls: cn(s), st, meds };
      });
    }

    function sName(sid) { const s = D.studs.find(x => x.id == sid); return s ? nm(s) : ''; }

    // ───────── ציור ─────────
    function draw() {
      const all = rowsFor();
      const iss = {};
      all.forEach(r => { iss[r.s.id] = issuesOf(r); });
      const counts = { 'הכל': all.length };
      STATUSES.forEach(x => counts[x] = all.filter(r => r.st.status === x).length);
      const probCount = all.filter(r => iss[r.s.id].length).length;
      $('#mdsChips').innerHTML =
        ['הכל'].concat(STATUSES).map(x => '<button class="mds-chip' + (filter === x ? ' on' : '') + '" data-f="' + esc(x) + '">' + esc(x) + ' (' + counts[x] + ')</button>').join('') +
        '<button class="mds-chip' + (flags.stale ? ' on' : '') + '" data-flag="stale">לא עודכן מעל חודש</button>' +
        '<button class="mds-chip' + (flags.week ? ' on' : '') + '" data-flag="week">שונה השבוע</button>' +
        '<button class="mds-chip' + (probOnly ? ' on' : '') + '" data-prob="1">בעיות ברישום (' + probCount + ')</button>' +
        '<button class="mds-chip' + (hideStopped ? ' on' : '') + '" data-hide="1">הסתר כדורים שהופסקו</button>';

      const list = all.filter(r => {
        if (filter !== 'הכל' && r.st.status !== filter) return false;
        if (cls && String(r.s.class_id) !== cls) return false;
        if (q && ![nm(r.s), r.meds.map(m => m.name).join(' ')].join(' ').includes(q)) return false;
        if (flags.stale && !isStale(r)) return false;
        if (flags.week && !r.meds.some(m => { const d = daysSince(m.updated_on); return d != null && d <= 7; })) return false;
        if (probOnly && !iss[r.s.id].length) return false;
        return true;
      });
      $('#mdsCount').textContent = 'מוצגים ' + list.length + ' מתוך ' + all.length + ' תלמידים';

      const vis = visibleCols();
      const has = k => vis.some(c => c.k === k);
      const total = SEL_W + vis.reduce((a, c) => a + c.w, 0);
      const pct = w => (Math.round(w / total * 1000) / 10) + '%';
      $('#mdsHead').innerHTML = '<tr><th class="mds-selc" style="width:' + pct(SEL_W) + '"></th>' + vis.map(c => {
        const arrow = c.sort && c.sort === S.s1 ? (S.dir === 1 ? ' <span class="mds-arr">▲</span>' : ' <span class="mds-arr">▼</span>') : '';
        return '<th' + (c.sort ? ' class="mds-sortable" data-sort="' + c.sort + '"' : '') + ' style="width:' + pct(c.w) + '">' + esc(c.t) + arrow + '</th>';
      }).join('') + '</tr>';

      // סדר התלמידים לפי מיון ראשי ומשני; ואז שורה לכל כדור (או שורה ריקה לתלמיד בלי כדורים)
      const ordered = orderStudents(list, iss, S);
      const lines = [];
      ordered.forEach(r => {
        const meds = orderMeds(hideStopped ? r.meds.filter(m => m.active) : r.meds, S);
        if (!r.meds.length) lines.push({ r, m: null });
        else if (!meds.length) lines.push({ r, m: null, hidden: true });
        else meds.forEach(m => lines.push({ r, m }));
      });
      // קיבוץ: כל כדור הולך לקבוצה שלו (תלמיד עם שתי תרופות מופיע בשתי הקבוצות)
      const gOf = ln => {
        if (S.grp === 'class') return { key: ln.r.cls, label: ln.r.cls };
        if (S.grp === 'status') return { key: ln.r.st.status, label: ln.r.st.status };
        if (S.grp === 'med') return ln.m ? { key: normName(ln.m.name), label: ln.m.name } : { key: '~none', label: 'ללא כדור פעיל' };
        if (S.grp === 'take') { const b = ln.m ? bucketOf(ln.m.take_time) : 'לא ידוע'; return { key: b, label: b }; }
        return { key: '', label: '' };
      };
      const gmap = new Map();
      lines.forEach(ln => {
        const g = gOf(ln);
        if (!gmap.has(g.key)) gmap.set(g.key, { key: g.key, label: g.label, lines: [] });
        gmap.get(g.key).lines.push(ln);
      });
      const groups = orderGroups(Array.from(gmap.values()), S);

      function rowHtml(ln, occ) {
        const { r, m } = ln;
        const sid = r.s.id;
        const sIss = iss[sid].filter(x => x.mid == null);
        const mIss = m ? iss[sid].filter(x => x.mid === m.id) : [];
        const selCell = '<td class="mds-selc">' + (occ ? '<input type="checkbox" data-sel="' + sid + '"' + (selected.has(sid) ? ' checked' : '') + '>' : '') + '</td>';
        const nameCell = '<td><div class="mds-nwrap"><div class="mds-1"><span class="mds-stu" data-open="' + sid + '" title="' + esc(r.cls) + '">' + esc(nm(r.s)) + '</span>' +
          (occ && sIss.length ? ' <span class="mds-warnm" title="' + esc(sIss.map(x => x.text).join('\n')) + '">⚠</span>' : '') + '</div>' +
          (occ ? '<button class="mds-add" data-add="' + sid + '" title="הוספת כדור">+</button>' : '') + '</div></td>';
        const stSel = '<select class="mds-ssel ' + (STATUS_CLS[r.st.status] || '') + '" data-st="' + sid + '" title="' + esc(r.st.note || '') + '">' +
          stOptions(r.st.status) + '</select>';
        const stCell = '<td>' + (occ ? stSel : '<span class="mds-same">〃</span>') + '</td>';
        const trCls = (occ ? 'mds-first' : '');

        if (!m) {
          const msg = r.meds.length ? 'כל הכדורים מוסתרים (הופסקו)' : 'אין רישום כדור. לחיצה על + מוסיפה';
          const medIdx = vis.findIndex(c => c.k === 'med');
          return '<tr class="' + trCls + '">' + selCell + nameCell + (has('status') ? stCell : '') +
            '<td colspan="' + (vis.length - medIdx) + '" class="mds-empty">' + msg + '</td></tr>';
        }

        const ed = (k, text) => '<td class="mds-ed" data-ed="' + k + '" data-id="' + m.id + '" title="' + esc(text || '') + '"><div class="mds-1">' + esc(text || '—') + '</div></td>';
        const extra = [];
        if (!has('take_how') && m.take_how) extra.push('אופן: ' + m.take_how);
        if (!has('noon') && m.second) extra.push('כדור בצהריים: ' + [m.dose2, m.hours2].filter(Boolean).join(' '));
        if (!has('side') && (m.side_during || m.side_after)) extra.push('תופעות: ' + [m.side_during, m.side_after].filter(Boolean).join(' / '));
        if (!has('purpose') && m.purpose) extra.push('מטרה: ' + m.purpose);
        const noteText = [m.notes].concat(extra).filter(Boolean).join(' · ');
        const notesCell = '<td class="mds-ed mds-notes' + (openNotes.has(m.id) ? ' mds-open' : '') + '" data-ed="notes" data-id="' + m.id + '" title="' + esc(noteText) + '"><div class="mds-nwrap"><div class="mds-1">' + esc(noteText || '—') + '</div>' +
          (noteText.length > 25 ? '<button class="mds-more" data-more="' + m.id + '">' + (openNotes.has(m.id) ? 'סגור' : 'המשך') + '</button>' : '') + '</div></td>';
        const stale = daysSince(m.updated_on);
        const staleCls = (m.active && (stale == null || stale > STALE_DAYS)) ? ' mds-stale' : '';

        const cells = vis.map(c => {
          switch (c.k) {
            case 'name': return nameCell;
            case 'status': return stCell;
            case 'med': return '<td class="mds-ed" data-ed="name" data-id="' + m.id + '" title="' + esc(m.purpose || '') + '"><div class="mds-nwrap"><div class="mds-1">' + esc(m.name) +
              (m.active ? '' : ' <span class="mds-chip-s mds-off">הופסק</span>') +
              (mIss.length ? ' <span class="mds-warnm" title="' + esc(mIss.map(x => x.text).join('\n')) + '">⚠</span>' : '') +
              '</div><button class="mds-more" data-info="' + m.id + '" title="הסבר על התרופה">ⓘ</button></div></td>';
            case 'dose': return ed('dose', m.dose);
            case 'take_time': return ed('take_time', m.take_time);
            case 'hours': return ed('hours', m.hours);
            case 'updated': return '<td><div class="mds-1">' + (m.updated_on ? esc(fmtDate(m.updated_on).slice(0, 6) + String(m.updated_on).slice(2, 4)) : '—') + '</div></td>';
            case 'notes': return notesCell;
            case 'take_how': return '<td><div class="mds-1">' + esc(m.take_how || '—') + '</div></td>';
            case 'noon': return '<td><div class="mds-1">' + (m.second ? esc((m.dose2 || '—') + ' · ' + (m.hours2 || '—')) : '—') + '</div></td>';
            case 'side': return '<td><div class="mds-1">' + esc([m.side_during, m.side_after].filter(Boolean).join(' / ') || '—') + '</div></td>';
            case 'purpose': return '<td><div class="mds-1">' + esc(m.purpose || '—') + '</div></td>';
            default: return '<td></td>';
          }
        }).join('');
        return '<tr class="' + trCls + staleCls + (m.active ? '' : ' mds-stop') + '">' + selCell + cells + '</tr>';
      }

      let body = '';
      groups.forEach(g => {
        if (S.grp) {
          const shut = collapsed.has(S.grp + '|' + g.key);
          const nStud = new Set(g.lines.map(l => l.r.s.id)).size;
          const nMeds = g.lines.filter(l => l.m).length;
          body += '<tr class="mds-group" data-grp="' + esc(g.key) + '"><td colspan="' + (vis.length + 1) + '"><span class="mds-gt">' + (shut ? '▸' : '▾') + '</span> <b>' + esc(g.label) + '</b> <span class="mds-gc">· ' + nStud + (nStud === 1 ? ' תלמיד' : ' תלמידים') + ' · ' + nMeds + (nMeds === 1 ? ' כדור' : ' כדורים') + '</span></td></tr>';
          if (shut) return;
        }
        const seen = {};
        g.lines.forEach(ln => {
          const sid = ln.r.s.id;
          const occ = !seen[sid]; seen[sid] = true;
          body += rowHtml(ln, occ);
        });
      });
      $('#mdsBody').innerHTML = body || '<tr><td colspan="' + (vis.length + 1) + '" style="text-align:center;color:#94a3b8;padding:20px">אין תלמידים מתאימים</td></tr>';

      $('#mdsColsMenu').innerHTML = COLS.filter(c => !c.fixed).map(c =>
        '<label class="mds-mi"><input type="checkbox" data-col="' + c.k + '"' + (isOn(c) ? ' checked' : '') + '> ' + esc(c.t) + '</label>').join('');
      updateBulk();
      syncBar();
    }

    function updateBulk() {
      const bar = $('#mdsBulk');
      if (!selected.size) { bar.hidden = true; bar.innerHTML = ''; return; }
      bar.hidden = false;
      bar.innerHTML = '<span>נבחרו <b>' + selected.size + '</b> תלמידים</span>' +
        '<label>שנה סטטוס ל-<select class="inp mb0" data-bulk="1"><option value="">בחרו…</option>' +
        stOptions('') + '</select></label>' +
        '<button class="btn-ghost sm" data-bulkclear="1">נקה בחירה</button>';
    }

    // ───────── ביטול (6 שניות) ─────────
    let undoTimer = null;
    function pushUndo(msg, undo) {
      const old = document.getElementById('mdsUndo'); if (old) old.remove();
      const bar = document.createElement('div'); bar.id = 'mdsUndo'; bar.className = 'mds-undo';
      bar.innerHTML = '<span>' + esc(msg) + '</span><button type="button" class="mds-undo-b">בטל</button>';
      document.body.appendChild(bar);
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => bar.remove(), 6000);
      bar.querySelector('button').addEventListener('click', async () => {
        clearTimeout(undoTimer); bar.remove();
        try { await undo(); window.UI.toast('בוטל'); await reload(); }
        catch (e) { window.UI.toast(e.message || 'הביטול נכשל', 'err'); }
      });
    }

    function applyMed(id, row) { const m = D.meds.find(x => x.id == id); if (m) Object.assign(m, row); }
    function applyStatus(sid, status, note) {
      const row = D.statuses.find(x => x.student_id == sid);
      if (row) { row.status = status; row.note = note || null; }
      else D.statuses.push({ student_id: sid, status, note: note || null });
    }

    // ───────── עריכה ישר בטבלה ─────────
    const fullRow = m => ({ name: m.name, purpose: m.purpose, dose: m.dose, hours: m.hours, take_time: m.take_time, take_how: m.take_how,
      side_during: m.side_during, side_after: m.side_after, second: !!m.second, dose2: m.dose2, hours2: m.hours2, notes: m.notes,
      active: !!m.active, updated_on: m.updated_on, category: 'תרופה' });

    // היעד של Tab / חצים, מחושב לפני השמירה (לפי ה-DOM הנוכחי)
    function navTarget(td, dir) {
      let t = null;
      if (dir === 'next' || dir === 'prev') {
        const tds = Array.from(page.querySelectorAll('#mdsBody td.mds-ed'));
        const i = tds.indexOf(td);
        t = tds[i + (dir === 'next' ? 1 : -1)] || null;
      } else {
        const k = td.dataset.ed;
        const rows = Array.from(page.querySelectorAll('#mdsBody tr'));
        const step = dir === 'down' ? 1 : -1;
        for (let j = rows.indexOf(td.closest('tr')) + step; j >= 0 && j < rows.length; j += step) {
          const c = rows[j].querySelector('td[data-ed="' + k + '"]');
          if (c) { t = c; break; }
        }
      }
      return t ? { id: t.dataset.id, k: t.dataset.ed } : null;
    }
    function focusTarget(t) {
      if (!t) return;
      const td = page.querySelector('#mdsBody td[data-ed="' + t.k + '"][data-id="' + t.id + '"]');
      if (td) startEdit(td);
    }

    // עריכת הערות: חלון עם תיבת טקסט גדולה. הטקסט הקיים נשאר, הסמן בסוף,
    // ואפשר ללחוץ בכל מקום בטקסט ולשנות שם. "הוספת הערה" מוסיפה שורה חדשה עם תאריך.
    function editNotes(m) {
      const { body, close } = makeOverlay('הערות — ' + sName(m.student_id) + ' · ' + (m.name || ''));
      const oldV = m.notes == null ? '' : String(m.notes);
      const extra = [m.take_how && 'אופן: ' + m.take_how, m.second && ('כדור בצהריים: ' + (m.dose2 || '') + ' ' + (m.hours2 || '')).trim(),
        (m.side_during || m.side_after) && 'תופעות: ' + [m.side_during, m.side_after].filter(Boolean).join(' / ')].filter(Boolean);
      body.innerHTML =
        '<textarea class="inp mb0" id="mdsNotesTa" rows="8" style="width:100%;font-family:inherit;line-height:1.6;resize:vertical"></textarea>' +
        '<p class="mds-hint">אפשר ללחוץ בכל מקום בטקסט ולשנות. Ctrl+Enter שומר, Esc סוגר בלי לשמור.</p>' +
        (extra.length ? '<div class="mds-hint" style="background:#f8fafc;border-radius:8px;padding:6px 8px">' + extra.map(esc).join('<br>') +
          '<br><i>(את אלה משנים בחלון התלמיד)</i></div>' : '') +
        '<div class="mds-row" style="margin-top:12px"><button class="btn-primary sm" id="mdsNSave">שמירה</button>' +
        '<button class="btn-ghost sm" id="mdsNAdd"><i class="bi bi-plus-lg"></i> הוספת הערה</button>' +
        '<button class="btn-ghost sm" id="mdsNCancel">ביטול</button></div>';
      const ta = body.querySelector('#mdsNotesTa');
      ta.value = oldV;
      const toEnd = () => { ta.focus(); const n = ta.value.length; ta.setSelectionRange(n, n); ta.scrollTop = ta.scrollHeight; };
      setTimeout(toEnd, 30);
      body.querySelector('#mdsNAdd').addEventListener('click', () => {
        // חותמת: תאריך עברי + לועזי, למשל "ה' כסלו תשפ"ז · 26/11/2026: "
        const d = new Date();
        let heb = '';
        try { heb = (window.UI && window.UI.hebDate) ? window.UI.hebDate(d) : ''; } catch (_) {}
        if (!heb) { try { heb = d.toLocaleDateString('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) {} }
        const greg = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
        const stamp = (heb ? heb + ' · ' : '') + greg + ': ';
        ta.value = ta.value.replace(/\s+$/, '') + (ta.value.trim() ? '\n' : '') + stamp;
        toEnd();
      });
      const doSave = async () => {
        const v = ta.value.replace(/\s+$/, '');
        if (v === oldV.replace(/\s+$/, '')) { close(); return; }
        const before = fullRow(m);
        const row = fullRow(m); row.notes = v || null; row.updated_on = today();
        try {
          await save('update', m.student_id, m.id, row, null);
          applyMed(m.id, row);
          pushUndo('עודכנו הערות ב' + sName(m.student_id), async () => { await save('update', m.student_id, m.id, before, null); });
          close(); draw();
        } catch (e) { window.UI.toast(e.message || 'השמירה נכשלה', 'err'); }
      };
      body.querySelector('#mdsNSave').addEventListener('click', doSave);
      body.querySelector('#mdsNCancel').addEventListener('click', close);
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); } });
    }

    function startEdit(td) {
      if (td.querySelector('input')) return;
      const m = D.meds.find(x => x.id == td.dataset.id); if (!m) return;
      if (td.dataset.ed === 'notes') return editNotes(m);
      const k = td.dataset.ed, oldV = m[k] == null ? '' : String(m[k]);
      td.innerHTML = '<input class="inp mb0 mds-in"' + (k === 'name' ? ' list="mdsNames"' : '') + ' value="' + esc(oldV) + '">';
      // בלי לסמן הכול: הסמן בסוף, ואפשר ללחוץ באמצע הטקסט ולשנות שם
      const inp = td.querySelector('input'); inp.focus(); const L = inp.value.length; inp.setSelectionRange(L, L);
      let done = false;
      const finish = async (ok, dir) => {
        if (done) return; done = true;
        const target = dir ? navTarget(td, dir) : null;
        const v = inp.value.trim();
        if (!ok || v === oldV.trim()) { draw(); focusTarget(target); return; }
        if (k === 'name' && !v) { window.UI.toast('חובה שם תרופה', 'err'); draw(); return; }
        const before = fullRow(m);
        const row = fullRow(m); row[k] = v || null; row.updated_on = today();
        try {
          await save('update', m.student_id, m.id, row, null);
          applyMed(m.id, row);
          pushUndo('עודכן ' + LABEL[k] + ' ב' + sName(m.student_id), async () => { await save('update', m.student_id, m.id, before, null); });
          draw();
          focusTarget(target);
        } catch (e) { window.UI.toast(e.message || 'השמירה נכשלה', 'err'); draw(); }
      };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? 'prev' : 'next'); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); finish(true, 'down'); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); finish(true, 'up'); }
      });
      inp.addEventListener('blur', () => finish(true));
    }

    async function applyBulk(status) {
      const olds = Array.from(selected).map(sid => { const o = statusOf(sid, D.statuses, D.meds); return { sid, status: o.status, note: o.note || '' }; });
      let n = 0;
      try {
        for (const o of olds) { await save('status', o.sid, null, { status, note: o.note }, null); applyStatus(o.sid, status, o.note); n++; }
      } catch (e) { window.UI.toast(e.message || 'השמירה נכשלה', 'err'); }
      selected.clear();
      draw();
      if (n) {
        const done = olds.slice(0, n);
        pushUndo('סטטוס ' + n + ' תלמידים שונה ל-' + status, async () => {
          for (const o of done) await save('status', o.sid, null, { status: o.status, note: o.note }, null);
        });
      }
    }

    // ───────── הדבקה מאקסל ─────────
    function openImport() {
      const { body, close } = makeOverlay('הדבקה מאקסל');
      body.innerHTML = '<p class="mds-hint">מדביקים שורות מאקסל בסדר: שם תלמיד, תרופה, מינון, זמן נטילה, הערות (העמודות מופרדות בטאב). לפני האישור רואים מה יתווסף.</p>' +
        '<textarea class="inp mb0" id="mdsPaste" rows="8" style="width:100%;font-family:inherit" placeholder="שם תלמיד ⇥ תרופה ⇥ מינון ⇥ זמן נטילה ⇥ הערות"></textarea>' +
        '<div id="mdsPrev" style="margin-top:10px"></div>' +
        '<div class="mds-row" style="margin-top:12px"><button class="btn-primary sm" id="mdsDoImp" disabled>אישור והוספה</button>' +
        '<button class="btn-ghost sm" id="mdsCancelImp">ביטול</button></div>';
      const ta = body.querySelector('#mdsPaste');
      const prev = body.querySelector('#mdsPrev');
      const btn = body.querySelector('#mdsDoImp');
      const paint = () => {
        const parsed = parsePaste(ta.value, D);
        const ok = parsed.filter(x => x.ok).length;
        prev.innerHTML = parsed.length ? '<table class="mds-tbl" style="font-size:13px"><thead><tr><th>תלמיד</th><th>תרופה</th><th>מינון</th><th>זמן נטילה</th><th>הערות</th><th>פעולה</th></tr></thead><tbody>' +
          parsed.map(x => '<tr><td>' + (x.sid ? esc(x.sname) : '<span style="color:#b91c1c">לא זוהה</span>') + (!x.sid ? '' : '') + '</td>' +
            '<td>' + esc(x.mname || '—') + '</td><td>' + esc(x.dose || '—') + '</td><td>' + esc(x.take || '—') + '</td><td>' + esc(x.notes || '—') + '</td>' +
            '<td title="' + esc(x.reason) + '">' + (x.ok ? (x.existing ? 'יעודכן' : 'חדש') : '<span style="color:#b91c1c">ידולג' + (x.reason ? ' (' + esc(x.reason) + ')' : '') + '</span>') + '</td></tr>').join('') +
          '</tbody></table>' : '';
        btn.disabled = ok === 0;
        btn.textContent = 'אישור והוספה (' + ok + ')';
      };
      ta.addEventListener('input', paint);
      body.querySelector('#mdsCancelImp').addEventListener('click', close);
      btn.addEventListener('click', async () => {
        const all = parsePaste(ta.value, D);
        const todo = all.filter(x => x.ok);
        btn.disabled = true;
        let added = 0, updated = 0;
        try {
          for (const x of todo) {
            const ex = x.existing ? D.meds.find(m => m.id === x.existing.id) : null;
            if (ex) {
              const full = fullRow(ex);
              if (x.dose) full.dose = x.dose;
              if (x.take) full.take_time = x.take;
              if (x.notes) full.notes = x.notes;
              full.updated_on = today();
              await save('update', x.sid, ex.id, full, null);
              applyMed(ex.id, full); updated++;
            } else {
              await save('insert', x.sid, null, { name: x.mname, dose: x.dose || null, take_time: x.take || null, notes: x.notes || null,
                active: true, updated_on: today(), category: 'תרופה' }, null);
              added++;
            }
          }
        } catch (e) { window.UI.toast('שגיאה באמצע הייבוא: ' + (e.message || ''), 'err'); }
        close();
        window.UI.toast('נוספו ' + added + ', עודכנו ' + updated + ', דולגו ' + (all.length - todo.length));
        await reload();
      });
    }

    // ───────── ייצוא לאקסל (HTML טבלה שאקסל פותח בעברית, מימין לשמאל) ─────────
    function exportXls() {
      if (!D) return;
      const head = ['תלמיד', 'שיעור', 'סטטוס', 'הערת סטטוס', 'תרופה', 'מטרה', 'מינון', 'זמן נטילה', 'אופן נטילה', 'שעות השפעה', 'כדור בצהריים', 'תופעות', 'הערות הורים', 'עודכן', 'פעיל'];
      const rows = [];
      rowsFor().forEach(r => {
        if (!r.meds.length) rows.push([nm(r.s), r.cls, r.st.status, r.st.note, '', '', '', '', '', '', '', '', '', '', '']);
        r.meds.forEach(m => rows.push([nm(r.s), r.cls, r.st.status, r.st.note, m.name, m.purpose, m.dose, m.take_time, m.take_how,
          m.hours, m.second ? [m.dose2, m.hours2].filter(Boolean).join(' ') : '', [m.side_during, m.side_after].filter(Boolean).join(' / '),
          m.notes, m.updated_on ? fmtDate(m.updated_on) : '', m.active ? 'כן' : 'לא']));
      });
      const html = '﻿<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40" dir="rtl">' +
        '<head><meta charset="utf-8"></head><body><table border="1" dir="rtl"><tr>' +
        head.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr>' +
        rows.map(r => '<tr>' + r.map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') +
        '</table></body></html>';
      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'כדורים.xls'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    }

    // ───────── חלונית תלמיד ─────────
    async function openStudent(sid, addNew) {
      const s = D.studs.find(x => x.id == sid);
      if (!s) return;
      const { body, close } = makeOverlay(nm(s) + ' — ' + ((D.classes.find(c => c.id == s.class_id) || {}).name || ''));

      let hist = [];
      try { hist = await loadHistory(sid); } catch (e) { window.UI.toast('היסטוריה לא נטענה: ' + e.message, 'err'); }

      async function openStudentRefresh() {
        const fresh = D.studs.find(x => x.id == sid); if (!fresh) return close();
        try { hist = await loadHistory(sid); } catch (_) {}
        viewMode();
      }
      const refresh = async () => { await reload(); await openStudentRefresh(); };

      function noteVal() { const el = body.querySelector('#mdsUpdNote'); return el ? el.value.trim() : ''; }

      function viewMode() {
        const st = statusOf(sid, D.statuses, D.meds);
        const meds = D.meds.filter(m => m.student_id == sid).sort((a, b) => (b.active - a.active) || (a.id - b.id));
        body.innerHTML =
          '<div class="mds-sec"><h4>סטטוס</h4><div class="mds-row">' +
            '<select class="inp mb0" id="mdsStatus">' + stOptions(st.status) + '</select>' +
            '<input class="inp mb0" id="mdsStNote" placeholder="הערת סטטוס" value="' + esc(st.note || '') + '" style="flex:1;min-width:180px">' +
            '<button class="btn-primary sm" data-act="status">שמור סטטוס</button></div></div>' +
          '<div class="mds-sec"><h4>כדורים</h4>' +
            (meds.length ? meds.map(m => '<div class="mds-med"><div>' +
              '<b class="' + (m.active ? '' : 'mds-stop') + '">' + esc(m.name) + '</b>' + (m.active ? '' : ' <span class="mds-chip-s mds-off">הופסק</span>') +
              '<small>' + ['מינון: ' + shown('dose', m.dose), 'שעות: ' + shown('hours', m.hours), 'זמן: ' + shown('take_time', m.take_time),
                'אופן: ' + shown('take_how', m.take_how)].map(esc).join(' · ') + '</small>' +
              (m.second ? '<small>כדור נוסף: ' + esc(shown('dose2', m.dose2)) + ' · ' + esc(shown('hours2', m.hours2)) + '</small>' : '') +
              (m.side_during || m.side_after ? '<small>תופעות: ' + esc([m.side_during, m.side_after].filter(Boolean).join(' / ')) + '</small>' : '') +
              (m.notes ? '<small>הערות: ' + esc(m.notes) + '</small>' : '') +
              '</div><div class="mds-row">' +
                '<button class="btn-ghost sm" data-act="edit" data-id="' + m.id + '">עריכה</button>' +
                '<button class="btn-ghost sm" data-act="toggle" data-id="' + m.id + '">' + (m.active ? 'סמן כהופסק' : 'חזר לקחת') + '</button>' +
                '<button class="btn-ghost sm" data-act="del" data-id="' + m.id + '">מחיקה</button>' +
              '</div></div>').join('') : '<div style="color:#94a3b8">אין רישום כדור לתלמיד</div>') +
            '<button class="btn-primary sm" data-act="add" style="margin-top:6px"><i class="bi bi-plus-lg"></i> הוספת כדור</button></div>' +
          '<div class="mds-sec"><h4>הערת עדכון חופשית</h4>' +
            '<p style="font-size:12px;color:#64748b;margin:0 0 6px">הנוסח נשמר ביומן עם כל שינוי שתעשה כאן (גם בשמירת סטטוס).</p>' +
            '<div class="mds-row"><input class="inp mb0" id="mdsUpdNote" placeholder="למשל: הורה עדכן שהתחיל מינון חדש" style="flex:1;min-width:200px">' +
            '<button class="btn-ghost sm" data-act="note">שמור הערה בלבד</button></div></div>' +
          '<div class="mds-sec"><h4>היסטוריית שינויים</h4>' +
            (hist.length ? '<div class="mds-hist">' + hist.map(h =>
              '<div><time>' + esc(fmtTs(h.changed_at)) + '</time> · <b>' + esc(h.changed_by_name || 'מערכת') + '</b> · ' +
              esc(h.kind === 'הערה' ? 'הערה' : h.kind === 'סטטוס' ? 'סטטוס' : (h.action === 'insert' ? 'הוספה' : h.action === 'delete' ? 'מחיקה' : 'עדכון כדור')) +
              '<br>' + describe(h) + (h.note && h.kind !== 'הערה' ? '<br><i>הערת עדכון: ' + esc(h.note) + '</i>' : '') + '</div>').join('') + '</div>'
              : '<div style="color:#94a3b8">אין שינויים עדיין</div>') + '</div>';
      }

      function formMode(rec) {
        const f = medFields();
        const one = x => {
          const v = rec && rec[x.k] != null ? rec[x.k] : '';
          let input;
          if (x.type === 'bool') input = '<select class="inp mb0" data-m="' + x.k + '"><option value="">לא</option><option value="1"' + (v === true ? ' selected' : '') + '>כן</option></select>';
          else if (x.opts) input = '<select class="inp mb0" data-m="' + x.k + '"><option value=""></option>' + x.opts.map(o => '<option' + (String(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
          else input = '<input class="inp mb0" data-m="' + x.k + '"' + (x.type === 'date' ? ' type="date"' : '') + (x.k === 'name' ? ' list="mdsNames"' : '') + ' value="' + esc(x.type === 'date' ? String(v).slice(0, 10) : v) + '">';
          return '<label class="' + (x.wide ? 'wide' : '') + '"><span>' + esc(x.t) + (x.req ? ' *' : '') + '</span>' + input + '</label>';
        };
        body.innerHTML = '<div class="mds-sec"><h4>' + (rec ? 'עריכת כדור' : 'כדור חדש') + '</h4><div class="mds-form">' + f.map(one).join('') + '</div></div>' +
          '<div class="mds-row"><button class="btn-primary sm" data-act="savemed">שמירה</button>' +
          '<button class="btn-ghost sm" data-act="back">ביטול</button></div>';
        body.querySelector('[data-act="savemed"]').dataset.id = rec ? rec.id : '';
      }

      function readForm() {
        const row = {};
        medFields().forEach(x => {
          const el = body.querySelector('[data-m="' + x.k + '"]'); if (!el) return;
          const v = (el.value || '').trim();
          row[x.k] = x.type === 'bool' ? v === '1' : (v || null);
        });
        return row;
      }

      async function act(kind, id) {
        try {
          if (kind === 'status') {
            const status = body.querySelector('#mdsStatus').value;
            const sn = body.querySelector('#mdsStNote').value.trim();
            await save('status', sid, null, { status, note: sn }, noteVal());
          } else if (kind === 'note') {
            const n = noteVal();
            if (!n) { window.UI.toast('כתבו הערה קודם', 'err'); return; }
            await save('note', sid, null, null, n);
          } else if (kind === 'toggle') {
            const m = D.meds.find(x => x.id == id);
            const data = { name: m.name, purpose: m.purpose, dose: m.dose, hours: m.hours, take_time: m.take_time, take_how: m.take_how,
              side_during: m.side_during, side_after: m.side_after, second: !!m.second, dose2: m.dose2, hours2: m.hours2, notes: m.notes,
              active: !m.active, updated_on: today(), category: 'תרופה' };
            await save('update', sid, id, data, noteVal());
          } else if (kind === 'del') {
            if (!await window.UI.confirm('למחוק את הכדור? הרישום יימחק ויישאר רק ביומן.')) return;
            await save('delete', sid, id, null, noteVal());
          }
          window.UI.toast('נשמר');
          await refresh();
        } catch (e) { window.UI.toast(e.message || 'השמירה נכשלה', 'err'); }
      }

      body.addEventListener('click', async e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const kind = b.dataset.act;
        if (kind === 'add') return formMode(null);
        if (kind === 'edit') return formMode(D.meds.find(x => x.id == b.dataset.id));
        if (kind === 'back') return viewMode();
        if (kind === 'savemed') {
          const row = readForm();
          if (!row.name) { window.UI.toast('חובה שם תרופה', 'err'); return; }
          const id = b.dataset.id ? Number(b.dataset.id) : null;
          const old = id ? D.meds.find(x => x.id == id) : null;
          // עודכן בתאריך: אם שינו משהו ולא נקבע תאריך ידנית — היום
          if (!row.updated_on || (old && String(old.updated_on || '').slice(0, 10) === row.updated_on)) row.updated_on = today();
          row.category = 'תרופה';
          try {
            await save(id ? 'update' : 'insert', sid, id, row, noteVal());
            window.UI.toast(id ? 'עודכן' : 'נוסף');
            await refresh();
          } catch (err) { window.UI.toast(err.message || 'השמירה נכשלה', 'err'); }
          return;
        }
        act(kind, b.dataset.id);
      });

      if (addNew) formMode(null); else viewMode();
    }

    // ───────── אירועים ─────────
    page.addEventListener('change', async e => {
      const t = e.target;
      if (t.id === 'mdsS1') { S.s1 = t.value; S.dir = SORT_KEYS[t.value].def; saveSort(); draw(); return; }
      if (t.id === 'mdsS2') { S.s2 = t.value; saveSort(); draw(); return; }
      if (t.id === 'mdsG') { S.grp = t.value; saveSort(); draw(); return; }
      if (t.matches('input[data-col]')) { prefs[t.dataset.col] = t.checked; savePrefs(); draw(); return; }
      if (t.matches('input[data-sel]')) { const sid = Number(t.dataset.sel); if (t.checked) selected.add(sid); else selected.delete(sid); updateBulk(); return; }
      if (t.matches('select[data-bulk]')) { if (t.value) await applyBulk(t.value); return; }
      const sel = t.closest('[data-st]'); if (!sel) return;
      const sid = Number(sel.dataset.st);
      const old = statusOf(sid, D.statuses, D.meds);
      const oldRow = { status: old.status, note: old.note || '' };
      const newStatus = sel.value;
      try {
        await save('status', sid, null, { status: newStatus, note: oldRow.note }, null);
        applyStatus(sid, newStatus, oldRow.note);
        pushUndo('הסטטוס של ' + sName(sid) + ' שונה ל-' + newStatus, async () => { await save('status', sid, null, oldRow, null); });
        draw();
      } catch (err) { window.UI.toast(err.message || 'השמירה נכשלה', 'err'); draw(); }
    });

    page.addEventListener('click', e => {
      const t = e.target;
      const chip = t.closest('[data-f]');
      if (chip) { filter = chip.dataset.f; draw(); return; }
      const flag = t.closest('[data-flag]');
      if (flag) { flags[flag.dataset.flag] = !flags[flag.dataset.flag]; draw(); return; }
      if (t.closest('[data-prob]')) { probOnly = !probOnly; draw(); return; }
      if (t.closest('[data-hide]')) { hideStopped = !hideStopped; draw(); return; }
      if (t.closest('#mdsColsBtn')) { const mn = $('#mdsColsMenu'); mn.hidden = !mn.hidden; return; }
      if (t.closest('[data-bulkclear]')) { selected.clear(); draw(); return; }
      const grpRow = t.closest('tr.mds-group');
      if (grpRow) { const ck = S.grp + '|' + grpRow.dataset.grp; collapsed.has(ck) ? collapsed.delete(ck) : collapsed.add(ck); draw(); return; }
      if (t.closest('#mdsDir')) { S.dir = -S.dir; saveSort(); draw(); return; }
      if (t.closest('#mdsReset')) { S = Object.assign({}, SORT_DEFAULT); collapsed.clear(); saveSort(); draw(); return; }
      // כותרת עמודה מעדכנת את "מיין לפי" (סנכרון דו-כיווני)
      const th = t.closest('th[data-sort]');
      if (th) { const k = th.dataset.sort; if (S.s1 === k) S.dir = -S.dir; else { if (S.s2 === k) S.s2 = ''; S.s1 = k; S.dir = SORT_KEYS[k].def; } saveSort(); draw(); return; }
      const more = t.closest('[data-more]');
      if (more) { const id = Number(more.dataset.more); openNotes.has(id) ? openNotes.delete(id) : openNotes.add(id); draw(); return; }
      const add = t.closest('[data-add]');
      if (add) { openStudent(Number(add.dataset.add), true); return; }
      const info = t.closest('[data-info]');
      if (info) { const m = D.meds.find(x => x.id == info.dataset.info); if (m) openInfo(m.name); return; }
      const open = t.closest('[data-open]');
      if (open) { openStudent(Number(open.dataset.open)); return; }
      const cell = t.closest('.mds-ed');
      if (cell && !t.closest('input')) startEdit(cell);
    });
    $('#mdsCls').addEventListener('change', e => { cls = e.target.value; draw(); });
    $('#mdsQ').addEventListener('input', e => { q = (e.target.value || '').trim(); draw(); });
    $('#mdsXls').addEventListener('click', () => exportXls());
    $('#mdsImport').addEventListener('click', () => { if (D) openImport(); });

    await reload();
    const want = window.__medsOpenSid; window.__medsOpenSid = null;
    if (want && D.studs.some(x => x.id == want)) openStudent(want);
  }

  // נתונים לכרטיס התלמיד: סטטוס נוכחי והיסטוריה. לא זורק שגיאה — בכשל מחזיר ריק.
  async function statusList() {
    if (live()) {
      const r = await window.sb.from('student_med_status').select('*');
      if (r.error) throw new Error(r.error.message);
      return r.data || [];
    }
    return (await window.store.list('student_med_status')) || [];
  }
  async function cardData(sid) {
    let status = null, hist = [];
    try { status = (await statusList()).find(x => x.student_id == sid) || null; } catch (_) { status = null; }
    try { hist = await loadHistory(sid); } catch (_) { hist = []; }
    return { status, hist };
  }

  // מבקש לפתוח כרטיס תלמיד בדף הכדורים: הדף נפתח ואז חלון התלמיד (ראה render בסוף)
  function openStudentById(sid) {
    window.__medsOpenSid = Number(sid);
    if (window.showPage) window.showPage('meds');
  }

  window.cv3Meds = { loadAll, describe, cardData, openStudentById };
  const R = window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  R.meds = render;
})();
