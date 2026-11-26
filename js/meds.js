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
  const STATUSES = ['לוקח', 'לא לוקח', 'לבדוק'];
  const STATUS_CLS = { 'לוקח': 'mds-ok', 'לא לוקח': 'mds-off', 'לבדוק': 'mds-warn' };

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

  // ───────── טבלה ─────────
  const CSS = `
  .mds-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
  .mds-chip{border:1px solid var(--line,#d1d5db);background:var(--card,#fff);border-radius:999px;padding:6px 14px;cursor:pointer;font:inherit;color:inherit}
  .mds-chip.on{background:var(--primary,#003048);color:#fff;border-color:var(--primary,#003048)}
  .mds-tbl{width:100%;border-collapse:collapse;font-size:14px}
  .mds-tbl th{position:sticky;top:0;background:var(--card,#fff);text-align:right;padding:8px;border-bottom:2px solid var(--line,#d1d5db);white-space:nowrap}
  .mds-tbl td{padding:7px 8px;border-bottom:1px solid var(--line,#e5e7eb);vertical-align:top}
  .mds-tbl tr.mds-first td{border-top:2px solid var(--line,#cbd5e1)}
  .mds-stu{cursor:pointer;color:var(--primary,#003048);font-weight:600;white-space:nowrap}
  .mds-stu:hover{text-decoration:underline}
  .mds-cls{display:block;font-size:12px;color:#64748b;font-weight:400}
  .mds-chip-s{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;white-space:nowrap}
  .mds-ok{background:#dcfce7;color:#166534} .mds-off{background:#e5e7eb;color:#374151} .mds-warn{background:#fef3c7;color:#92400e}
  .mds-note{display:block;font-size:12px;color:#64748b;margin-top:3px;max-width:200px}
  .mds-stop{text-decoration:line-through;color:#94a3b8}
  .mds-stale{background:#fff5f5}
  .mds-tbl{table-layout:fixed}
  .mds-wrap{overflow-x:hidden !important;width:100%}
  .mds-tbl{min-width:0 !important}
  .mds-tbl th:nth-child(1){width:15%} .mds-tbl th:nth-child(2){width:10%} .mds-tbl th:nth-child(3){width:14%}
  .mds-tbl th:nth-child(4){width:9%} .mds-tbl th:nth-child(5){width:11%} .mds-tbl th:nth-child(6){width:9%}
  .mds-tbl th:nth-child(7){width:9%} .mds-tbl th:nth-child(8){width:23%}
  .mds-tbl th,.mds-tbl td{padding:6px 5px;overflow:hidden}
  .mds-tbl th{white-space:normal;font-size:13px}
  .mds-tbl td{height:38px;vertical-align:middle}
  .mds-nwrap{display:flex;align-items:center;gap:4px}
  .mds-nwrap .mds-1{flex:1;min-width:0}
  .mds-more{flex:none;border:0;background:#e0f2fe;color:#075985;border-radius:6px;padding:1px 7px;font:inherit;font-size:12px;cursor:pointer}
  td.mds-open .mds-1{white-space:normal}
  td.mds-open .mds-nwrap{align-items:flex-start}
  .mds-ssel{max-width:100%}
  @media (max-width:700px){ .mds-tbl{font-size:12px} }
  .mds-1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mds-ed{cursor:text} .mds-ed:hover{background:#f1f5f9;outline:1px dashed #94a3b8;outline-offset:-2px}
  .mds-in{width:100%;padding:4px 6px;font:inherit}
  .mds-ssel{border:0;border-radius:999px;padding:3px 8px;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
  .mds-add{border:1px solid var(--line,#cbd5e1);background:transparent;border-radius:6px;width:22px;height:22px;line-height:18px;padding:0;cursor:pointer;color:var(--primary,#003048)}
  .mds-same{color:#cbd5e1}
  tr.mds-stop td{color:#94a3b8}
  .mds-hint{font-size:12px;color:#64748b;margin:4px 2px 6px}
  .mds-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:260;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px}
  .mds-card{background:var(--card,#fff);color:inherit;border-radius:14px;width:min(760px,100%);box-shadow:0 20px 50px rgba(0,0,0,.3)}
  .mds-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line,#e5e7eb)}
  .mds-head h3{margin:0;font-size:18px}
  .mds-body{padding:16px 18px}
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

  async function render(page) {
    style();
    page.innerHTML = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
      '<h2>כדורים</h2><div class="head-actions"><button class="btn-ghost sm" id="mdsCsv"><i class="bi bi-download"></i> ייצוא CSV</button></div></div>' +
      '<div class="demo-note" style="margin:0 2px 10px"><i class="bi bi-shield-lock"></i> מידע רפואי — גישה למנהל ולמי שמורשה לנהל כדורים. כל שינוי נרשם ביומן.</div>' +
      '<div class="mds-filters" id="mdsChips"></div>' +
      '<div class="mds-filters"><select class="inp mb0" id="mdsCls"><option value="">כל השיעורים</option></select>' +
      '<input type="search" class="inp mb0" id="mdsQ" placeholder="חיפוש תלמיד / תרופה…"></div>' +
      '<div class="count-line" id="mdsCount"></div>' +
      '<div class="mds-hint"><i class="bi bi-pencil"></i> לוחצים על תא כדי לערוך אותו. Enter שומר, Esc מבטל. מעבר עם העכבר מראה טקסט ארוך במלואו.</div>' +
      '<div class="table-wrap mds-wrap"><table class="mds-tbl"><thead><tr>' +
      '<th>תלמיד</th><th>סטטוס</th><th>תרופה</th><th>מינון</th><th>זמן נטילה</th><th>שעות השפעה</th>' +
      '<th>עודכן</th><th>הערות</th>' +
      '</tr></thead><tbody id="mdsBody"></tbody></table></div>';

    let D = null, filter = 'הכל', cls = '', q = '';
    const openNotes = new Set();
    const $ = sel => page.querySelector(sel);

    async function reload() {
      try { D = await loadAll(); }
      catch (e) { window.UI.toast('טעינת הכדורים נכשלה: ' + e.message, 'err'); return; }
      const sel = $('#mdsCls');
      if (!sel.dataset.ready) {
        sel.innerHTML = '<option value="">כל השיעורים</option>' + D.classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
        sel.dataset.ready = '1';
      }
      draw();
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

    function draw() {
      const all = rowsFor();
      const counts = { 'הכל': all.length };
      STATUSES.forEach(x => counts[x] = all.filter(r => r.st.status === x).length);
      $('#mdsChips').innerHTML = ['הכל'].concat(STATUSES).map(x =>
        '<button class="mds-chip' + (filter === x ? ' on' : '') + '" data-f="' + esc(x) + '">' + esc(x) + ' (' + counts[x] + ')</button>').join('');

      const list = all.filter(r => {
        if (filter !== 'הכל' && r.st.status !== filter) return false;
        if (cls && String(r.s.class_id) !== cls) return false;
        if (q) {
          const hay = [nm(r.s), r.meds.map(m => m.name).join(' ')].join(' ');
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      $('#mdsCount').textContent = 'מוצגים ' + list.length + ' מתוך ' + all.length + ' תלמידים';

      // תא שאפשר לערוך: שורה אחת, טקסט ארוך נחתך ומוצג במלואו במעבר עכבר
      const ed = (m, k, text) => '<td class="mds-ed" data-ed="' + k + '" data-id="' + m.id + '" title="' + esc(text || '') + '"><div class="mds-1">' + esc(text || '—') + '</div></td>';
      const statusSel = r => '<select class="mds-ssel ' + STATUS_CLS[r.st.status] + '" data-st="' + r.s.id + '" title="' + esc(r.st.note || '') + '">' +
        STATUSES.map(x => '<option' + (x === r.st.status ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>';

      const body = list.map(r => {
        const meds = r.meds.length ? r.meds : [null];
        return meds.map((m, i) => {
          const first = i === 0;
          // שם וסטטוס חוזרים בכל שורה (בלי מיזוג תאים) כדי שהטבלה תישאר ישרה
          const nameCell = '<td><div class="mds-1"><span class="mds-stu" data-open="' + r.s.id + '" title="' + esc(r.cls) + '">' + esc(nm(r.s)) + '</span>' +
            (first ? ' <button class="mds-add" data-add="' + r.s.id + '" title="הוספת כדור">+</button>' : '') + '</div></td>';
          const stCell = '<td>' + (first ? statusSel(r) : '<span class="mds-same">〃</span>') + '</td>';
          if (!m) return '<tr class="mds-first">' + nameCell + stCell + '<td colspan="6" style="color:#94a3b8">אין רישום כדור. לחיצה על + מוסיפה</td></tr>';
          const stale = daysSince(m.updated_on);
          const cls2 = (m.active && (stale == null || stale > STALE_DAYS)) ? ' mds-stale' : '';
          const extra = [m.take_how && 'אופן: ' + m.take_how, m.second && ('כדור בצהריים: ' + (m.dose2 || '') + ' ' + (m.hours2 || '')).trim(),
            (m.side_during || m.side_after) && 'תופעות: ' + [m.side_during, m.side_after].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');
          const noteText = [m.notes, extra].filter(Boolean).join(' · ');
          return '<tr class="' + (first ? 'mds-first' : '') + cls2 + (m.active ? '' : ' mds-stop') + '">' + nameCell + stCell +
            '<td class="mds-ed" data-ed="name" data-id="' + m.id + '" title="' + esc(m.purpose || '') + '"><div class="mds-1">' + esc(m.name) +
              (m.active ? '' : ' <span class="mds-chip-s mds-off">הופסק</span>') + '</div></td>' +
            ed(m, 'dose', m.dose) + ed(m, 'take_time', m.take_time) + ed(m, 'hours', m.hours) +
            '<td><div class="mds-1">' + (m.updated_on ? esc(fmtDate(m.updated_on).slice(0, 6) + String(m.updated_on).slice(2, 4)) : '—') + '</div></td>' +
            '<td class="mds-ed mds-notes' + (openNotes.has(m.id) ? ' mds-open' : '') + '" data-ed="notes" data-id="' + m.id + '" title="' + esc(noteText) + '"><div class="mds-nwrap"><div class="mds-1">' + esc(noteText || '—') + '</div>' +
              (noteText.length > 25 ? '<button class="mds-more" data-more="' + m.id + '">' + (openNotes.has(m.id) ? 'סגור' : 'המשך') + '</button>' : '') + '</div></td></tr>';
        }).join('');
      }).join('');
      $('#mdsBody').innerHTML = body || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:20px">אין תלמידים מתאימים</td></tr>';
    }

    // ───────── עריכה ישר בטבלה ─────────
    const fullRow = m => ({ name: m.name, purpose: m.purpose, dose: m.dose, hours: m.hours, take_time: m.take_time, take_how: m.take_how,
      side_during: m.side_during, side_after: m.side_after, second: !!m.second, dose2: m.dose2, hours2: m.hours2, notes: m.notes,
      active: !!m.active, updated_on: m.updated_on, category: 'תרופה' });

    function startEdit(td) {
      if (td.querySelector('input')) return;
      const m = D.meds.find(x => x.id == td.dataset.id); if (!m) return;
      const k = td.dataset.ed, oldV = m[k] == null ? '' : String(m[k]);
      td.innerHTML = '<input class="inp mb0 mds-in" value="' + esc(oldV) + '">';
      const inp = td.querySelector('input'); inp.focus(); inp.select();
      let done = false;
      const finish = async ok => {
        if (done) return; done = true;
        const v = inp.value.trim();
        if (!ok || v === oldV.trim()) { draw(); return; }
        if (k === 'name' && !v) { window.UI.toast('חובה שם תרופה', 'err'); draw(); return; }
        const row = fullRow(m); row[k] = v || null; row.updated_on = today();
        try { await save('update', m.student_id, m.id, row, null); window.UI.toast('נשמר'); await reload(); }
        catch (e) { window.UI.toast(e.message || 'השמירה נכשלה', 'err'); draw(); }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); });
      inp.addEventListener('blur', () => finish(true));
    }

    page.addEventListener('change', async e => {
      const sel = e.target.closest('[data-st]'); if (!sel) return;
      const sid = Number(sel.dataset.st);
      const cur = statusOf(sid, D.statuses, D.meds);
      try { await save('status', sid, null, { status: sel.value, note: cur.note || '' }, null); window.UI.toast('הסטטוס נשמר'); await reload(); }
      catch (err) { window.UI.toast(err.message || 'השמירה נכשלה', 'err'); draw(); }
    });

    page.addEventListener('click', e => {
      const chip = e.target.closest('[data-f]');
      if (chip) { filter = chip.dataset.f; draw(); return; }
      const more = e.target.closest('[data-more]');
      if (more) { const id = Number(more.dataset.more); openNotes.has(id) ? openNotes.delete(id) : openNotes.add(id); draw(); return; }
      const add = e.target.closest('[data-add]');
      if (add) { openStudent(Number(add.dataset.add), true); return; }
      const open = e.target.closest('[data-open]');
      if (open) { openStudent(Number(open.dataset.open)); return; }
      const cell = e.target.closest('.mds-ed');
      if (cell && !e.target.closest('input')) startEdit(cell);
    });
    $('#mdsCls').addEventListener('change', e => { cls = e.target.value; draw(); });
    $('#mdsQ').addEventListener('input', e => { q = (e.target.value || '').trim(); draw(); });
    $('#mdsCsv').addEventListener('click', () => exportCsv());

    function exportCsv() {
      if (!D) return;
      const head = ['תלמיד', 'שיעור', 'סטטוס', 'הערת סטטוס', 'תרופה', 'מטרה', 'מינון', 'זמן נטילה', 'אופן נטילה', 'שעות השפעה', 'כדור בצהריים', 'תופעות', 'הערות הורים', 'עודכן', 'פעיל'];
      const lines = [head];
      rowsFor().forEach(r => {
        if (!r.meds.length) lines.push([nm(r.s), r.cls, r.st.status, r.st.note, '', '', '', '', '', '', '', '', '', '', '']);
        r.meds.forEach(m => lines.push([nm(r.s), r.cls, r.st.status, r.st.note, m.name, m.purpose, m.dose, m.take_time, m.take_how,
          m.hours, m.second ? (m.dose2 + ' ' + (m.hours2 || '')) : '', [m.side_during, m.side_after].filter(Boolean).join(' / '),
          m.notes, m.updated_on, m.active ? 'כן' : 'לא']));
      });
      const q2 = v => '"' + String(v == null ? '' : v).replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"';
      const blob = new Blob([String.fromCharCode(0xFEFF) + lines.map(l => l.map(q2).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'כדורים.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    }

    // ───────── חלונית תלמיד ─────────
    async function openStudent(sid, addNew) {
      const s = D.studs.find(x => x.id == sid);
      if (!s) return;
      const ov = document.createElement('div'); ov.className = 'mds-ov';
      ov.innerHTML = '<div class="mds-card" role="dialog" aria-modal="true"><div class="mds-head"><h3></h3>' +
        '<button class="modal-x" aria-label="סגור"><i class="bi bi-x-lg"></i></button></div><div class="mds-body"></div></div>';
      document.body.appendChild(ov);
      const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
      const onKey = e => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey, true);
      ov.addEventListener('click', e => { if (e.target === ov) close(); });
      ov.querySelector('.modal-x').addEventListener('click', close);
      ov.querySelector('h3').textContent = nm(s) + ' — ' + ((D.classes.find(c => c.id == s.class_id) || {}).name || '');
      const body = ov.querySelector('.mds-body');

      let hist = [];
      try { hist = await loadHistory(sid); } catch (e) { window.UI.toast('היסטוריה לא נטענה: ' + e.message, 'err'); }

      const refresh = async () => { await reload(); await openStudentRefresh(); };
      async function openStudentRefresh() {
        const fresh = D.studs.find(x => x.id == sid); if (!fresh) return close();
        try { hist = await loadHistory(sid); } catch (_) {}
        viewMode();
      }

      function noteVal() { const el = body.querySelector('#mdsUpdNote'); return el ? el.value.trim() : ''; }

      function viewMode() {
        const st = statusOf(sid, D.statuses, D.meds);
        const meds = D.meds.filter(m => m.student_id == sid).sort((a, b) => (b.active - a.active) || (a.id - b.id));
        body.innerHTML =
          '<div class="mds-sec"><h4>סטטוס</h4><div class="mds-row">' +
            '<select class="inp mb0" id="mdsStatus">' + STATUSES.map(x => '<option' + (x === st.status ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +
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
          else input = '<input class="inp mb0" data-m="' + x.k + '"' + (x.type === 'date' ? ' type="date"' : '') + ' value="' + esc(x.type === 'date' ? String(v).slice(0, 10) : v) + '">';
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

    await reload();
  }

  window.cv3Meds = { loadAll, describe };
  const R = window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  R.meds = render;
})();
