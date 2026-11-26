// writing-track.js — מעקב כתיבה (הוספה 2026-11-26, בקשת הרב יודלוב).
// בנוי בדפוס של מעקב הקריאה (reading-assess.js): מדדים הניתנים לעריכה
// (writing_metrics, כמו reading_categories) + דיווח לתלמיד (הטבלה הקיימת writing,
// שהורחבה בעמודה vals). מסך לפי כיתה: בוחרים תלמיד, לחיצה אחת על כל מדד,
// הערכים של הדיווח הקודם ממולאים מראש, ושמירה אחת עוברת לתלמיד הבא.
//
//   writing.vals  = { <מזהה מדד>: <מפתח ערך> }   (מדד מרובה-ערכים: מערך מפתחות)
//   writing.level = סיכום טקסט קצר, כדי שכרטיס התלמיד וציר הפעילות ימשיכו להציג משהו
//   writing_metrics.options = [{ k, t, tone }]   tone: good / mid / bad / בלי = תיאורי
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isAdmin = () => !!(window.currentUser && window.currentUser.role === 'מנהל');
  const isReadonly = () => !!(window.Auth && window.Auth.isReadonly && window.Auth.isReadonly());
  const RANK = { good: 3, mid: 2, bad: 1 };
  const TREND_TXT = { up: 'השתפר', same: 'יציב', down: 'ירד', chg: 'השתנה' };
  const TREND_ICON = { up: 'bi-arrow-up-short', same: 'bi-dash', down: 'bi-arrow-down-short', chg: 'bi-arrow-left-right' };
  const LS_CLASS = 'wt_class';

  const pad = n => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const hdate = d => { try { return (window.UI.hebDate && window.UI.hebDate(d)) || d; } catch (_) { return d; } };
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  // ── נתונים ──
  const optsOf = m => (Array.isArray(m && m.options) ? m.options : []);
  const optByKey = (m, k) => optsOf(m).find(o => o.k === k);
  async function loadMetrics(all) {
    const list = await window.store.list('writing_metrics');
    return (list || []).filter(m => all || m.active !== false)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
  }
  const byNewest = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.id - a.id;
  const asArr = v => Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
  const hasVal = v => asArr(v).length > 0;
  const sameVal = (a, b) => JSON.stringify(asArr(a).slice().sort()) === JSON.stringify(asArr(b).slice().sort());

  // הערך של מדד כמערך תוויות/גוונים (לתצוגה)
  function shown(m, v) {
    return asArr(v).map(k => optByKey(m, k)).filter(Boolean);
  }
  // גוון מייצג של ערך (הגרוע ביותר, במדד מרובה-ערכים). null = תיאורי
  function toneOf(m, v) {
    const ts = shown(m, v).map(o => o.tone).filter(t => RANK[t]);
    if (!ts.length) return null;
    return ts.reduce((a, b) => RANK[a] <= RANK[b] ? a : b);
  }
  // מגמה למדד, מתוך הדיווחים השמורים (חדש→ישן). אותו חישוב לכל המסכים.
  function trendOf(m, rows) {
    const withVal = rows.filter(r => r.vals && hasVal(r.vals[m.id]) && shown(m, r.vals[m.id]).length);
    if (withVal.length < 2) return null;
    const a = withVal[0].vals[m.id], b = withVal[1].vals[m.id];
    const ta = toneOf(m, a), tb = toneOf(m, b);
    if (ta && tb) return RANK[ta] > RANK[tb] ? 'up' : RANK[ta] < RANK[tb] ? 'down' : 'same';
    return sameVal(a, b) ? 'same' : 'chg';
  }
  // סיכום טקסט קצר לעמודה level: מה שדורש תשומת לב, עד ארבעה פריטים
  function summarize(ms, vals) {
    const parts = [];
    ms.forEach(m => {
      const v = vals[m.id]; if (!hasVal(v)) return;
      const t = toneOf(m, v);
      if (t === 'mid' || t === 'bad') parts.push(m.name + ': ' + shown(m, v).map(o => o.t).join('/'));
    });
    if (!parts.length) return 'תקין';
    return parts.slice(0, 4).join(' · ') + (parts.length > 4 ? ' · ועוד ' + (parts.length - 4) : '');
  }

  // ── עיצוב (מוזרק פעם אחת; לא נוגעים ב-main.css) ──
  function injectCss() {
    if (document.getElementById('wt-css')) return;
    const st = document.createElement('style'); st.id = 'wt-css';
    st.textContent = [
      '.wt{--g:#1f8a5b;--m:#d68910;--b:#c0392b}',
      '.wt-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 2px 12px}',
      '.wt-bar .inp{margin:0;width:auto;min-width:190px;max-width:100%}',
      '.wt-main{display:grid;grid-template-columns:250px minmax(0,1fr);gap:14px;align-items:start}',
      '.wt-list{display:flex;flex-direction:column;gap:6px;position:sticky;top:8px;max-height:calc(100vh - 24px);overflow:auto}',
      '.wt-st{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:right;background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:11px 12px;cursor:pointer;font-family:inherit;color:var(--ink);min-height:52px}',
      '.wt-st:hover{border-color:var(--primary-light)}',
      '.wt-st.on{border-color:var(--primary);box-shadow:0 0 0 3px rgba(43,124,152,.16);background:var(--accent-soft)}',
      '.wt-st .nm{font-weight:800;font-size:.97rem}',
      '.wt-st .sub{display:block;font-size:.76rem;color:var(--muted);margin-top:2px;font-weight:500}',
      '.wt-st .ok{color:var(--g);font-size:1.15rem}',
      '.wt-pane{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 14px 0;min-width:0}',
      '.wt-ph{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}',
      '.wt-ph h3{font-size:1.2rem;font-weight:800;color:var(--primary-dark);flex:1;min-width:140px}',
      '.wt-ph .wt-back{display:none}',
      '.wt-meta{font-size:.82rem;color:var(--muted);margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.wt-meta .pre{background:var(--accent-soft);color:#7a5b12;border-radius:8px;padding:3px 9px;font-weight:700}',
      'body.dark .wt-meta .pre{color:var(--accent)}',
      '.wt-meta input[type=date]{border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);padding:3px 6px;font-family:inherit}',
      '.wt-row{padding:9px 0;border-top:1px solid var(--line)}',
      '.wt-lbl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;font-size:.9rem}',
      '.wt-name{font-weight:800}',
      '.wt-chg .wt-name::after{content:"שונה";margin-inline-start:6px;font-size:.68rem;font-weight:800;color:#fff;background:var(--primary);border-radius:6px;padding:1px 6px}',
      '.wt-trend{display:inline-flex;align-items:center;font-size:.74rem;font-weight:800;border-radius:999px;padding:1px 8px 1px 6px;border:1px solid var(--line);color:var(--muted)}',
      '.wt-trend.up{color:var(--g);border-color:var(--g)}.wt-trend.down{color:var(--b);border-color:var(--b)}',
      '.wt-trend i{font-size:1rem;line-height:1}',
      '.wt-dots{display:inline-flex;gap:3px;align-items:center}',
      '.wt-dot{width:9px;height:9px;border-radius:50%;background:var(--line);display:inline-block}',
      '.wt-dot.good{background:var(--g)}.wt-dot.mid{background:var(--m)}.wt-dot.bad{background:var(--b)}.wt-dot.none{background:var(--primary-light)}',
      '.wt-opts{display:flex;flex-wrap:wrap;gap:7px}',
      '.wt-o{border:1.5px solid var(--line);background:var(--bg);color:var(--ink);border-radius:10px;padding:9px 14px;min-height:42px;font-family:inherit;font-size:.95rem;font-weight:600;cursor:pointer;transition:background .1s,border-color .1s}',
      '.wt-o:hover{border-color:var(--primary-light)}',
      '.wt-o.good{border-color:color-mix(in srgb,var(--g) 45%,var(--line))}.wt-o.mid{border-color:color-mix(in srgb,var(--m) 45%,var(--line))}.wt-o.bad{border-color:color-mix(in srgb,var(--b) 45%,var(--line))}',
      '.wt-o.on{color:#fff;font-weight:800;background:var(--primary);border-color:var(--primary)}',
      '.wt-o.on.good{background:var(--g);border-color:var(--g)}.wt-o.on.mid{background:var(--m);border-color:var(--m)}.wt-o.on.bad{background:var(--b);border-color:var(--b)}',
      '.wt-note{width:100%;margin:10px 0 0;min-height:52px;resize:vertical}',
      '.wt-bottom{position:sticky;bottom:0;background:var(--card);border-top:1px solid var(--line);margin:12px -14px 0;padding:10px 14px 10px 72px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-radius:0 0 var(--radius) var(--radius);z-index:2}',
      '.wt-bottom .btn-primary{width:auto;flex:1;min-width:120px;padding:13px 16px}',
      '.wt-bottom .btn-ghost{white-space:nowrap}',
      '.wt-hist{padding:6px 0 14px}',
      '.wt-hist h4{font-size:.95rem;margin:12px 0 6px;color:var(--primary-dark)}',
      '.wt-h{border:1px solid var(--line);border-radius:10px;margin-bottom:6px;background:var(--bg)}',
      '.wt-h summary{cursor:pointer;padding:8px 10px;font-size:.86rem;display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.wt-h .bd{padding:2px 10px 10px;font-size:.84rem}',
      '.wt-chip{display:inline-block;border-radius:8px;padding:2px 8px;margin:2px 0 2px 4px;background:var(--card);border:1px solid var(--line);font-size:.8rem}',
      '.wt-chip.good{border-color:var(--g)}.wt-chip.mid{border-color:var(--m)}.wt-chip.bad{border-color:var(--b)}',
      '.wt-tw{overflow:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}',
      '.wt-tw table{border-collapse:collapse;width:100%;font-size:.84rem}',
      '.wt-tw th,.wt-tw td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}',
      '.wt-tw th{background:var(--bg);position:sticky;top:0}',
      '.wt-tw td:first-child,.wt-tw th:first-child{position:sticky;right:0;background:var(--card);font-weight:800;z-index:1}',
      '.wt-tw tr.go{cursor:pointer}.wt-tw tr.go:hover td{background:var(--accent-soft)}',
      '.wt-tw td.good{color:var(--g);font-weight:700}.wt-tw td.mid{color:var(--m);font-weight:700}.wt-tw td.bad{color:var(--b);font-weight:700}',
      '.wt-empty{padding:34px 14px;text-align:center;color:var(--muted)}',
      '.wt-empty i{font-size:2rem;display:block;margin-bottom:8px}',
      '.wm{border:1px solid var(--line);border-radius:12px;margin-bottom:8px;background:var(--bg)}',
      '.wm-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px}',
      '.wm-top .inp{margin:0;flex:1;min-width:130px}',
      '.wm-body{padding:0 8px 8px;display:none}.wm.open .wm-body{display:block}',
      '.wm-o{display:flex;gap:6px;align-items:center;margin-bottom:6px}',
      '.wm-o .inp{margin:0;flex:1;min-width:0}.wm-o select.inp{flex:0 0 130px}',
      '.wm-hint{font-size:.78rem;color:var(--muted);margin:2px 0 8px;line-height:1.5}',
      '@media (max-width:760px){',
      '.wt-main{grid-template-columns:minmax(0,1fr)}',
      '.wt-list{position:static;max-height:none}',
      '.wt.wt-open .wt-list{display:none}',
      '.wt:not(.wt-open) .wt-pane{display:none}',
      '.wt-ph .wt-back{display:inline-flex}',
      '.wt-o{flex:1 1 auto;padding:11px 12px}',
      '}',
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── המסך ──
  async function renderPage(target) {
    injectCss();
    const S = { cls: '', kids: [], rows: new Map(), metrics: [], sel: null, view: 'form', draft: {}, base: {}, editRow: null, saving: false, canWrite: !isReadonly() };

    target.innerHTML = '<div class="wt"><div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>מעקב כתיבה</h2>' +
      '<div class="head-actions"><button class="btn-ghost sm" id="wtTable"><i class="bi bi-table"></i> מבט כיתתי</button> ' +
      (isAdmin() ? '<button class="btn-ghost sm" id="wtCfg"><i class="bi bi-gear"></i> מדדים</button>' : '') + '</div></div>' +
      '<div class="wt-bar"><select class="inp" id="wtClass"><option value="">בחר כיתה…</option></select></div>' +
      '<div class="wt-main"><aside class="wt-list" id="wtList"></aside><section class="wt-pane" id="wtPane"></section></div></div>';
    const root = target.querySelector('.wt');
    const $ = s => root.querySelector(s);

    let classes, students, metrics, allRows;
    try {
      [classes, students, metrics, allRows] = await Promise.all([
        window.store.list('classes'),
        (window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students')),
        loadMetrics(false),
        window.store.list('writing'),
        window.Author ? window.Author.load() : null,
      ]);
    } catch (e) {
      $('#wtPane').innerHTML = '<div class="wt-empty"><i class="bi bi-exclamation-triangle"></i>טעינת הנתונים נכשלה: ' + esc(e && e.message || e) + '</div>';
      return;
    }
    S.metrics = metrics;
    const ids = new Set(students.map(s => String(s.id)));
    (allRows || []).forEach(r => { if (!ids.has(String(r.student_id))) return; const k = String(r.student_id); if (!S.rows.has(k)) S.rows.set(k, []); S.rows.get(k).push(r); });
    S.rows.forEach(a => a.sort(byNewest));
    const rowsOf = sid => S.rows.get(String(sid)) || [];

    // כיתות: רק אלה שיש בהן תלמידים שהמשתמש רואה; כיתה אחת — נבחרת אוטומטית
    const useful = classes.filter(c => students.some(s => String(s.class_id) === String(c.id)));
    const sel = $('#wtClass');
    sel.innerHTML = (useful.length === 1 ? '' : '<option value="">בחר כיתה…</option>') + useful.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const saved = lsGet(LS_CLASS);
    const initial = useful.length === 1 ? String(useful[0].id) : (useful.some(c => String(c.id) === saved) ? saved : '');
    sel.value = initial;

    if (!metrics.length) {
      $('#wtList').innerHTML = '';
      $('#wtPane').innerHTML = '<div class="wt-empty"><i class="bi bi-pencil-square"></i>אין מדדי כתיבה מוגדרים.' + (isAdmin() ? ' לחץ "מדדים" כדי להוסיף.' : ' פנה למנהל.') + '</div>';
    }

    // ── רשימת תלמידים ──
    function drawList() {
      const list = $('#wtList');
      if (!S.cls) { list.innerHTML = ''; return; }
      const today = todayStr();
      list.innerHTML = S.kids.map(s => {
        const r = rowsOf(s.id)[0];
        const done = r && r.date === today;
        const sub = r ? (done ? 'דווח היום' : 'דווח ' + (window.UI.relativeDay ? (window.UI.relativeDay(r.date) || r.date) : r.date)) : 'עדיין לא דווח';
        return '<button type="button" class="wt-st' + (String(S.sel) === String(s.id) ? ' on' : '') + '" data-sid="' + s.id + '"><span><span class="nm">' + esc(window.UI.fullName(s)) +
          '</span><span class="sub">' + esc(sub) + '</span></span>' + (done ? '<i class="bi bi-check-circle-fill ok"></i>' : '<i class="bi bi-chevron-left" style="color:var(--muted)"></i>') + '</button>';
      }).join('') || '<div class="wt-empty">אין תלמידים בכיתה</div>';
    }

    function setOpen(open) { root.classList.toggle('wt-open', !!open); }

    function drawPane() {
      const pane = $('#wtPane');
      if (!S.metrics.length) return;
      if (!S.cls) { pane.innerHTML = '<div class="wt-empty"><i class="bi bi-people"></i>בחר כיתה כדי להתחיל</div>'; setOpen(false); return; }
      if (S.view === 'table') { drawTable(); return; }
      if (!S.sel) { pane.innerHTML = '<div class="wt-empty"><i class="bi bi-hand-index"></i>בחר תלמיד מהרשימה</div>'; setOpen(false); return; }
      drawForm();
    }

    // ── מבט כיתתי: תלמידים × מדדים, הערך האחרון ──
    function drawTable() {
      setOpen(true);
      const head = '<tr><th>תלמיד</th>' + S.metrics.map(m => '<th>' + esc(m.name) + '</th>').join('') + '<th>עודכן</th></tr>';
      const body = S.kids.map(s => {
        const rs = rowsOf(s.id), last = rs[0];
        const cells = S.metrics.map(m => {
          const r = rs.find(x => x.vals && hasVal(x.vals[m.id]) && shown(m, x.vals[m.id]).length);
          if (!r) return '<td style="color:var(--muted)">—</td>';
          const v = r.vals[m.id], t = trendOf(m, rs);
          return '<td class="' + (toneOf(m, v) || '') + '">' + esc(shown(m, v).map(o => o.t).join(' / ')) +
            (t === 'up' ? ' <i class="bi bi-arrow-up-short"></i>' : t === 'down' ? ' <i class="bi bi-arrow-down-short"></i>' : '') + '</td>';
        }).join('');
        return '<tr class="go" data-sid="' + s.id + '"><td>' + esc(window.UI.fullName(s)) + '</td>' + cells + '<td>' + (last ? esc(last.date) : '—') + '</td></tr>';
      }).join('');
      $('#wtPane').innerHTML = '<div class="wt-ph"><button type="button" class="btn-ghost sm wt-back" id="wtBack"><i class="bi bi-arrow-right"></i> לרשימה</button><h3>מבט כיתתי</h3>' +
        '<button type="button" class="btn-ghost sm" id="wtToForm"><i class="bi bi-pencil"></i> חזרה לדיווח</button></div>' +
        '<div class="wt-tw" style="margin-bottom:14px"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    }

    // ── טופס דיווח לתלמיד ──
    function startDraft(s) {
      const rs = rowsOf(s.id);
      const me = window.currentUser && window.currentUser.id;
      const today = todayStr();
      S.editRow = rs.find(r => r.date === today && me && String(r.created_by) === String(me)) || null;
      const src = S.editRow || rs[0] || null;
      const d = {};
      S.metrics.forEach(m => {
        const v = src && src.vals ? src.vals[m.id] : null;
        const ok = asArr(v).filter(k => optByKey(m, k));
        if (ok.length) d[m.id] = m.kind === 'multi' ? ok : ok[0];
      });
      S.draft = d;
      S.base = JSON.parse(JSON.stringify(d));
      S.src = src;
      S.date = S.editRow ? S.editRow.date : today;
      S.note = S.editRow ? (S.editRow.note || '') : '';
    }

    function rowHtml(m, rs) {
      const cur = S.draft[m.id];
      const t = trendOf(m, rs);
      const hist = rs.filter(r => r.vals && hasVal(r.vals[m.id]) && shown(m, r.vals[m.id]).length).slice(0, 5).reverse();
      const dots = hist.map(r => '<span class="wt-dot ' + (toneOf(m, r.vals[m.id]) || 'none') + '" title="' + esc(r.date + ': ' + shown(m, r.vals[m.id]).map(o => o.t).join(' / ')) + '"></span>').join('');
      const btns = optsOf(m).map(o => {
        const on = asArr(cur).indexOf(o.k) > -1;
        return '<button type="button" class="wt-o ' + (o.tone || '') + (on ? ' on' : '') + '" data-mid="' + m.id + '" data-k="' + esc(o.k) + '" aria-pressed="' + on + '">' + esc(o.t) + '</button>';
      }).join('');
      return '<div class="wt-row' + (sameVal(cur, S.base[m.id]) ? '' : ' wt-chg') + '" data-row="' + m.id + '"><div class="wt-lbl"><span class="wt-name">' + esc(m.name) + '</span>' +
        (t ? '<span class="wt-trend ' + t + '" title="לעומת הדיווח הקודם"><i class="bi ' + TREND_ICON[t] + '"></i>' + TREND_TXT[t] + '</span>' : '') +
        (dots ? '<span class="wt-dots" title="חמשת הדיווחים האחרונים (מהישן לחדש)">' + dots + '</span>' : '') + '</div><div class="wt-opts">' + btns + '</div></div>';
    }

    function histHtml(rs) {
      if (!rs.length) return '';
      const me = window.currentUser && window.currentUser.id;
      return '<div class="wt-hist"><h4>דיווחים קודמים</h4>' + rs.slice(0, 6).map(r => {
        const chips = S.metrics.map(m => {
          const sh = shown(m, r.vals && r.vals[m.id]); if (!sh.length) return '';
          return '<span class="wt-chip ' + (toneOf(m, r.vals[m.id]) || '') + '">' + esc(m.name) + ': <b>' + esc(sh.map(o => o.t).join(' / ')) + '</b></span>';
        }).join('');
        const mine = isAdmin() || (me && String(r.created_by) === String(me));
        return '<details class="wt-h"><summary><b>' + esc(r.date) + '</b><span style="color:var(--muted)">' + esc(hdate(r.date) !== r.date ? hdate(r.date) : '') + '</span>' +
          '<span style="color:var(--muted)"><i class="bi bi-person-badge"></i> ' + (window.Author ? window.Author.cell(r.created_by) : '') + '</span></summary><div class="bd">' +
          (chips || '<span style="color:var(--muted)">אין ערכים</span>') + (r.note ? '<div style="margin-top:6px"><b>הערה:</b> ' + esc(r.note) + '</div>' : '') +
          (mine && S.canWrite ? '<div style="margin-top:8px"><button type="button" class="btn-ghost sm" data-del="' + r.id + '" style="color:var(--danger)"><i class="bi bi-trash"></i> מחיקת הדיווח</button></div>' : '') + '</div></details>';
      }).join('') + '</div>';
    }

    function drawForm() {
      const s = S.kids.find(k => String(k.id) === String(S.sel)); if (!s) { S.sel = null; drawPane(); return; }
      if (!S.draftFor || S.draftFor !== String(s.id)) { startDraft(s); S.draftFor = String(s.id); }
      const rs = rowsOf(s.id);
      const idx = S.kids.findIndex(k => String(k.id) === String(s.id));
      const pre = S.editRow ? 'עדכון הדיווח של היום' : (S.src ? 'ממולא מהדיווח מתאריך ' + S.src.date : 'דיווח ראשון לתלמיד');
      setOpen(true);
      $('#wtPane').innerHTML =
        '<div class="wt-ph"><button type="button" class="btn-ghost sm wt-back" id="wtBack"><i class="bi bi-arrow-right"></i> לרשימה</button><h3>' + esc(window.UI.fullName(s)) + '</h3>' +
        '<button type="button" class="btn-ghost xs" id="wtPrev"' + (idx <= 0 ? ' disabled' : '') + ' title="התלמיד הקודם"><i class="bi bi-chevron-right"></i></button>' +
        '<button type="button" class="btn-ghost xs" id="wtNext"' + (idx >= S.kids.length - 1 ? ' disabled' : '') + ' title="דלג לתלמיד הבא"><i class="bi bi-chevron-left"></i></button></div>' +
        '<div class="wt-meta"><span class="pre"><i class="bi bi-magic"></i> ' + esc(pre) + '</span><label>תאריך: <input type="date" id="wtDate" value="' + esc(S.date) + '"></label>' +
        '<button type="button" class="btn-ghost xs" id="wtClear">ניקוי הכול</button></div>' +
        S.metrics.map(m => rowHtml(m, rs)).join('') +
        '<textarea class="inp wt-note" id="wtNote" rows="2" placeholder="הערה חופשית (רשות)">' + esc(S.note) + '</textarea>' +
        '<div class="wt-bottom">' + (S.canWrite
          ? '<button type="button" class="btn-primary" id="wtSave"><i class="bi bi-check2-circle"></i> ' + (idx < S.kids.length - 1 ? 'שמירה והבא' : 'שמירה וסיום') + '</button>' +
            '<button type="button" class="btn-ghost" id="wtSaveStay">שמירה בלבד</button>'
          : '<span style="color:var(--muted);font-size:.86rem">מצב צפייה בלבד</span>') + '</div>' + histHtml(rs);
    }

    // ── שמירה ──
    async function save(advance) {
      if (S.saving || !S.sel) return;
      const s = S.kids.find(k => String(k.id) === String(S.sel)); if (!s) return;
      const vals = {};
      S.metrics.forEach(m => { const v = S.draft[m.id]; if (hasVal(v)) vals[m.id] = m.kind === 'multi' ? asArr(v) : asArr(v)[0]; });
      if (!Object.keys(vals).length) { window.UI.toast('נא לבחור לפחות ערך אחד', 'err'); return; }
      const note = (($('#wtNote') || {}).value || '').trim();
      const date = (($('#wtDate') || {}).value || '') || todayStr();
      const rowData = { student_id: Number(s.id), date, vals, level: summarize(S.metrics, vals), note: note || null };
      S.saving = true;
      const b1 = $('#wtSave'), b2 = $('#wtSaveStay'); [b1, b2].forEach(b => { if (b) b.disabled = true; });
      let r, saved;
      try {
        if (S.editRow) {
          r = await window.store.update('writing', S.editRow.id, { date, vals, level: rowData.level, note: rowData.note });
          // עדכון שנחסם ב-RLS חוזר בלי שגיאה ובלי שורות — זו כישלון, לא הצלחה
          if (r && r.ok && !window.store.DEMO && !(r.data && r.data.length)) r = { ok: false, error: 'העדכון נחסם — אין הרשאה לשנות רישום זה' };
          saved = r && r.ok ? Object.assign({}, S.editRow, rowData) : null;
        } else {
          r = await window.store.add('writing', rowData);
          saved = r && r.ok ? Object.assign({}, rowData, (r.data && r.data[0]) || {}, { id: (r.data && r.data[0] && r.data[0].id) || ('tmp' + Date.now()) }) : null;
        }
      } catch (e) { r = { ok: false, error: e && e.message || String(e) }; }
      S.saving = false;
      if (!r || !r.ok || !saved) {
        [b1, b2].forEach(b => { if (b) b.disabled = false; });
        window.UI.toast('השמירה נכשלה: ' + ((r && r.error) || 'שגיאה לא ידועה'), 'err');
        return;
      }
      const k = String(s.id); const arr = (S.rows.get(k) || []).filter(x => String(x.id) !== String(saved.id));
      arr.push(saved); arr.sort(byNewest); S.rows.set(k, arr);
      window.UI.toast('נשמר: ' + window.UI.fullName(s));
      const idx = S.kids.findIndex(x => String(x.id) === k);
      S.draftFor = null;
      if (advance && idx < S.kids.length - 1) { S.sel = S.kids[idx + 1].id; drawList(); drawPane(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (advance) { window.UI.toast('סיימת את כל תלמידי הכיתה'); S.view = 'table'; S.sel = null; drawList(); drawPane(); }
      else { drawList(); drawPane(); }
    }

    async function delRow(id) {
      if (!await window.UI.confirm('למחוק את הדיווח הזה? אי אפשר לשחזר.')) return;
      const r = await window.store.remove('writing', Number(id));
      if (!r || !r.ok) { window.UI.toast('המחיקה נכשלה: ' + ((r && r.error) || ''), 'err'); return; }
      // מחיקה שנחסמה ב-RLS חוזרת בלי שגיאה: מוודאים מול המסד שהשורה באמת נעלמה
      if (!window.store.DEMO) {
        const chk = await window.store.byStudent('writing', S.sel);
        if (chk.some(x => String(x.id) === String(id))) { window.UI.toast('המחיקה נחסמה — אין הרשאה למחוק רישום זה', 'err'); return; }
      }
      const k = String(S.sel); S.rows.set(k, (S.rows.get(k) || []).filter(x => String(x.id) !== String(id)));
      S.draftFor = null; window.UI.toast('הדיווח נמחק'); drawList(); drawPane();
    }

    function pickClass(cid) {
      S.cls = cid || ''; lsSet(LS_CLASS, S.cls);
      S.kids = students.filter(s => String(s.class_id) === String(S.cls));
      S.sel = null; S.draftFor = null; S.view = 'form';
      drawList(); drawPane();
    }

    // ── אירועים ──
    sel.addEventListener('change', () => pickClass(sel.value));
    root.addEventListener('click', e => {
      const t = e.target.closest('button, tr.go'); if (!t || !root.contains(t)) return;
      if (t.classList.contains('wt-st')) { S.sel = t.dataset.sid; S.view = 'form'; S.draftFor = null; drawList(); drawPane(); window.scrollTo({ top: 0 }); return; }
      if (t.matches('tr.go')) { S.sel = t.dataset.sid; S.view = 'form'; S.draftFor = null; drawList(); drawPane(); return; }
      if (t.classList.contains('wt-o')) {
        if (!S.canWrite) return;
        const m = S.metrics.find(x => String(x.id) === t.dataset.mid); if (!m) return;
        const k = t.dataset.k;
        if (m.kind === 'multi') {
          const a = asArr(S.draft[m.id]).slice(); const i = a.indexOf(k);
          if (i > -1) a.splice(i, 1); else a.push(k);
          if (a.length) S.draft[m.id] = a; else delete S.draft[m.id];
        } else if (S.draft[m.id] === k) delete S.draft[m.id]; else S.draft[m.id] = k;
        const row = t.closest('.wt-row'), cur = asArr(S.draft[m.id]);
        row.querySelectorAll('.wt-o').forEach(b => { const on = cur.indexOf(b.dataset.k) > -1; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        row.classList.toggle('wt-chg', !sameVal(S.draft[m.id], S.base[m.id]));
        return;
      }
      switch (t.id) {
        case 'wtSave': save(true); return;
        case 'wtSaveStay': save(false); return;
        case 'wtBack': setOpen(false); S.sel = null; S.draftFor = null; drawList(); return;
        case 'wtTable': if (!S.cls) { window.UI.toast('בחר כיתה קודם', 'err'); return; } S.view = 'table'; S.sel = null; drawList(); drawPane(); return;
        case 'wtToForm': S.view = 'form'; drawPane(); setOpen(false); return;
        case 'wtCfg': editMetrics(async () => { S.metrics = await loadMetrics(false); S.draftFor = null; drawPane(); }); return;
        case 'wtClear': S.draft = {}; drawForm(); return;
        case 'wtPrev': case 'wtNext': {
          const i = S.kids.findIndex(k => String(k.id) === String(S.sel)); const n = S.kids[i + (t.id === 'wtNext' ? 1 : -1)];
          if (n) { S.sel = n.id; S.draftFor = null; drawList(); drawPane(); window.scrollTo({ top: 0 }); } return;
        }
      }
      if (t.dataset.del) delRow(t.dataset.del);
    });
    root.addEventListener('input', e => { if (e.target.id === 'wtNote') S.note = e.target.value; });
    root.addEventListener('change', e => { if (e.target.id === 'wtDate') S.date = e.target.value; });

    if (initial && metrics.length) pickClass(initial); else drawList();
  }

  // ── עורך מדדים (מנהל) ──
  async function editMetrics(onDone) {
    const ms = await loadMetrics(true);
    const newKey = () => 'n' + Math.random().toString(36).slice(2, 7);
    const toneSel = t => '<select class="inp wm-tone"><option value=""' + (!t ? ' selected' : '') + '>תיאורי (בלי מגמה)</option>' +
      '<option value="good"' + (t === 'good' ? ' selected' : '') + '>טוב</option><option value="mid"' + (t === 'mid' ? ' selected' : '') + '>בינוני</option>' +
      '<option value="bad"' + (t === 'bad' ? ' selected' : '') + '>דורש תשומת לב</option></select>';
    const optRow = o => '<div class="wm-o" data-k="' + esc(o.k) + '"><input class="inp wm-t" value="' + esc(o.t) + '" placeholder="ערך">' + toneSel(o.tone) +
      '<button type="button" class="mini danger wm-ox" title="הסרת ערך"><i class="bi bi-x-lg"></i></button></div>';
    const card = m => '<div class="wm" data-id="' + m.id + '"><div class="wm-top"><button type="button" class="mini wm-tg" title="הצגת הערכים"><i class="bi bi-chevron-down"></i></button>' +
      '<input class="inp wm-name" value="' + esc(m.name) + '" placeholder="שם המדד">' +
      '<select class="inp wm-kind" style="flex:0 0 120px"><option value="single"' + (m.kind !== 'multi' ? ' selected' : '') + '>ערך אחד</option><option value="multi"' + (m.kind === 'multi' ? ' selected' : '') + '>כמה ערכים</option></select>' +
      '<label style="font-size:.8rem;white-space:nowrap"><input type="checkbox" class="wm-act"' + (m.active !== false ? ' checked' : '') + '> פעיל</label>' +
      '<button type="button" class="mini wm-up" title="למעלה"><i class="bi bi-arrow-up"></i></button><button type="button" class="mini wm-dn" title="למטה"><i class="bi bi-arrow-down"></i></button>' +
      '<button type="button" class="mini danger wm-del" title="מחיקת המדד"><i class="bi bi-trash"></i></button></div>' +
      '<div class="wm-body"><div class="wm-hint">הערכים לפי הסדר שיוצג. "טוב / בינוני / דורש תשומת לב" קובע את צבע הכפתור ואת המגמה (השתפר / ירד). מדד תיאורי (למשל סוג הכתב) מוצג בלי מגמה.</div>' +
      '<div class="wm-os">' + optsOf(m).map(optRow).join('') + '</div><button type="button" class="btn-ghost sm wm-oa"><i class="bi bi-plus-lg"></i> ערך חדש</button></div></div>';
    const body = '<div id="wmList">' + ms.map(card).join('') + '</div><button type="button" class="btn-ghost sm" id="wmAdd" style="margin-top:6px"><i class="bi bi-plus-lg"></i> מדד חדש</button>' +
      '<div class="wm-hint" style="margin-top:10px">מחיקת מדד מסתירה אותו מכל הדיווחים. אם רוצים רק להפסיק להשתמש בו, עדיף להסיר את הסימון "פעיל".</div>';
    let removed = [];
    const m = window.UI.modal({
      title: 'מדדי מעקב כתיבה', bodyHTML: body, saveLabel: 'שמירה',
      onSave: async (el) => {
        const cards = [...el.querySelectorAll('#wmList .wm')];
        let order = 1;
        for (const c of cards) {
          const name = (c.querySelector('.wm-name').value || '').trim();
          if (!name) { window.UI.toast('יש מדד בלי שם', 'err'); return false; }
          const opts = [...c.querySelectorAll('.wm-o')].map(r => {
            const o = { k: r.dataset.k, t: (r.querySelector('.wm-t').value || '').trim() };
            const tone = r.querySelector('.wm-tone').value; if (tone) o.tone = tone; return o;
          }).filter(o => o.t);
          if (!opts.length) { window.UI.toast('למדד "' + name + '" אין ערכים', 'err'); return false; }
        }
        for (const id of removed) {
          const dr = await window.store.remove('writing_metrics', Number(id));
          if (!dr || !dr.ok) { window.UI.toast('מחיקת מדד נכשלה: ' + ((dr && dr.error) || ''), 'err'); return false; }
        }
        for (const c of cards) {
          const row = {
            name: (c.querySelector('.wm-name').value || '').trim(), kind: c.querySelector('.wm-kind').value,
            active: c.querySelector('.wm-act').checked, sort_order: order++,
            options: [...c.querySelectorAll('.wm-o')].map(r => { const o = { k: r.dataset.k, t: (r.querySelector('.wm-t').value || '').trim() }; const tone = r.querySelector('.wm-tone').value; if (tone) o.tone = tone; return o; }).filter(o => o.t),
          };
          const r = String(c.dataset.id).startsWith('new') ? await window.store.add('writing_metrics', row) : await window.store.update('writing_metrics', Number(c.dataset.id), row);
          if (!r || !r.ok) { window.UI.toast('שמירת המדד "' + row.name + '" נכשלה: ' + ((r && r.error) || ''), 'err'); return false; }
          if (!window.store.DEMO && !String(c.dataset.id).startsWith('new') && !(r.data && r.data.length)) { window.UI.toast('השמירה נחסמה — אין הרשאה', 'err'); return false; }
        }
        window.UI.toast('המדדים עודכנו');
        if (onDone) onDone();
        return true;
      },
    });
    const el = m.el, list = el.querySelector('#wmList');
    el.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const c = b.closest('.wm');
      if (b.id === 'wmAdd') {
        const div = document.createElement('div'); div.innerHTML = card({ id: 'new' + Date.now(), name: '', kind: 'single', active: true, options: [{ k: newKey(), t: '' }] });
        const n = div.firstChild; n.classList.add('open'); list.appendChild(n); n.querySelector('.wm-name').focus(); return;
      }
      if (!c) return;
      if (b.classList.contains('wm-tg')) c.classList.toggle('open');
      else if (b.classList.contains('wm-up') && c.previousElementSibling) list.insertBefore(c, c.previousElementSibling);
      else if (b.classList.contains('wm-dn') && c.nextElementSibling) list.insertBefore(c.nextElementSibling, c);
      else if (b.classList.contains('wm-oa')) { const d = document.createElement('div'); d.innerHTML = optRow({ k: newKey(), t: '' }); c.querySelector('.wm-os').appendChild(d.firstChild); c.querySelector('.wm-os .wm-o:last-child .wm-t').focus(); }
      else if (b.classList.contains('wm-ox')) b.closest('.wm-o').remove();
      else if (b.classList.contains('wm-del')) {
        if (!await window.UI.confirm('למחוק את המדד "' + (c.querySelector('.wm-name').value || '') + '"? הערכים ששמורים בדיווחים קודמים לא יוצגו יותר. (אפשר במקום זה להסיר את "פעיל".)')) return;
        if (!String(c.dataset.id).startsWith('new')) removed.push(c.dataset.id);
        c.remove();
      }
    });
  }

  window.cv3WriteTrack = { render: renderPage, editMetrics, loadMetrics, trendOf, summarize };
  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.writetrack = renderPage;
})();
