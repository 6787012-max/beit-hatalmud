// behavior.js — חלק 4: מעקב התנהגות (דיווח מהיר + ציר-זמן) + קריאה + כתיבה.
// כל דיווח נשמר דרך window.db (Supabase) או דמו מקומי. audit נרשם בצד-שרת (עתידי).
(function () {
  'use strict';
  const DEMO = !window.sb;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const isAdmin = () => !!(window.currentUser && window.currentUser.role === 'מנהל');
  // פילוח פעילות הצוות הוא מידע ניהולי — מנהל ומפקח בלבד
  const canSeeStats = () => !!(window.currentUser && ['מנהל', 'מפקח'].includes(window.currentUser.role));
  const hebDate = iso => window.UI.hebDate(iso);
  const relDay = iso => { try { return window.UI.relativeDay(iso); } catch (_) { return ''; } };

  const sevClass = s => s === 'גבוהה' ? 'hi' : s === 'נמוכה' ? 'lo' : 'mid';
  // צבע הדגל לפי חומרה (בקשת יוסף 06/09/2026): "דגל אדום/צהוב/ירוק לפי החומרה" —
  // לא שדה חדש. משתמשים באותה "חומרה" שכבר קיימת בטופס הדיווח, ובאותם משתני
  // צבע כמו sev-dot (--danger/--accent/--ok), כדי שהדגל לא יהיה מקור-אמת שני.
  const flagColor = s => s === 'גבוהה' ? 'var(--danger)' : s === 'נמוכה' ? 'var(--ok)' : 'var(--accent)';
  // תזכורת — אותו עיקרון כמו tasks.js: תאריך יעד רגיל, "באיחור" מחושב כאן
  // ולא בשרת. רלוונטי רק כל עוד הדיווח עדיין פתוח למעקב.
  const isOverdue = e => !!(e.due_date && e.followup && e.due_date < today());
  // ממוין קודם מי שבאיחור/קרוב לתזכורת; ללא תזכורת נדחק לסוף.
  const byDueDate = (a, b) => {
    const ad = a.due_date || '9999-99-99', bd = b.due_date || '9999-99-99';
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  };
  const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const ageTxt = n => n === 1 ? 'יום אחד' : n === 2 ? 'יומיים' : n + ' ימים';
  const daysSince = iso => { if (!iso) return null; const t = Date.parse(String(iso).slice(0, 10)); return isNaN(t) ? null : Math.max(0, Math.round((Date.parse(today()) - t) / 86400000)); };

  // ── גרסה 2 (19/10/2026): סוג אירוע, מצב ו"למעקב של" ─────────────────────
  // migration_behavior_v2.sql. סוג קבוע במקום קטגוריה (הקטגוריות ערבבו "מה קרה"
  // עם "של מי המעקב"), ומצב (log/open/in_progress/closed) במקום followup לבד.
  // followup עדיין קיים ומסונכרן בשרת, ולכן מסכים ישנים ממשיכים לעבוד.
  const SEVS = [['נמוכה', 'lo', 'bi-arrow-down-circle'], ['רגילה', 'mid', 'bi-dash-circle'], ['גבוהה', 'hi', 'bi-exclamation-triangle']];
  const FOLLOWS = [[0, 'לא, רק לתעד'], [1, 'בדיקה מחר'], [7, 'בעוד שבוע'], [14, 'שבועיים']];
  const STATUS = { log: 'תיעוד', open: 'פתוח', in_progress: 'בטיפול', closed: 'נסגר' };
  const PLACES = ['בית מדרש', 'שיעור', 'תפילה', 'הפסקה', 'אחר'];
  // ברירת מחדל אם הטבלה לא נטענה (מצב דמו / תקלה) — אותה רשימה כמו במיגרציה
  const DEFAULT_TYPES = [['איחור', '⏰', 'corrective'], ['הפרעה', '🗣️', 'corrective'], ['לא מוכן', '📕', 'corrective'],
    ['חברים', '🤝', 'corrective'], ['התנהגות', '⚠️', 'corrective'], ['שיחה עם תלמיד', '💬', 'neutral'],
    ['שיחה עם הורים', '👪', 'neutral'], ['נקודת אור', '⭐', 'positive'], ['אחר', '📌', 'neutral']]
    .map((t, i) => ({ id: i + 1, name: t[0], icon: t[1], direction: t[2], sort: (i + 1) * 10, active: true }));
  let typesCache = null;
  async function types() {
    if (typesCache) return typesCache;
    let t = [];
    try { t = await window.store.list('behavior_types'); } catch (_) {}
    const real = !!(t && t.length);
    t = (real ? t : DEFAULT_TYPES).filter(x => x.active !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    // ברירת המחדל לא נשמרת במטמון מחוץ לדמו: קריאה לפני הכניסה מחזירה ריק (RLS)
    if (real || DEMO) typesCache = t;
    return t;
  }
  // שם הסוג לתצוגה במסכים אחרים (בית, כרטיס תלמיד, לוח שנה) — אחרי await types()
  const typeName = e => { const t = e && e.type_id && (typesCache || []).find(x => x.id == e.type_id); return t ? t.icon + ' ' + t.name : ''; };
  const typeLabel = (ts, e, catName) => {
    const t = ts.find(x => x.id == e.type_id);
    if (t) return '<span class="ty ty-' + t.direction + '">' + esc(t.icon) + ' ' + esc(t.name) + '</span>';
    return catName ? '<span class="ty">' + esc(catName) + '</span>' : '<span class="ty ty-none">לא מסווג</span>';
  };
  const statusChip = e => {
    const s = e.status || (e.followup ? 'open' : 'log');
    if (s === 'log') return '';
    return '<span class="chip st-' + s + '"><i class="bi ' + (s === 'closed' ? 'bi-check2-circle' : 'bi-flag-fill') + '"></i> ' + STATUS[s] + '</span>';
  };
  const staffOpts = sel => (window.Author ? window.Author.all() : [])
    .filter(s => s.active && s.name && ['מנהל', 'מחנך', 'מלמד', 'מפקח'].includes(s.role))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))
    .map(s => '<option value="' + esc(s.id) + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
  const friendlyErr = msg => /DUPLICATE_REPORT/.test(msg || '') ? 'הדיווח הזה כבר נשמר לפני רגע'
    : /ASSIGNEE_STATUS_ONLY/.test(msg || '') ? 'כאחראי על המקרה אפשר לשנות רק מצב ותאריך בדיקה'
    : /RESTORE_ADMIN_ONLY/.test(msg || '') ? 'רק מנהל משחזר מסל המחזור'
    : /row-level security|42501/.test(msg || '') ? 'אין הרשאה לפעולה הזו' : 'השמירה נכשלה';

  // טופס הדיווח המהיר: מי (אפשר כמה) → מה קרה → כמה חמור → הערה → צריך המשך?
  // אותו רכיב במסך המעקב ובדף הבית של המורה. opts.onSaved(rows).
  async function quickForm(host, p, opts) {
    opts = opts || {};
    const [ts, studs] = await Promise.all([types(), students()]);
    if (window.Author) await window.Author.load();
    const pickHtml = await window.cv3Picker.html(p);
    const seg = (key, items, on) => '<div class="seg" data-qf="' + key + '">' + items.map(it =>
      '<button type="button" class="seg-b' + (String(it[0]) === String(on) ? ' on' : '') + '" data-v="' + esc(it[0]) + '">' + it[1] + '</button>').join('') + '</div>';
    host.innerHTML =
      '<div class="qf">' +
        '<div class="qf-step"><b>1</b> מי? <small>אפשר לבחור כמה</small></div>' + pickHtml +
        '<div class="qf-chips" id="' + p + 'Chips"></div>' +
        '<button type="button" class="btn-ghost sm qf-all" id="' + p + 'All" hidden></button>' +
        '<div class="qf-step"><b>2</b> מה קרה?</div>' +
        '<div class="qf-types" id="' + p + 'Types">' + ts.map(t =>
          '<button type="button" class="qf-type ty-' + t.direction + '" data-v="' + t.id + '"><span>' + esc(t.icon) + '</span>' + esc(t.name) + '</button>').join('') + '</div>' +
        '<div class="qf-sevrow" id="' + p + 'SevRow"><div class="qf-step"><b>3</b> כמה חמור?</div>' +
          seg('sev', SEVS.map(s => [s[0], '<i class="bi ' + s[2] + ' sev-ic ' + s[1] + '"></i> ' + s[0]]), 'רגילה') + '</div>' +
        '<textarea class="inp mb0 ta-auto" id="' + p + 'Note" rows="2" placeholder="הערה (רשות) — שורה אחת מספיקה"></textarea>' +
        '<div class="qf-when"><input class="inp mb0" id="' + p + 'Date" type="date" value="' + today() + '" title="תאריך">' +
          '<span class="heb-date" id="' + p + 'DateHeb"></span>' +
          '<input class="inp mb0" id="' + p + 'Time" type="time" title="שעה (רשות)"></div>' +
        '<div class="qf-step"><i class="bi bi-flag-fill" style="color:var(--danger)"></i> צריך המשך?</div>' + seg('fu', FOLLOWS, 0) +
        '<label class="qf-asg" id="' + p + 'AsgRow" hidden><span>למעקב של</span><select class="inp mb0" id="' + p + 'Asg">' +
          '<option value="">המחנך של השיעור (אוטומטי)</option>' + staffOpts(null) + '</select></label>' +
        '<button type="button" class="btn-primary qs-save" id="' + p + 'Save"><i class="bi bi-check-lg"></i> שמירה</button>' +
        '<div class="count-line" id="' + p + 'Msg"></div>' +
      '</div>';
    const $ = s => host.querySelector(s);
    let chosen = [], typeId = null;
    const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
    const drawChips = () => {
      $('#' + p + 'Chips').innerHTML = chosen.map(id => '<span class="qf-chip">' + esc(nameOf(id)) +
        '<button type="button" data-rm="' + id + '" title="הסרה">×</button></span>').join('');
    };
    const classSel = () => host.querySelector('.pk-class');
    const drawAll = () => {
      const b = $('#' + p + 'All'), c = classSel(), cid = c && c.value;
      const inClass = cid ? studs.filter(s => String(s.class_id) === String(cid)) : [];
      b.hidden = !inClass.length;
      if (inClass.length) { b.textContent = '+ כל השיעור (' + inClass.length + ')'; b.dataset.ids = inClass.map(s => s.id).join(','); }
    };
    const pick = window.cv3Picker.wire(host, p, () => {
      const v = pick && pick.value();
      if (v && !chosen.includes(Number(v))) { chosen.push(Number(v)); drawChips(); }
      if (v) setTimeout(() => pick.reset(), 0);
    });
    if (classSel()) classSel().addEventListener('change', drawAll);
    drawAll();
    $('#' + p + 'All').addEventListener('click', ev => {
      ev.currentTarget.dataset.ids.split(',').map(Number).forEach(id => { if (!chosen.includes(id)) chosen.push(id); });
      drawChips();
    });
    $('#' + p + 'Chips').addEventListener('click', ev => {
      const b = ev.target.closest('[data-rm]'); if (!b) return;
      chosen = chosen.filter(id => id != b.dataset.rm); drawChips();
    });
    $('#' + p + 'Types').addEventListener('click', ev => {
      const b = ev.target.closest('.qf-type'); if (!b) return;
      typeId = Number(b.dataset.v);
      host.querySelectorAll('.qf-type').forEach(x => x.classList.toggle('on', x === b));
      // "נקודת אור" — אין "כמה חמור"
      $('#' + p + 'SevRow').hidden = b.classList.contains('ty-positive');
    });
    host.querySelectorAll('.seg').forEach(sg => sg.addEventListener('click', ev => {
      const b = ev.target.closest('.seg-b'); if (!b) return;
      sg.querySelectorAll('.seg-b').forEach(x => x.classList.toggle('on', x === b));
      if (sg.dataset.qf === 'fu') $('#' + p + 'AsgRow').hidden = b.dataset.v === '0';
    }));
    const dEl = $('#' + p + 'Date'), dHeb = $('#' + p + 'DateHeb');
    const syncHeb = () => { dHeb.textContent = hebDate(dEl.value) || ''; };
    dEl.addEventListener('change', syncHeb); syncHeb();
    const segVal = k => { const b = host.querySelector('[data-qf="' + k + '"] .seg-b.on'); return b ? b.dataset.v : null; };
    const reset = () => {
      chosen = []; typeId = null; drawChips();
      host.querySelectorAll('.qf-type').forEach(x => x.classList.remove('on'));
      host.querySelectorAll('.seg').forEach(sg => sg.querySelectorAll('.seg-b').forEach((x, i) =>
        x.classList.toggle('on', sg.dataset.qf === 'sev' ? x.dataset.v === 'רגילה' : i === 0)));
      $('#' + p + 'SevRow').hidden = false; $('#' + p + 'AsgRow').hidden = true; $('#' + p + 'Asg').value = '';
      $('#' + p + 'Note').value = ''; $('#' + p + 'Time').value = '';
    };
    $('#' + p + 'Save').addEventListener('click', async ev => {
      const btn = ev.currentTarget;
      const v = pick.value();
      if (v && !chosen.includes(Number(v))) chosen.push(Number(v));
      if (!chosen.length) { window.UI.toast('בחר תלמיד', 'err'); return; }
      if (!typeId) { window.UI.toast('בחר מה קרה', 'err'); return; }
      const fu = Number(segVal('fu') || 0);
      const positive = $('#' + p + 'SevRow').hidden;
      const base = {
        type_id: typeId, severity: positive ? 'רגילה' : (segVal('sev') || 'רגילה'),
        note: $('#' + p + 'Note').value.trim() || null,
        event_date: dEl.value || today(), event_time: $('#' + p + 'Time').value || null,
        status: fu ? 'open' : 'log', due_date: fu ? addDays(fu) : null,
        assignee: fu ? ($('#' + p + 'Asg').value || null) : null, source: 'site',
      };
      const gid = chosen.length > 1 && window.crypto && crypto.randomUUID ? crypto.randomUUID() : null;
      const saved = [];
      for (const sid of chosen) {
        const r = await saveQuick(btn, Object.assign({ student_id: sid, group_id: gid }, base));
        if (!r) return;                                   // ביטול באישור הכפילות
        if (!r.ok) { window.UI.toast(friendlyErr(r.error) + (saved.length ? ' (נשמרו ' + saved.length + ')' : ''), 'err'); break; }
        saved.push((r.data && r.data[0]) || Object.assign({ student_id: sid }, base));
      }
      if (!saved.length) return;
      $('#' + p + 'Msg').textContent = '✓ נשמר' + (saved.length > 1 ? ' ל-' + saved.length + ' תלמידים' : '');
      window.UI.toast(saved.length > 1 ? 'נשמר ל-' + saved.length + ' תלמידים' : 'הדיווח נשמר');
      reset();
      if (opts.onSaved) opts.onSaved(saved);
    });
    return { reset };
  }

  // ── שלב 3 (19/10/2026): כרטיס דפוסים, סיכום שבועי והתראות ─────────────
  // במקום רשימה ארוכה של הערות: תמונה אחת שעונה על "כמה, מה, איפה, מתי ומי".
  // הכול מחושב בדפדפן מהדיווחים שהמשתמש ממילא רשאי לראות (RLS), כולל איחורים
  // מהנוכחות. ההתראות עצמן נוצרות בשרת (migration_behavior_rules.sql).
  const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const isoDaysAgo = n => addDays(-n);
  const weekStart = off => { const d = new Date(); d.setDate(d.getDate() - d.getDay() - 7 * (off || 0)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const dirOf = (ts, e) => ((ts.find(t => t.id == e.type_id) || {}).direction) || 'neutral';
  const topOf = (arr, key) => { const m = {}; arr.forEach(x => { const k = key(x); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const bucket = t => { const h = parseInt(String(t || '').slice(0, 2), 10); return isNaN(h) ? '' : h < 12 ? 'בוקר' : h < 16 ? 'צהריים' : 'אחר הצהריים / ערב'; };
  async function rulesList() {
    let r = [];
    try { r = await window.store.list('behavior_rules'); } catch (_) {}
    return (r && r.length ? r : [{ name: '3 דיווחי לתיקון בשבועיים', scope: 'corrective', threshold: 3, window_days: 14, active: true }]).filter(x => x.active !== false);
  }
  // כמה מהכללים התלמיד עובר כרגע (לתצוגה בלבד; ההתראה עצמה נשלחת מהשרת)
  function ruleHits(rules, ts, evs, att) {
    return rules.filter(r => {
      const from = isoDaysAgo(r.window_days);
      const n = r.scope === 'late' ? att.filter(a => a.status === 'late' && a.date > from).length
        : evs.filter(e => e.event_date > from && (r.scope === 'type' ? e.type_id == r.type_id : dirOf(ts, e) === 'corrective')).length;
      return n >= r.threshold;
    });
  }

  async function patternCard(sid) {
    const [studs, cls, ts, rules, all] = await Promise.all([students(), classes(), types(), rulesList(), events()]);
    let att = [];
    try { att = await window.store.byStudent('attendance', sid); } catch (_) {}
    if (window.Author) await window.Author.load();
    const s = studs.find(x => x.id == sid) || {};
    const c = cls.find(x => x.id == s.class_id);
    const evs = all.filter(e => e.student_id == sid);
    const m30 = isoDaysAgo(30), last30 = evs.filter(e => e.event_date > m30);
    const pos = last30.filter(e => dirOf(ts, e) === 'positive').length, cor = last30.filter(e => dirOf(ts, e) === 'corrective').length;
    const late30 = att.filter(a => a.status === 'late' && a.date > m30).length, abs30 = att.filter(a => a.status === 'absent' && a.date > m30).length;
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const a = weekStart(7 - i), b = weekStart(6 - i);
      const inW = e => e.event_date >= a && (i === 7 || e.event_date < b);
      return { label: (hebDate(a) || a).split(' ').slice(0, 2).join(' '), cor: evs.filter(e => inW(e) && dirOf(ts, e) === 'corrective').length,
        pos: evs.filter(e => inW(e) && dirOf(ts, e) === 'positive').length, oth: evs.filter(e => inW(e) && dirOf(ts, e) === 'neutral').length };
    });
    const max = Math.max(1, ...weeks.map(w => w.cor + w.pos + w.oth));
    const recent = evs.filter(e => e.event_date > isoDaysAgo(14)).length, before = evs.filter(e => e.event_date > isoDaysAgo(28) && e.event_date <= isoDaysAgo(14)).length;
    const trend = recent > before + 1 ? '<span class="pc-up">↑ עלייה בשבועיים האחרונים (' + recent + ' מול ' + before + ')</span>'
      : recent + 1 < before ? '<span class="pc-down">↓ ירידה בשבועיים האחרונים (' + recent + ' מול ' + before + ')</span>' : 'יציב בשבועיים האחרונים';
    const hits = ruleHits(rules, ts, evs, att);
    const topTypes = topOf(evs, e => { const t = ts.find(x => x.id == e.type_id); return t ? t.icon + ' ' + t.name : ''; }).slice(0, 4);
    const topPlace = topOf(evs, e => e.place)[0], topDay = topOf(evs, e => { const d = new Date(e.event_date); return isNaN(d) ? '' : DAY_NAMES[d.getDay()]; })[0];
    const topTime = topOf(evs, e => bucket(e.event_time))[0];
    const open = evs.filter(e => ['open', 'in_progress'].includes(e.status || (e.followup ? 'open' : 'log')));
    const kpi = (n, l, cls2) => '<div class="pc-kpi' + (cls2 ? ' ' + cls2 : '') + '"><b>' + n + '</b><span>' + l + '</span></div>';
    window.UI.modal({
      title: 'כרטיס דפוסים — ' + esc(s.name || '') + (c ? ' · ' + esc(c.name) : ''), cancelLabel: 'סגירה',
      bodyHTML: '<div class="pc">' +
        hits.map(r => '<div class="pc-alert"><i class="bi bi-exclamation-triangle-fill"></i> עובר את הכלל "' + esc(r.name) + '"</div>').join('') +
        '<div class="pc-kpis">' + kpi(last30.length, 'דיווחים בחודש') + kpi('⭐ ' + pos, 'חיוביים', 'pos') + kpi(cor, 'לתיקון', cor ? 'cor' : '') +
          kpi(late30, 'איחורים בנוכחות') + kpi(abs30, 'היעדרויות') + '</div>' +
        '<h4>חיובי מול לתיקון (חודש אחרון)</h4>' +
        (pos + cor ? '<div class="pc-ratio"><span class="pos" style="flex:' + pos + '">' + (pos ? '⭐ ' + pos : '') + '</span><span class="cor" style="flex:' + cor + '">' + (cor ? cor + ' לתיקון' : '') + '</span></div>'
          : '<div class="tl-note">אין דיווחים חיוביים או מתקנים בחודש האחרון</div>') +
        '<div class="tl-note pc-small">היעד המקובל: 4 חיוביים על כל הערה מתקנת</div>' +
        '<h4>דיווחים בכל שבוע</h4><div class="pc-weeks">' + weeks.map(w =>
          '<div class="pc-w" title="' + esc(w.label) + ': ' + (w.cor + w.pos + w.oth) + '"><div class="pc-bar">' +
            '<i class="cor" style="height:' + (w.cor / max * 100) + '%"></i><i class="oth" style="height:' + (w.oth / max * 100) + '%"></i><i class="pos" style="height:' + (w.pos / max * 100) + '%"></i>' +
          '</div><small>' + esc(w.label) + '</small></div>').join('') + '</div>' +
        '<div class="tl-note pc-small">' + trend + '</div>' +
        '<h4>מה, איפה ומתי</h4><div class="pc-tags">' +
          (topTypes.map(([k, n]) => '<span class="chip off">' + esc(k) + ' ' + n + '</span>').join('') || '<span class="tl-note">אין עדיין</span>') +
          (topPlace ? '<span class="chip off">📍 בעיקר ב' + esc(topPlace[0]) + '</span>' : '') +
          (topDay ? '<span class="chip off">📅 בעיקר ביום ' + esc(topDay[0]) + '</span>' : '') +
          (topTime ? '<span class="chip off">🕘 בעיקר ב' + esc(topTime[0]) + '</span>' : '') + '</div>' +
        (open.length ? '<h4>מקרה פתוח</h4>' + open.map(e => '<div class="tl-item"><div class="tl-main">' + typeLabel(ts, e, '') + ' ' + statusChip(e) +
            (e.assignee ? ' · ' + esc(window.Author ? window.Author.name(e.assignee) : '') : '') + '</div><div class="tl-meta">' +
            (daysSince(e.event_date) ? 'פתוח ' + ageTxt(daysSince(e.event_date)) : 'נפתח היום') + '</div></div>').join('') : '') +
        '<h4>אחרונים</h4>' + (evs.slice().sort((a, b) => String(b.event_date).localeCompare(String(a.event_date))).slice(0, 5).map(e =>
          '<div class="tl-item"><div class="tl-main">' + typeLabel(ts, e, '') + (e.note ? ' <span class="tl-note nt">— ' + esc(e.note) + '</span>' : '') + '</div>' +
          '<div class="tl-meta">' + esc(hebDate(e.event_date) || e.event_date) + '</div></div>').join('') || '<div class="tl-note">אין דיווחים</div>') +
      '</div>',
    });
  }

  // סיכום שבועי (מנהל ומפקח) — "ככה נראה הסיכום כשהמערכת מתפקדת"
  async function weeklySummaryHtml() {
    if (!canSeeStats()) return '';
    const [evs, studs, cls, ts, rules] = await Promise.all([events(), students(), classes(), types(), rulesList()]);
    if (window.Author) await window.Author.load();
    let att = [];
    try { att = await window.store.list('attendance'); } catch (_) {}
    const w0 = weekStart(0), w1 = weekStart(1);
    const thisW = evs.filter(e => e.event_date >= w0), prevW = evs.filter(e => e.event_date >= w1 && e.event_date < w0);
    const posPct = thisW.length ? Math.round(thisW.filter(e => dirOf(ts, e) === 'positive').length / thisW.length * 100) : 0;
    const active = evs.filter(e => ['open', 'in_progress'].includes(e.status || (e.followup ? 'open' : 'log')));
    const overdue = active.filter(e => e.due_date && e.due_date < today()).length;
    const byStu = sid => evs.filter(e => e.student_id == sid);
    const rising = studs.filter(s => { const v = byStu(s.id); const a = v.filter(e => e.event_date > isoDaysAgo(14)).length, b = v.filter(e => e.event_date > isoDaysAgo(28) && e.event_date <= isoDaysAgo(14)).length; return a >= 2 && a > b + 1; });
    const overRule = studs.filter(s => ruleHits(rules, ts, byStu(s.id), att.filter(a => a.student_id == s.id)).length);
    const quiet = {};
    studs.forEach(s => { if (!byStu(s.id).some(e => e.event_date > isoDaysAgo(30))) { const c = cls.find(x => x.id == s.class_id); const k = c ? c.name : 'ללא שיעור'; quiet[k] = (quiet[k] || 0) + 1; } });
    const staff = (window.Author ? window.Author.all() : []).filter(p => p.active && ['מחנך', 'מלמד'].includes(p.role));
    const silent = staff.filter(p => !evs.some(e => e.created_by === p.id && e.event_date > isoDaysAgo(14)));
    let voiceN = 0;
    if (isAdmin() && !DEMO && window.db && !window.db.DEMO) {
      try { const r = await window.db.list('voice_reports', { eq: { status: 'draft' } }); voiceN = ((r && r.data) || []).length; } catch (_) {}
    }
    const who = topOf(thisW, e => window.Author ? window.Author.name(e.created_by) : '').slice(0, 6);
    const stuLinks = arr => arr.slice(0, 6).map(s => '<a href="#" data-pc="' + s.id + '">' + esc(s.name) + '</a>').join(', ') + (arr.length > 6 ? ' ועוד ' + (arr.length - 6) : '');
    const att2 = [
      overRule.length ? overRule.length + ' תלמידים עוברים כלל התראה: ' + stuLinks(overRule) : '',
      voiceN ? voiceN + ' דיווחים קוליים ממתינים לאישור.' : '',
      overdue ? overdue + ' מקרים פתוחים עברו את תאריך הבדיקה.' : '',
      Object.keys(quiet).length ? 'לא הוזכרו כבר חודש: ' + Object.entries(quiet).map(([k, n]) => esc(k) + ' ' + n).join(' · ') : '',
      silent.length ? silent.length + ' אנשי צוות לא דיווחו שבועיים: ' + silent.map(p => esc(p.name)).join(', ') : '',
    ].filter(Boolean);
    const kpi = (n, l, sub) => '<div class="pc-kpi"><b>' + n + '</b><span>' + l + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
    // פתוח בראשון-שני (תחילת השבוע); בשאר הימים מקופל כדי לא לדחוף את הטופס למטה
    return '<details class="qr-card ws"' + ([0, 1].includes(new Date().getDay()) ? ' open' : '') + '><summary><i class="bi bi-calendar-week"></i> הסיכום השבועי <span class="tl-note">מיום ראשון ' + esc(hebDate(w0) || w0) + '</span></summary>' +
      '<div class="pc-kpis">' + kpi(thisW.length, 'דיווחים השבוע', 'שבוע קודם: ' + prevW.length) + kpi(posPct + '%', '⭐ נקודות אור') +
        kpi(active.length, 'מקרים פתוחים', overdue ? overdue + ' באיחור' : '') + kpi(rising.length, 'במגמת עלייה', rising.length ? stuLinks(rising) : '') + '</div>' +
      (who.length ? '<div class="ws-who"><b>מי דיווח השבוע:</b> ' + who.map(([n, k]) => esc(n) + ' ' + k).join(' · ') + '</div>' : '') +
      (att2.length ? '<div class="ws-att"><b><i class="bi bi-exclamation-circle"></i> דורש תשומת לב</b><ul>' + att2.map(x => '<li>' + x + '</li>').join('') + '</ul></div>' : '') +
    '</details>';
  }

  // התראות אישיות (מהשרת) — בראש החלונית בבית
  async function notificationsHtml() {
    if (DEMO || !window.db || window.db.DEMO) return '';
    try {
      const r = await window.db.list('notifications', { order: 'created_at', asc: false });
      const d = ((r && r.ok && r.data) || []).filter(n => !n.read_at).slice(0, 8);
      if (!d.length) return '';
      const studs = await students();
      const nm = id => (studs.find(s => s.id == id) || {}).name || '';
      return '<div class="qr-card nt-card"><div class="card-h-row"><h3 style="margin:0"><i class="bi bi-bell-fill" style="color:var(--danger)"></i> התראות</h3>' +
        '<button class="btn-ghost sm" data-nread="all">סימון הכול כנקרא</button></div>' +
        d.map(n => '<div class="nt-item"><div><b>' + esc(nm(n.student_id)) + '</b> — ' + esc(n.title) + (n.body ? ' <span class="tl-note">(' + esc(n.body) + ')</span>' : '') + '</div>' +
          '<div class="nt-act">' + (n.student_id ? '<button class="btn-ghost sm" data-pc="' + n.student_id + '">כרטיס דפוסים</button>' : '') +
          '<button class="mini" data-nread="' + n.id + '" title="נקרא"><i class="bi bi-check2"></i></button></div></div>').join('') + '</div>';
    } catch (_) { return ''; }
  }
  // לחיצות משותפות: כרטיס דפוסים + סימון התראה כנקראה
  function wireSmart(root, onChange) {
    root._smartCb = onChange;                  // מרונדר שוב ושוב — מאזין אחד בלבד
    if (root._smartWired) return;
    root._smartWired = true;
    root.addEventListener('click', async ev => {
      const pc = ev.target.closest('[data-pc]');
      if (pc) { ev.preventDefault(); patternCard(Number(pc.dataset.pc)); return; }
      const nr = ev.target.closest('[data-nread]');
      if (nr) {
        try { await window.sb.rpc('notification_read', { p_id: nr.dataset.nread === 'all' ? null : Number(nr.dataset.nread) }); } catch (_) {}
        if (root._smartCb) root._smartCb();
      }
    });
  }

  // ── חסימת שמירה כפולה ─────────────────────────────────────────────────
  // תלמיד אחד קיבל 5 דיווחים זהים — לחיצות חוזרות על "שמור" בזמן שהשרת עוד
  // לא ענה. שתי שכבות: הכפתור נעול עד שהשמירה מסתיימת, ודיווח זהה (אותו תלמיד,
  // תאריך, קטגוריה והערה) בתוך 2 דקות מבקש אישור מפורש.
  let lastQuick = null;
  async function saveQuick(btn, row) {
    if (btn.disabled) return null;
    const key = [row.student_id, row.event_date, row.type_id || row.category_id || '', (row.note || '').trim()].join('|');
    if (lastQuick && lastQuick.key === key && Date.now() - lastQuick.at < 120000 &&
        !(await window.UI.confirm('דיווח זהה בדיוק נשמר לפני רגע. לשמור אותו שוב?'))) return null;
    const html = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> שומר…';
    try {
      const r = await window.store.add('behavior_events', row);
      if (r && r.ok) lastQuick = { key, at: Date.now() };
      return r;
    } finally { btn.disabled = false; btn.innerHTML = html; }
  }

  // ── סגירת מקרה עם סיכום ───────────────────────────────────────────────
  // "טופל" בלי מילה השאיר מקרים בלי סוף לסיפור. הסיכום נשמר כעדכון מעקב
  // אחרון (behavior_comments), כך שאין צורך בעמודה חדשה.
  function resolveWithSummary(ev, studentName) {
    return new Promise(resolve => {
      let done = false;
      window.UI.modal({
        title: 'סגירת מקרה — ' + esc(studentName),
        saveLabel: 'סגירה ושמירת הסיכום',
        bodyHTML: '<div class="form-grid"><label class="fld fld-wide"><span>איך זה נגמר? *</span>' +
          '<textarea class="inp mb0 ta-auto" id="rs_note" rows="3" placeholder="למשל: דובר עם האבא, השתפר מאז / הועבר לתוכנית אישית"></textarea></label></div>',
        onSave: async (mel) => {
          const note = mel.querySelector('#rs_note').value.trim();
          if (!note) { window.UI.toast('כתוב משפט סיכום קצר', 'err'); return false; }
          const c = await addComment(ev.id, { comment_date: today(), note: 'סיכום סגירה: ' + note });
          if (!c || c.ok === false) { window.UI.toast('שמירת הסיכום נכשלה', 'err'); return false; }
          const r = await updEvent(ev.id, { status: 'closed' });
          if (!r || r.ok === false) { window.UI.toast('הסיכום נשמר, אבל הסגירה נכשלה', 'err'); return false; }
          Object.assign(ev, (r.data && r.data[0]) || { status: 'closed', followup: false, closed_at: new Date().toISOString() }); done = true;
          window.UI.toast('המקרה נסגר'); return true;
        },
        onClose: () => resolve(done),
      });
    });
  }

  // ── התראה על דיווחים קוליים ממתינים (מנהל) ─────────────────────────────
  // דיווח מהקו נשמר כטיוטה וממתין לאישור במסך "דיווחים קוליים", ששום דבר לא
  // הפנה אליו: טיוטה אחת חיכתה 32 יום, והמלמד בטוח שהדיווח נכנס.
  async function voiceAlertHtml() {
    if (!isAdmin() || DEMO || !window.db || window.db.DEMO) return '';
    try {
      const r = await window.db.list('voice_reports', { eq: { status: 'draft' }, order: 'created_at', asc: true });
      const d = (r && r.ok && r.data) || [];
      if (!d.length) return '';
      const age = daysSince(d[0].created_at);
      return '<a class="voice-alert" href="#voicereports"><i class="bi bi-mic-fill"></i>' +
        '<span><b>' + d.length + ' דיווח' + (d.length > 1 ? 'ים קוליים ממתינים' : ' קולי ממתין') + ' לאישור</b>' +
        (age ? '<small>הוותיק ביותר ממתין ' + ageTxt(age) + '</small>' : '') + '</span>' +
        '<span class="va-go">לאישור ←</span></a>';
    } catch (_) { return ''; }
  }

  // "קפיצה" יזומה לרב שצריך לטפל (בקשת יוסף 06/09/2026): קודם התזכורת רק
  // הופיעה באדום כשמישהו *כבר* נכנס למסך הזה. עכשיו קופצת מעצמה כשנכנסים
  // הביתה, ביום שהתזכורת חלה או אחריו. פעם אחת ליום לכל משתמש (localStorage)
  // — לא לפי מי "טופל" בשרת, כדי שלא ליצור עוד עמודת מצב על behavior_events
  // רק בשביל "האם כבר קפץ". אם לא נגמר היום עדיין יקפוץ שוב מחר, וזה בכוונה.
  function duePopupKey() {
    const uid = (window.currentUser && window.currentUser.id) || 'anon';
    return 'bht_fu_popup_' + uid + '_' + today();
  }
  async function maybeShowDuePopup() {
    try { if (localStorage.getItem(duePopupKey())) return; } catch (_) { return; }
    const evs = await events();
    const due = evs.filter(e => e.followup && e.due_date && e.due_date <= today()).sort(byDueDate);
    if (!due.length) return;
    const studs = await students();
    const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
    try { localStorage.setItem(duePopupKey(), '1'); } catch (_) {}
    window.UI.modal({
      title: '⏰ תזכורות מעקב שהגיע זמנן',
      cancelLabel: 'סגירה',
      bodyHTML:
        '<div class="tl-note" style="margin-bottom:8px">' + due.length + ' דיווח' + (due.length > 1 ? 'ים' : '') + ' במעקב הגיע' + (due.length > 1 ? 'ו' : '') + ' לתאריך התזכורת:</div>' +
        due.map(e => '<div class="tl-item" style="border-right:3px solid ' + flagColor(e.severity) + '">' +
          '<span class="sev-dot ' + sevClass(e.severity) + '"></span>' +
          '<div class="tl-main"><strong>' + esc(nameOf(e.student_id)) + '</strong>' +
            (e.note ? ' <span class="tl-note">— ' + esc(e.note) + '</span>' : '') + '</div>' +
          '<div class="tl-meta">' + (e.due_date < today() ? 'באיחור מ' : 'תזכורת ל') + '־' + esc(hebDate(e.due_date) || e.due_date) + '</div>' +
        '</div>').join('') +
        '<div style="text-align:center;margin-top:10px"><a href="#followup" class="btn-primary sm">מעבר לרשימת המעקב הדחוף ←</a></div>',
    });
  }

  // כל הנתונים דרך המאגר המרכזי (store.js)
  async function students() { return (window.cv3Students ? await window.cv3Students.getStudents() : []); }
  async function cats() { return window.store.list('categories'); }
  async function events() {
    let ev = (await window.store.list('behavior_events')).slice().reverse();
    const ids = window.cv3Students ? await window.cv3Students.accessibleIds() : null;
    if (ids) ev = ev.filter(e => ids.includes(e.student_id));
    return ev;
  }
  async function addEvent(row) { const r = await window.store.add('behavior_events', row); return { ok: r.ok, data: r.data }; }
  async function delEvent(id) { return window.store.remove('behavior_events', id); }
  async function updEvent(id, row) { return window.store.update('behavior_events', id, row); }
  async function toggleFollowup(ev) {
    const next = !ev.followup;
    const r = await updEvent(ev.id, { followup: next });
    if (r && r.ok !== false) ev.followup = next;
    return r;
  }

  // תגובות מעקב — ציר-זמן מתוארך של עדכונים על דיווח בודד (למשל: "דיברתי עם
  // ההורים", ואחר-כך "צריך להפנות לאבחון"), בלי לפתוח דיווח נפרד לכל עדכון.
  async function allComments() { return window.store.list('behavior_comments'); }
  // מפה event_id → כמות תגובות, לתגי הספירה על כפתור "עדכוני מעקב".
  function commentCounts(comments) {
    const m = {};
    (comments || []).forEach(c => { m[c.event_id] = (m[c.event_id] || 0) + 1; });
    return m;
  }
  async function addComment(eventId, row) { return window.store.add('behavior_comments', Object.assign({ event_id: eventId }, row)); }
  async function delComment(id) { return window.store.remove('behavior_comments', id); }

  async function classes() { return window.cv3Students ? await window.cv3Students.getClasses() : []; }

  // ── טופס דיווח משותף ─────────────────────────────────────────────────
  // אותו טופס משמש את מסך המעקב, את רשימת הדיווחים בבית, ואת כרטיס התלמיד.
  // קודם הוא חי בתוך renderBehavior ולכן היה נגיש רק משם, וכל מסך אחר נאלץ
  // להיות לקריאה בלבד.
  //
  // openEventForm(ev, opts):
  //   ev   — הדיווח לעריכה, או null ליצירת דיווח חדש
  //   opts — { studentId: נעילת התלמיד ביצירה, onSaved: קריאה חוזרת }
  async function openEventForm(ev, opts) {
    opts = opts || {};
    const isNew = !ev || !ev.id;
    const [studs, ts] = await Promise.all([students(), types()]);
    if (window.Author) await window.Author.load();
    const cur = ev || { student_id: opts.studentId || null, event_date: today(), severity: 'רגילה', status: 'log' };
    const curStatus = cur.status || (cur.followup ? 'open' : 'log');
    const nm = x => window.UI.fullName ? window.UI.fullName(x) : x.name;
    const opt = (v, label, selV) => '<option value="' + esc(v) + '"' + (String(v) === String(selV == null ? '' : selV) ? ' selected' : '') + '>' + esc(label) + '</option>';
    const stuOpts = studs.map(x => opt(x.id, nm(x), cur.student_id)).join('');
    const typeSel = (cur.type_id ? '' : '<option value="">— לא מסווג —</option>') + ts.map(t => opt(t.id, t.icon + ' ' + t.name, cur.type_id)).join('');
    const sevSel = ['נמוכה', 'רגילה', 'גבוהה'].map(x => opt(x, x, cur.severity || 'רגילה')).join('');
    const stSel = Object.keys(STATUS).map(k => opt(k, STATUS[k], curStatus)).join('');
    const placeSel = '<option value="">—</option>' + PLACES.map(x => opt(x, x, cur.place)).join('');
    // כשהתלמיד נעול (דיווח מתוך הכרטיס שלו) מציגים את שמו ולא בורר
    const lockStu = isNew && opts.studentId;
    const stuRec = lockStu ? (studs.find(x => String(x.id) === String(opts.studentId)) || {}) : null;
    // "למעקב של" שאינו רשאי לערוך: רק מצב, תאריך בדיקה ואחראי (נאכף גם בשרת)
    const me = window.currentUser && window.currentUser.id;
    const statusOnly = !isNew && window.Auth && window.Auth.canEditRow && !window.Auth.canEditRow(cur) && cur.assignee === me;
    const dis = statusOnly ? ' disabled' : '';
    const m = window.UI.modal({
      title: isNew ? ('דיווח חדש' + (stuRec ? ' — ' + esc(nm(stuRec)) : '')) : 'עריכת דיווח',
      saveLabel: 'שמירה',
      bodyHTML:
        (statusOnly ? '<div class="fu-hint"><i class="bi bi-person-check"></i> המקרה בטיפולך: אפשר לעדכן מצב, תאריך בדיקה ואחראי.</div>' : '') +
        '<div class="form-grid">' +
          (lockStu
            ? '<input type="hidden" id="ee_stu" value="' + esc(opts.studentId) + '">'
            : '<label class="fld"><span>תלמיד</span><select class="inp mb0" id="ee_stu"' + dis + '><option value="">— בחר —</option>' + stuOpts + '</select></label>') +
          '<label class="fld"><span>סוג</span><select class="inp mb0" id="ee_type"' + dis + '>' + typeSel + '</select></label>' +
          '<label class="fld"><span>חומרה</span><select class="inp mb0" id="ee_sev"' + dis + '>' + sevSel + '</select></label>' +
          '<label class="fld"><span>מקום (רשות)</span><select class="inp mb0" id="ee_place"' + dis + '>' + placeSel + '</select></label>' +
          '<label class="fld"><span>תאריך</span><input class="inp mb0" id="ee_date" type="date"' + dis + ' value="' + esc(String(cur.event_date || today()).slice(0, 10)) + '"></label>' +
          '<label class="fld"><span>שעה</span><input class="inp mb0" id="ee_time" type="time"' + dis + ' value="' + esc(cur.event_time || '') + '"></label>' +
          '<label class="fld"><span>מצב</span><select class="inp mb0" id="ee_status">' + stSel + '</select></label>' +
          '<label class="fld"><span>תאריך בדיקה</span><input class="inp mb0" id="ee_due" type="date" max="2099-12-31" value="' + esc(cur.due_date || '') + '"></label>' +
          '<label class="fld"><span>למעקב של</span><select class="inp mb0" id="ee_asg"><option value="">המחנך של השיעור (אוטומטי)</option>' + staffOpts(cur.assignee) + '</select></label>' +
          '<label class="fld fld-wide"><span>הערה</span><textarea class="inp mb0 ta-auto" id="ee_note" rows="5"' + dis + '>' + esc(cur.note || '') + '</textarea></label>' +
        '</div>' +
        (!isNew && canSeeStats() ? '<div style="margin-top:8px"><button type="button" class="btn-ghost sm" id="ee_hist"><i class="bi bi-clock-history"></i> היסטוריית שינויים</button></div>' : ''),
      onSave: async (mel) => {
        const v = id => mel.querySelector(id).value;
        const status = v('#ee_status');
        let row = {
          status, due_date: v('#ee_due') || null, assignee: v('#ee_asg') || null,
        };
        if (!statusOnly) Object.assign(row, {
          student_id: Number(v('#ee_stu')) || null,
          type_id: Number(v('#ee_type')) || null,
          event_date: v('#ee_date') || today(),
          event_time: v('#ee_time') || null,
          severity: v('#ee_sev'),
          place: v('#ee_place') || null,
          note: v('#ee_note').trim() || null,
        });
        if (!statusOnly && !row.student_id) { window.UI.toast('חובה לבחור תלמיד', 'err'); return false; }
        if (isNew && !row.type_id) { window.UI.toast('בחר סוג', 'err'); return false; }
        // מעבר ל"נסגר" מהטופס — גם כאן מבקשים משפט סיכום
        if (!isNew && status === 'closed' && curStatus !== 'closed') {
          const summary = await new Promise(res => {
            let val = null;
            window.UI.modal({ title: 'משפט סיכום לסגירה', saveLabel: 'שמירה',
              bodyHTML: '<textarea class="inp mb0 ta-auto" id="rs2" rows="3" placeholder="איך זה נגמר?"></textarea>',
              onSave: mm => { val = mm.querySelector('#rs2').value.trim(); if (!val) { window.UI.toast('כתוב משפט סיכום', 'err'); return false; } return true; },
              onClose: () => res(val) });
          });
          if (!summary) return false;
          await addComment(ev.id, { comment_date: today(), note: 'סיכום סגירה: ' + summary });
        }
        const r = isNew ? await addEvent(row) : await updEvent(ev.id, row);
        if (!r || r.ok === false) { window.UI.toast(friendlyErr(r && r.error), 'err'); return false; }
        const saved = r.data && r.data[0];
        if (!isNew) Object.assign(ev, saved || row);
        window.UI.toast(isNew ? 'הדיווח נשמר' : 'הדיווח עודכן');
        if (opts.onSaved) { try { await opts.onSaved(saved || row); } catch (_) {} }
        return true;
      },
    });
    const hb = m.el.querySelector('#ee_hist');
    if (hb) hb.addEventListener('click', () => openHistory(ev));
  }

  // ── יומן שינויים (מנהל ומפקח) ─────────────────────────────────────────
  const b64text = b => { try { return b ? new TextDecoder('utf-8').decode(Uint8Array.from(atob(b), c => c.charCodeAt(0))) : null; } catch (_) { return null; } };
  const b64json = b => { try { return b ? JSON.parse(new TextDecoder('utf-8').decode(Uint8Array.from(atob(b), c => c.charCodeAt(0)))) : null; } catch (_) { return null; } };
  const FIELD = { student_id: 'תלמיד', type_id: 'סוג', category_id: 'קטגוריה', severity: 'חומרה', event_date: 'תאריך', event_time: 'שעה',
    note: 'הערה', status: 'מצב', due_date: 'תאריך בדיקה', assignee: 'למעקב של', place: 'מקום', deleted_at: 'סל מחזור' };
  async function openHistory(ev) {
    const [ts, studs] = await Promise.all([types(), students()]);
    const r = DEMO ? { ok: true, data: [] } : await window.db.list('behavior_audit_enc', { eq: { event_id: ev.id }, order: 'at', asc: true });
    const fmt = (k, v) => v == null || v === '' ? '—'
      : k === 'type_id' ? ((ts.find(t => t.id == v) || {}).name || v)
      : k === 'assignee' ? (window.Author ? window.Author.name(v) : v)
      : k === 'student_id' ? ((studs.find(s => s.id == v) || {}).name || v)
      : k === 'status' ? (STATUS[v] || v) : k === 'deleted_at' ? 'כן' : String(v);
    const rows = ((r && r.data) || []).map(a => {
      const o = b64json(a.old_b64) || {}, n = b64json(a.new_b64) || {};
      const ch = Object.keys(FIELD).filter(k => JSON.stringify(o[k]) !== JSON.stringify(n[k]));
      const what = a.op === 'trash' ? 'הועבר לסל המחזור' : a.op === 'restore' ? 'שוחזר מהסל'
        : ch.map(k => '<div><b>' + FIELD[k] + ':</b> <s>' + esc(fmt(k, o[k])) + '</s> ← ' + esc(fmt(k, n[k])) + '</div>').join('') || 'שינוי טכני';
      return '<div class="tl-item" style="align-items:flex-start"><div class="tl-main">' + what + '</div>' +
        '<div class="tl-meta">' + esc(String(a.at || '').slice(0, 16).replace('T', ' ')) + ' · ' + (window.Author ? window.Author.cell(a.actor) : '') + '</div></div>';
    });
    window.UI.modal({ title: 'היסטוריית שינויים', cancelLabel: 'סגירה',
      bodyHTML: rows.length ? rows.join('') : '<div class="tl-note">אין שינויים מאז שנוצר (היומן פעיל מ-19/10/2026)</div>' });
  }

  // ── סל מחזור (מנהל) ──────────────────────────────────────────────────
  async function openTrash(opts) {
    opts = opts || {};
    if (DEMO) { window.UI.toast('סל המחזור לא זמין במצב הדגמה'); return; }
    // מה שבסל יותר מ-30 יום נמחק סופית בכל פתיחה של הסל (גם היומן, העדכונים ויומן השינויים)
    try { await window.sb.rpc('behavior_purge_trash', { p_id: null }); } catch (_) {}
    const [ts, studs] = await Promise.all([types(), students()]);
    const r = await window.db.list('behavior_events_trash_enc', { order: 'deleted_at', asc: false });
    const items = ((r && r.data) || []).map(x => Object.assign({}, x, { note: b64text(x.note_b64) }));
    const nameOf = id => (studs.find(s => s.id == id) || {}).name || '—';
    const html = () => items.length ? items.map(x => {
      const left = 30 - (daysSince(x.deleted_at) || 0);
      return '<div class="tl-item"><div class="tl-main"><strong>' + esc(nameOf(x.student_id)) + '</strong> · ' + typeLabel(ts, x, '') +
        (x.note ? ' <span class="tl-note nt">— ' + esc(x.note) + '</span>' : '') + '</div>' +
        '<div class="tl-meta">נמחק ' + esc(hebDate(String(x.deleted_at).slice(0, 10)) || '') + ' · ' + (window.Author ? window.Author.cell(x.deleted_by) : '') +
          ' · עוד ' + Math.max(0, left) + ' ימים</div>' +
        '<button class="mini" data-restore="' + x.id + '" title="שחזור"><i class="bi bi-arrow-counterclockwise"></i></button>' +
        '<button class="mini danger" data-purge="' + x.id + '" title="מחיקה לצמיתות"><i class="bi bi-x-octagon"></i></button></div>';
    }).join('') : '<div class="tl-note">הסל ריק</div>';
    const m = window.UI.modal({ title: 'סל מחזור — נמחק סופית אחרי 30 יום', cancelLabel: 'סגירה', bodyHTML: '<div id="trashList">' + html() + '</div>' });
    m.el.querySelector('#trashList').addEventListener('click', async ev => {
      const rb = ev.target.closest('[data-restore]'), pb = ev.target.closest('[data-purge]');
      if (rb) {
        const u = await window.db.update('behavior_events', Number(rb.dataset.restore), { deleted_at: null });
        if (!u.ok) { window.UI.toast(friendlyErr(u.error), 'err'); return; }
        window.UI.toast('הדיווח שוחזר');
      } else if (pb) {
        if (!(await window.UI.confirm('למחוק לצמיתות? אי אפשר לבטל.'))) return;
        const { error } = await window.sb.rpc('behavior_purge_trash', { p_id: Number(pb.dataset.purge) });
        if (error) { window.UI.toast(friendlyErr(error.message), 'err'); return; }
        window.UI.toast('נמחק לצמיתות');
      } else return;
      const id = Number((rb || pb).dataset.restore || (rb || pb).dataset.purge);
      items.splice(items.findIndex(x => x.id === id), 1);
      m.el.querySelector('#trashList').innerHTML = html();
      if (opts.onChange) opts.onChange();
    });
  }
  async function removeEvent(ev, onDone) {
    if (!ev) return;
    if (!(await window.UI.confirm('למחוק את הדיווח?'))) return;
    const r = await delEvent(ev.id);
    if (!r || r.ok === false) { window.UI.toast('המחיקה נכשלה', 'err'); return; }
    window.UI.toast('נמחק');
    if (onDone) { try { await onDone(); } catch (_) {} }
  }

  function commentRowHtml(c) {
    return '<div class="tl-item" style="padding:9px 12px;margin-bottom:7px">' +
      '<div class="tl-main"><span class="tl-note" style="white-space:pre-wrap">' + esc(c.note) + '</span></div>' +
      '<div class="tl-meta">' + esc(hebDate(c.comment_date) || c.comment_date) +
        ' · <i class="bi bi-person-badge"></i> ' + (window.Author ? window.Author.cell(c.created_by) : '') + '</div>' +
      ((!window.Auth || !window.Auth.canEditRow || window.Auth.canEditRow(c))
        ? '<button class="mini danger" data-cmtdel="' + c.id + '" title="מחיקת עדכון"><i class="bi bi-trash"></i></button>'
        : '') +
      '</div>';
  }
  // מודאל תגובות משותף — נפתח גם ממסך "מעקב תלמידים" וגם מלשונית "מעקב דחוף".
  // לא נסגר לבד אחרי הוספה/מחיקה: אפשר לצבור כמה עדכונים ברצף על אותו דיווח
  // (למשל "דיברתי עם ההורים" ואז "צריך הפניה לאבחון") בלי לפתוח כל פעם מחדש.
  async function openComments(ev, opts) {
    opts = opts || {};
    let list = (await window.store.list('behavior_comments', { eq: { event_id: ev.id } }))
      .slice().sort((a, b) => String(a.comment_date || '').localeCompare(String(b.comment_date || '')) || (a.id - b.id));
    const m = window.UI.modal({
      title: 'עדכוני מעקב' + (opts.title ? ' — ' + esc(opts.title) : ''),
      cancelLabel: 'סגירה',
      bodyHTML:
        '<div id="cmtList"></div>' +
        '<div class="form-grid" style="margin-top:8px">' +
          '<label class="fld"><span>תאריך</span><input class="inp mb0" id="cmtDate" type="date" value="' + today() + '"></label>' +
          '<label class="fld fld-wide"><span>עדכון חדש</span><textarea class="inp mb0 ta-auto" id="cmtNote" rows="2" placeholder="למשל: דיברתי עם ההורים, הם יודעים"></textarea></label>' +
        '</div>' +
        '<button class="btn-primary sm" id="cmtAdd" type="button" style="margin-top:4px"><i class="bi bi-plus-lg"></i> הוספת עדכון</button>',
    });
    const body = m.el.querySelector('.modal-body');
    const notify = () => { if (opts.onChange) { try { opts.onChange(list.length); } catch (_) {} } };
    function draw() {
      const host = body.querySelector('#cmtList');
      host.innerHTML = list.length ? list.map(commentRowHtml).join('')
        : '<div class="tl-note" style="padding:6px 2px">אין עדכונים עדיין</div>';
      host.querySelectorAll('[data-cmtdel]').forEach(b => b.addEventListener('click', async () => {
        if (!(await window.UI.confirm('למחוק את העדכון?'))) return;
        const r = await delComment(Number(b.dataset.cmtdel));
        if (!r || r.ok === false) { window.UI.toast('המחיקה נכשלה', 'err'); return; }
        list = list.filter(c => c.id != b.dataset.cmtdel);
        draw(); notify(); window.UI.toast('נמחק');
      }));
    }
    draw();
    body.querySelector('#cmtAdd').addEventListener('click', async () => {
      const note = body.querySelector('#cmtNote').value.trim();
      if (!note) { window.UI.toast('כתוב עדכון', 'err'); return; }
      const row = { comment_date: body.querySelector('#cmtDate').value || today(), note };
      const r = await addComment(ev.id, row);
      if (!r || r.ok === false) { window.UI.toast('השמירה נכשלה', 'err'); return; }
      list = list.concat([(r.data && r.data[0]) || Object.assign({ id: Date.now(), event_id: ev.id }, row)]);
      body.querySelector('#cmtNote').value = '';
      draw(); notify(); window.UI.toast('העדכון נוסף');
    });
  }
  window.cv3Behavior = {
    open: openEventForm, remove: removeEvent, comments: openComments, toggleFollowup: toggleFollowup,
    renderFollowupWidget: (container, opts) => renderFollowupWidget(container, opts),
    commentCounts: commentCounts,
    patternCard: patternCard, quickForm: quickForm, saveQuick: saveQuick, types: types, typeLabel: typeLabel, statusChip: statusChip, typeName: typeName,
  };

  async function renderBehavior(page) {
    const [studs, cs, evs, cls, allCmtsInit, ts] = await Promise.all([students(), cats(), events(), classes(), allComments(), types()]);
    // let, לא const: אחרי הוספת/מחיקת תגובה מרעננים את שתיהן מהשרת (ראה
    // data-cmt למטה) כדי שתת-הדיווח המקונן יציג את התוכן העדכני, לא רק מונה.
    let allCmts = allCmtsInit;
    let cmtCounts = commentCounts(allCmts);
    if (window.Author) await window.Author.load();
    const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
    const catOf = id => { const c = cs.find(x => x.id == id); return c ? c.name : ''; };
    const clsOf = sid => { const s = studs.find(x => x.id == sid); const c = s && cls.find(x => x.id == s.class_id); return c ? c.name : 'ללא כיתה'; };
    const pickFilter = await window.cv3Picker.html('f', { placeholder: 'כל התלמידים' });
    const typeFilterOpts = ts.map(t => '<option value="' + t.id + '">' + esc(t.icon + ' ' + t.name) + '</option>').join('') +
      '<option value="__none">לא מסווג (ישן)</option>';
    const typeOf = e => ts.find(t => t.id == e.type_id);
    const authorName = uid => (window.Author ? window.Author.name(uid) : (uid ? 'לא ידוע' : '—'));
    // מפתח יציב לסינון: המזהה עצמו, ו-'__none' למי שאין לו (רשומות ישנות)
    const authorKey = e => e.created_by || '__none';
    const byFilterOpts = [...new Map(evs.map(e => [authorKey(e), authorName(e.created_by)])).entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'he'))
      .map(([k, v]) => '<option value="' + esc(k) + '">' + esc(v) + '</option>').join('');
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>מעקב תלמידים</h2>' +
      '<div class="head-actions">' + (isAdmin() ? '<button class="btn-ghost sm" id="behBin"><i class="bi bi-trash3"></i> סל מחזור</button>' : '') +
        '<button class="btn-ghost sm" id="behCsv"><i class="bi bi-download"></i> ייצוא דוח CSV</button></div></div>' +
      (await voiceAlertHtml()) + (await weeklySummaryHtml()) +
      // בטלפון: הרשימה קודם, והטופס נפתח מכפתור קבוע בתחתית (beh-fab).
      '<div class="qr-card beh-quick" id="behQuick"><h3><i class="bi bi-lightning-charge"></i> דיווח חדש' +
        '<button type="button" class="mini beh-quick-x" id="behQuickX" title="סגירה"><i class="bi bi-x-lg"></i></button></h3>' +
        '<div id="behQuickForm"></div></div>' +
      '<button type="button" class="beh-fab" id="behFab"><i class="bi bi-plus-lg"></i> דיווח חדש</button>' +
      // "מי דיווח" — מי שרשם את הדיווח. הרשימה נבנית מהדיווחים עצמם ולא
      // מטבלת המשתמשים, כדי שיופיעו גם מי שכבר לא פעיל וגם "לא ידוע"
      // (רשומות מלפני שהמערכת התחילה לתעד מי רשם).
      '<div class="toolbar" style="grid-template-columns:1fr auto auto auto auto auto">' + pickFilter +
        '<select class="inp mb0" id="fCat" title="סוג"><option value="">כל הסוגים</option>' + typeFilterOpts + '</select>' +
        '<select class="inp mb0" id="fStatus" title="מצב"><option value="">כל המצבים</option><option value="active">פתוח / בטיפול</option>' +
          '<option value="closed">נסגר</option><option value="log">תיעוד בלבד</option><option value="positive">⭐ חיובי בלבד</option></select>' +
        '<select class="inp mb0" id="fBy" title="מי דיווח"><option value="">כל המדווחים</option>' + byFilterOpts + '</select>' +
        '<select class="inp mb0" id="fGroup" title="תצוגה לפי"><option value="">ללא קיבוץ</option><option value="student">לפי תלמיד</option><option value="class">לפי כיתה</option><option value="cat">לפי סוג</option><option value="by">לפי מי שרשם</option></select>' +
        '<span class="count-line" id="evCount" style="align-self:center"></span></div>' +
      // פילוח פעילות הצוות — למנהל ולמפקח. עונה על "מי מעדכן, כמה, ומה".
      (canSeeStats() ? '<div class="qr-card" id="byCard"><div class="card-h-row">' +
        '<h3 style="margin:0"><i class="bi bi-people"></i> מי מדווח — פילוח פעילות</h3>' +
        '<span class="tl-note" style="font-size:.78rem">לחיצה על שורה מסננת אליה</span></div>' +
        '<div id="byStats"></div></div>' : '') +
      '<div id="timeline"></div>' +
      '<div id="evEmpty" class="empty-state" hidden><i class="bi bi-clipboard-check"></i><div>אין דיווחים עדיין — השתמש בדיווח המהיר למעלה</div></div>';

    const fpick = window.cv3Picker.wire(page, 'f', () => draw());
    wireSmart(page);
    let list = evs;
    const filtered = () => {
      const f = fpick.value(), fc = page.querySelector('#fCat').value, fs = page.querySelector('#fStatus').value;
      const fb = (page.querySelector('#fBy') || {}).value || '';
      const st = e => e.status || (e.followup ? 'open' : 'log');
      return list.filter(e =>
        (!f || String(e.student_id) === f) &&
        (!fc || (fc === '__none' ? !e.type_id : String(e.type_id) === fc)) &&
        (!fs || (fs === 'active' ? ['open', 'in_progress'].includes(st(e)) : fs === 'positive' ? (typeOf(e) || {}).direction === 'positive' : st(e) === fs)) &&
        (!fb || authorKey(e) === fb));
    };
    // תגובות מוצגות כתת-דיווח מקונן ממש מתחת לדיווח, לא רק מאחורי הכפתור —
    // בקשת יוסף 09/09/2026, אותה תבנית כמו בכרטיס התלמיד (students.js).
    const cmtSub = e => {
      const cs = allCmts.filter(c => c.event_id == e.id).sort((a, b) => String(a.comment_date || '').localeCompare(String(b.comment_date || '')) || (a.id - b.id));
      if (!cs.length) return '';
      return '<div class="hr-subwrap">' + cs.map(c =>
        '<div class="det-item hr-subitem"><span class="di-main"><div class="tl-note hr-note">' + esc(c.note) + '</div></span>' +
        '<span class="di-meta">' + esc(hebDate(c.comment_date) || c.comment_date || '') +
        ' · ' + (window.Author ? window.Author.cell(c.created_by) : '') + '</span></div>').join('') + '</div>';
    };
    const itemHtml = e => {
      const cn = cmtCounts[e.id] || 0;
      return '<div class="tl-item"><span class="sev-dot ' + sevClass(e.severity) + '"></span>' +
      '<div class="tl-main"><strong class="pc-link" data-pc="' + e.student_id + '" title="כרטיס דפוסים">' + esc(nameOf(e.student_id)) + '</strong> · ' + typeLabel(ts, e, catOf(e.category_id)) +
      ' ' + statusChip(e) +
      (e.assignee && ['open', 'in_progress'].includes(e.status) ? ' <span class="chip off"><i class="bi bi-person-check"></i> למעקב של ' + esc(authorName(e.assignee)) + '</span>' : '') +
      (e.group_id ? ' <span class="chip off" title="דיווח משותף לכמה תלמידים"><i class="bi bi-people"></i> קבוצתי</span>' : '') +
      (e.due_date ? ' <span class="chip" style="' + (isOverdue(e)
          ? 'background:color-mix(in srgb,var(--danger) 15%,transparent);color:var(--danger)'
          : 'background:color-mix(in srgb,var(--muted) 16%,transparent);color:var(--muted)') + '">' +
        '<i class="bi bi-calendar' + (isOverdue(e) ? '-x' : '-event') + '"></i> ' + esc(hebDate(e.due_date) || e.due_date) +
        (isOverdue(e) ? ' · באיחור' : '') + '</span>' : '') +
      (e.note ? ' <span class="tl-note nt" title="לחיצה מציגה הכול">— ' + esc(e.note) + '</span>' : '') + '</div>' +
      '<div class="tl-meta">' + esc(hebDate(e.event_date) || e.event_date) + (e.event_time ? ' · ' + esc(e.event_time) : '') +
        ' · <i class="bi bi-person-badge"></i> ' + (window.Author ? window.Author.cell(e.created_by) : '') + '</div>' +
      '<button class="mini" data-follow="' + e.id + '" title="' + (e.followup ? 'הסרה מהמעקב' : 'סימון למעקב') + '"' + (e.followup ? ' style="color:' + flagColor(e.severity) + '"' : '') + '><i class="bi ' + (e.followup ? 'bi-flag-fill' : 'bi-flag') + '"></i></button>' +
      '<button class="mini" data-cmt="' + e.id + '" title="עדכוני מעקב"' + (cn ? ' style="width:auto;padding:0 8px"' : '') + '><i class="bi bi-chat-left-text"></i>' + (cn ? ' ' + cn : '') + '</button>' +
      // מלמד רואה את כל הדיווחים על התלמידים שלו אבל מתקן רק את שלו — ולכן
      // הכפתורים נגזרים מהרשומה, לא מהמסך.
      ((!window.Auth || !window.Auth.canEditRow || window.Auth.canEditRow(e))
        ? '<button class="mini" data-edit="' + e.id + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
          '<button class="mini danger" data-del="' + e.id + '" title="מחיקה"><i class="bi bi-trash"></i></button>'
        : '') + '</div>' + cmtSub(e);
    };
    const groupKey = (e, g) => g === 'student' ? nameOf(e.student_id) : g === 'class' ? clsOf(e.student_id)
      : g === 'by' ? (window.Author ? window.Author.name(e.created_by) : 'לא ידוע')
      : (typeOf(e) ? typeOf(e).icon + ' ' + typeOf(e).name : (catOf(e.category_id) || 'לא מסווג'));
    // ── פילוח פעילות הצוות ──────────────────────────────────────────────
    // "כמה כל אחד מעדכן ואיזה דברים" — לכן גם ספירה, גם התפלגות קטגוריות,
    // גם כמה תלמידים הוא נגע בהם, וגם מתי דיווח לאחרונה. נבנה תמיד על **כל**
    // הדיווחים ולא על הסינון הנוכחי, אחרת סינון למדווח אחד היה מציג אותו
    // כ-100% מהפעילות.
    function drawByStats() {
      const host = page.querySelector('#byStats');
      if (!host) return;
      const cur = (page.querySelector('#fBy') || {}).value || '';
      const by = {};
      list.forEach(e => {
        const k = authorKey(e);
        const b = by[k] = by[k] || { key: k, name: authorName(e.created_by), n: 0, cats: {}, studs: new Set(), last: '' };
        b.n++;
        const c = catOf(e.category_id) || 'ללא קטגוריה';
        b.cats[c] = (b.cats[c] || 0) + 1;
        if (e.student_id) b.studs.add(e.student_id);
        const d = String(e.event_date || '');
        if (d > b.last) b.last = d;
      });
      const arr = Object.values(by).sort((a, b) => b.n - a.n);
      const total = list.length || 1;
      if (!arr.length) { host.innerHTML = '<div class="tl-note" style="padding:8px">אין דיווחים</div>'; return; }
      host.innerHTML =
        '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>מי דיווח</th><th style="width:90px">דיווחים</th><th style="width:110px">חלק מהסה״כ</th>' +
        '<th style="width:90px">תלמידים</th><th>על מה דיווח</th><th style="width:120px">דיווח אחרון</th>' +
        '</tr></thead><tbody>' +
        arr.map(b => {
          const pct = Math.round((b.n / total) * 100);
          const top = Object.entries(b.cats).sort((x, y) => y[1] - x[1])
            .map(([c, n]) => '<span class="chip off" style="margin:1px">' + esc(c) + ' ' + n + '</span>').join('');
          return '<tr class="by-row' + (cur === b.key ? ' on' : '') + '" data-by="' + esc(b.key) + '">' +
            '<td><b>' + esc(b.name) + '</b></td>' +
            '<td><b>' + b.n + '</b></td>' +
            '<td><div class="by-bar"><span style="width:' + pct + '%"></span></div>' +
              '<span class="tl-note" style="font-size:.74rem">' + pct + '%</span></td>' +
            '<td>' + b.studs.size + '</td>' +
            '<td>' + top + '</td>' +
            '<td>' + esc(hebDate(b.last) || b.last || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      host.querySelectorAll('.by-row').forEach(tr => tr.addEventListener('click', () => {
        const sel = page.querySelector('#fBy');
        sel.value = sel.value === tr.dataset.by ? '' : tr.dataset.by;   // לחיצה שנייה מבטלת
        draw();
      }));
    }

    function draw() {
      const rows = filtered();
      drawByStats();
      const g = page.querySelector('#fGroup').value;
      if (!g) {
        page.querySelector('#timeline').innerHTML = rows.map(itemHtml).join('');
      } else {
        const groups = {};
        rows.forEach(e => { const k = groupKey(e, g); (groups[k] = groups[k] || []).push(e); });
        page.querySelector('#timeline').innerHTML = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'he'))
          .map(k => '<div class="group-sec"><h4 class="group-title" style="margin:14px 2px 6px;font-size:.95rem;color:var(--primary-dark)">' +
            esc(k) + ' <span style="color:var(--muted);font-weight:400">(' + groups[k].length + ')</span></h4>' +
            groups[k].map(itemHtml).join('') + '</div>').join('');
      }
      page.querySelector('#evCount').textContent = rows.length + ' דיווחים';
      page.querySelector('#evEmpty').hidden = rows.length > 0;
      page.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const ok = await window.UI.confirm('להעביר את הדיווח לסל המחזור? (מנהל יכול לשחזר במשך 30 יום)'); if (!ok) return;
        const r = await delEvent(Number(b.dataset.del));
        if (r && r.ok === false) { window.UI.toast(friendlyErr(r.error), 'err'); return; }
        list = list.filter(e => e.id != b.dataset.del); draw(); window.UI.toast('הועבר לסל המחזור');
      }));
      page.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
        const ev = list.find(x => x.id == b.dataset.edit); if (ev) editEvent(ev);
      }));
      page.querySelectorAll('[data-follow]').forEach(b => b.addEventListener('click', async () => {
        const ev = list.find(x => x.id == b.dataset.follow); if (!ev) return;
        const r = await toggleFollowup(ev);
        if (!r || r.ok === false) { window.UI.toast('העדכון נכשל', 'err'); return; }
        draw(); window.UI.toast(ev.followup ? 'סומן למעקב' : 'הוסר מהמעקב');
      }));
      page.querySelectorAll('[data-cmt]').forEach(b => b.addEventListener('click', () => {
        const ev = list.find(x => x.id == b.dataset.cmt); if (!ev) return;
        window.cv3Behavior.comments(ev, {
          title: nameOf(ev.student_id),
          // מרעננים את הרשימה המלאה, לא רק את המונה — אחרת תת-הדיווח החדש
          // שנוסף לא יופיע עד רענון מלא של הדף.
          onChange: async () => { allCmts = await allComments(); cmtCounts = commentCounts(allCmts); draw(); },
        });
      }));
    }
    // עטיפה דקה סביב הטופס המשותף — אותו מסלול בדיוק כמו מהבית ומכרטיס
    // התלמיד, כדי שלא יהיו שני מסלולים שונים לאותו נתון.
    function editEvent(ev) { openEventForm(ev, { onSaved: () => draw() }); }

    // הערה ארוכה מקוצרת לשתי שורות (בטלפון); לחיצה פותחת/סוגרת.
    page.querySelector('#timeline').addEventListener('click', ev => {
      const n = ev.target.closest('.nt'); if (n) n.classList.toggle('full');
    });
    page.querySelector('#fCat').addEventListener('change', draw);
    page.querySelector('#fStatus').addEventListener('change', draw);
    const binBtn = page.querySelector('#behBin');
    if (binBtn) binBtn.addEventListener('click', () => openTrash({ onChange: async () => { list = await events(); draw(); } }));
    const fByEl = page.querySelector('#fBy'); if (fByEl) fByEl.addEventListener('change', draw);
    page.querySelector('#fGroup').addEventListener('change', draw);
    page.querySelector('#behCsv').addEventListener('click', () => {
      const head = ['תלמיד', 'סוג', 'חומרה', 'מצב', 'למעקב של', 'תאריך', 'שעה', 'הערה', 'נרשם ע"י', 'תפקיד'];
      const lines = [head.join(',')].concat(filtered().map(e =>
        [nameOf(e.student_id), typeOf(e) ? typeOf(e).name : catOf(e.category_id), e.severity || '', STATUS[e.status] || '',
         e.assignee ? authorName(e.assignee) : '', e.event_date, e.event_time || '', e.note || '',
         window.Author ? window.Author.name(e.created_by) : '',
         window.Author ? window.Author.role(e.created_by) : '']
          .map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'behavior_report.csv'; a.click();
    });
    const quickCard = page.querySelector('#behQuick');
    const openQuick = on => { quickCard.classList.toggle('open', on); if (on) quickCard.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    page.querySelector('#behFab').addEventListener('click', () => openQuick(true));
    page.querySelector('#behQuickX').addEventListener('click', () => openQuick(false));
    await quickForm(page.querySelector('#behQuickForm'), 'q', {
      onSaved: rows => { list = rows.concat(list); openQuick(false); draw(); },
    });
    draw();
  }

  // ── לוח המעקב (גרסה 2, 19/10/2026) ──────────────────────────────────
  // במקום רשימה אחת שרק מתארכת: ארבעה טורים — פתוח / בטיפול / ממתין לדיווח קולי
  // (מנהל) / נסגר השבוע. לכל כרטיס אחראי, גיל ותאריך בדיקה; צבע הפס = חומרה.
  // מלמד/מחנך רואה כברירת מחדל רק מה ששלו (אחראי או רושם); מנהל ומפקח — הכול.
  async function renderFollowup(page) {
    const [studs, evs, cls, allCmts0, ts] = await Promise.all([students(), events(), classes(), allComments(), types()]);
    let allCmts = allCmts0;
    if (window.Author) await window.Author.load();
    const me = window.currentUser && window.currentUser.id;
    const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
    const clsOf = sid => { const s = studs.find(x => x.id == sid); const c = s && cls.find(x => x.id == s.class_id); return c ? c.name : ''; };
    const cmtsOf = id => allCmts.filter(c => c.event_id == id)
      .sort((a, b) => String(a.comment_date || '').localeCompare(String(b.comment_date || '')) || (a.id - b.id));
    const st = e => e.status || (e.followup ? 'open' : 'log');
    const STALE = 21;
    const lastTouch = e => { const c = cmtsOf(e.id); return c.length ? c[c.length - 1].comment_date : e.event_date; };
    const isStale = e => !isOverdue(e) && !(e.due_date && e.due_date >= today()) && (daysSince(lastTouch(e)) || 0) >= STALE;
    const byUrgency = (a, b) => byDueDate(a, b) || String(a.event_date || '').localeCompare(String(b.event_date || ''));
    const weekAgo = Date.now() - 7 * 86400000;
    let list = evs.filter(e => ['open', 'in_progress'].includes(st(e)) || (st(e) === 'closed' && e.closed_at && Date.parse(e.closed_at) > weekAgo));
    let mineOnly = !canSeeStats();
    let voice = [];
    if (isAdmin() && !DEMO && window.db && !window.db.DEMO) {
      try { const r = await window.db.list('voice_reports', { eq: { status: 'draft' }, order: 'created_at', asc: true }); voice = (r && r.ok && r.data) || []; } catch (_) {}
    }

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
        '<h2><i class="bi bi-flag-fill" style="color:var(--danger)"></i> לוח המעקב</h2>' +
      '<div class="head-actions"><label class="fu-mine"><input type="checkbox" id="fuMine"' + (mineOnly ? ' checked' : '') + '> רק שלי</label>' +
        '<span class="count-line" id="fuCount"></span></div></div>' +
      '<div id="fuHint"></div><div class="fu-board" id="fuBoard"></div>';

    function card(e) {
      const s = st(e), cm = cmtsOf(e.id), over = isOverdue(e);
      const canEdit = !window.Auth || !window.Auth.canEditRow || window.Auth.canEditRow(e) || e.assignee === me;
      const summary = s === 'closed' ? (cm.slice().reverse().find(c => /^סיכום סגירה:/.test(c.note || '')) || {}).note : null;
      return '<div class="fu-card" style="border-inline-start-color:' + flagColor(e.severity) + '">' +
        '<div class="fu-c-head"><b class="pc-link" data-pc="' + e.student_id + '" title="כרטיס דפוסים">' + esc(nameOf(e.student_id)) + '</b><span class="tl-note">' + esc(clsOf(e.student_id)) + '</span></div>' +
        '<div class="fu-c-type">' + typeLabel(ts, e, '') + ' <span class="sev-dot ' + sevClass(e.severity) + '" title="חומרה: ' + esc(e.severity || '') + '"></span> <span class="tl-note">' + esc(e.severity || '') + '</span></div>' +
        (e.note ? '<div class="tl-note nt fu-c-note">' + esc(e.note) + '</div>' : '') +
        '<div class="fu-age">' +
          (e.assignee ? '<span class="chip off"><i class="bi bi-person-check"></i> ' + esc(window.Author ? window.Author.name(e.assignee) : '') + '</span>' : '') +
          (s === 'closed' ? '' : '<span class="chip off"><i class="bi bi-hourglass-split"></i> ' + (daysSince(e.event_date) ? 'פתוח ' + ageTxt(daysSince(e.event_date)) : 'נפתח היום') + '</span>') +
          (cm.length ? '<span class="chip off"><i class="bi bi-chat-left-text"></i> ' + cm.length + '</span>' : '') +
          (isStale(e) && s !== 'closed' ? '<span class="chip warn"><i class="bi bi-moon"></i> שקט ' + ageTxt(daysSince(lastTouch(e))) + '</span>' : '') +
        '</div>' +
        (s === 'closed'
          ? (summary ? '<div class="fu-sum">"' + esc(summary.replace(/^סיכום סגירה:\s*/, '')) + '"</div>' : '')
          : '<div class="fu-c-due"><i class="bi bi-alarm"></i> בדיקה: ' +
              (canEdit ? '<input class="inp mb0" data-duedate="' + e.id + '" type="date" max="2099-12-31" value="' + esc(e.due_date || '') + '">'
                       : esc(hebDate(e.due_date) || e.due_date || '—')) +
              (over ? ' <b class="fu-over"><i class="bi bi-exclamation-triangle-fill"></i> באיחור</b>' : '') + '</div>' +
            '<div class="fu-c-act">' +
              (s === 'open' && canEdit ? '<button class="btn-ghost sm" data-prog="' + e.id + '"><i class="bi bi-play-circle"></i> בטיפול</button>' : '') +
              '<button class="btn-ghost sm" data-cm="' + e.id + '"><i class="bi bi-chat-left-text"></i> עדכון</button>' +
              (canEdit ? '<button class="btn-ghost sm" data-resolve="' + e.id + '"><i class="bi bi-check2-circle"></i> סגירה</button>' : '') +
            '</div>') +
      '</div>';
    }
    const voiceCard = v => '<div class="fu-card fu-voice">' +
      '<div class="fu-c-head"><b><i class="bi bi-mic-fill"></i> ' + esc(v.teacher_name || 'טיוטה מהקו') + '</b><span class="tl-note">' +
        esc(ageTxt(daysSince(v.created_at) || 0)) + '</span></div>' +
      (v.report_text || v.transcript ? '<div class="tl-note nt fu-c-note">' + esc(v.report_text || v.transcript) + '</div>' : '') +
      '<div class="fu-c-act"><a class="btn-ghost sm" href="#voicereports"><i class="bi bi-check2"></i> לאישור</a></div></div>';

    function draw() {
      const vis = list.filter(e => !mineOnly || e.assignee === me || e.created_by === me);
      const col = (key, title, icon, items, html) => '<section class="fu-col fu-col-' + key + '"><h3><i class="bi ' + icon + '"></i> ' + title +
        ' <span class="fu-n">' + items.length + '</span></h3>' + (items.length ? items.map(html).join('') : '<div class="tl-note fu-empty">אין</div>') + '</section>';
      const open = vis.filter(e => st(e) === 'open').sort(byUrgency), prog = vis.filter(e => st(e) === 'in_progress').sort(byUrgency);
      const closed = vis.filter(e => st(e) === 'closed').sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)));
      page.querySelector('#fuBoard').innerHTML =
        col('open', 'פתוח', 'bi-flag', open, card) + col('prog', 'בטיפול', 'bi-play-circle', prog, card) +
        (isAdmin() ? col('voice', 'ממתין לדיווח קולי', 'bi-mic', voice, voiceCard) : '') +
        col('closed', 'נסגר השבוע', 'bi-check2-circle', closed, card);
      const active = open.concat(prog), overdueN = active.filter(isOverdue).length, staleN = active.filter(isStale).length;
      page.querySelector('#fuCount').textContent = active.length + ' פתוחים' + (overdueN ? ' · ' + overdueN + ' באיחור' : '') +
        (mineOnly ? ' (שלי, מתוך ' + list.filter(e => st(e) !== 'closed').length + ')' : '');
      page.querySelector('#fuHint').innerHTML = staleN
        ? '<div class="fu-hint"><i class="bi bi-moon"></i> ' + staleN + ' מקרים לא זזו ' + STALE + ' יום ויותר. לכל אחד: עדכון, תאריך בדיקה או סגירה עם משפט סיכום.</div>' : '';
    }
    page.querySelector('#fuMine').addEventListener('change', ev => { mineOnly = ev.target.checked; draw(); });
    wireSmart(page);
    page.querySelector('#fuBoard').addEventListener('click', async ev => {
      const nt = ev.target.closest('.nt'); if (nt) { nt.classList.toggle('full'); return; }
      const b = ev.target.closest('[data-prog],[data-cm],[data-resolve]'); if (!b) return;
      const e = list.find(x => x.id == (b.dataset.prog || b.dataset.cm || b.dataset.resolve)); if (!e) return;
      if (b.dataset.prog) {
        const r = await updEvent(e.id, { status: 'in_progress' });
        if (!r || r.ok === false) { window.UI.toast(friendlyErr(r && r.error), 'err'); return; }
        e.status = 'in_progress'; draw(); window.UI.toast('סומן "בטיפול"');
      } else if (b.dataset.cm) {
        openComments(e, { title: nameOf(e.student_id), onChange: async () => { allCmts = await allComments(); draw(); } });
      } else if (await resolveWithSummary(e, nameOf(e.student_id))) {
        allCmts = await allComments(); draw();
      }
    });
    page.querySelector('#fuBoard').addEventListener('change', async ev => {
      const inp = ev.target.closest('[data-duedate]'); if (!inp) return;
      const e = list.find(x => x.id == inp.dataset.duedate); if (!e) return;
      const r = await updEvent(e.id, { due_date: inp.value || null });
      if (!r || r.ok === false) { window.UI.toast(friendlyErr(r && r.error), 'err'); return; }
      e.due_date = inp.value || null; draw(); window.UI.toast('תאריך הבדיקה עודכן');
    });
    draw();
  }

  // חלונית קומפקטית לדף הבית (בקשת יוסף 04/09/2026 — לא רק לשונית/עמוד
  // שדורש ניווט, אלא משהו שרואים ישר בבית, לכל המשתמשים: גם דף הבית של
  // המנהל/משרד (js/app.js) וגם דף הבית הפשוט של הרב/מחנך (js/teacher.js).
  // אותה scope בדיוק כמו renderFollowup (events() כבר מסנן לפי accessibleIds).
  //
  // opts.onChange: קריאה חוזרת אחרי שינוי (טופל/תגובה) — כדי שדף שמראה גם
  // רשימה אחרת של אותם דיווחים (renderHomeReports) יתעדכן איתה, לא רק החלונית.
  //
  // widgetSeq (per-container): שני renderFollowupWidget חופפים על אותו container
  // אפשריים הלכה למעשה (ניווט מהיר הביתה שוב לפני שהקודם סיים) — בלי השמירה
  // הזו הרינדור האיטי-יותר עלול "לנצח" ולדרוס תוצאה טרייה יותר בשקט.
  const widgetSeq = new WeakMap();
  async function renderFollowupWidget(container, opts) {
    if (!container) return;
    opts = opts || {};
    // לא ממתינים (fire-and-forget) — לא צריך לעכב את ציור החלונית בשביל זה,
    // וה-localStorage guard הפנימי דואג שזה לא יריץ פעמיים ביום בלי צורך.
    maybeShowDuePopup();
    const seq = (widgetSeq.get(container) || 0) + 1;
    widgetSeq.set(container, seq);
    const stale = () => widgetSeq.get(container) !== seq;
    const [evs, voice0, notif] = await Promise.all([events(), voiceAlertHtml(), notificationsHtml()]);
    // ביום ראשון: קישור לסיכום השבועי (מנהל ומפקח)
    const voice = notif + voice0 + (canSeeStats() && new Date().getDay() === 0
      ? '<a class="voice-alert ws-link" href="#behavior"><i class="bi bi-calendar-week"></i><span><b>הסיכום השבועי מוכן</b><small>במסך המעקב</small></span><span class="va-go">לסיכום ←</span></a>' : '');
    wireSmart(container, () => renderFollowupWidget(container, opts));
    if (stale()) return;
    // הבית מציג רק מה ששלך (אחראי או רושם); מנהל ומפקח רואים הכול
    const me = window.currentUser && window.currentUser.id;
    const allOpen = evs.filter(e => e.followup);
    const list = (canSeeStats() ? allOpen : allOpen.filter(e => e.assignee === me || e.created_by === me)).sort(byDueDate);
    if (window.Author) await window.Author.load();
    if (stale()) return;
    if (!list.length) {
      container.innerHTML = voice +
        '<div class="qr-card"><h3 style="margin:0 0 6px"><i class="bi bi-flag-fill" style="color:var(--danger)"></i> מעקב דחוף</h3>' +
        '<div class="tl-note" style="padding:4px 2px"><i class="bi bi-emoji-smile"></i> אין כרגע דיווחים במעקב</div></div>';
      return;
    }
    const [studs, cs] = await Promise.all([students(), cats()]);
    if (stale()) return;
    const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
    const catOf = id => { const c = cs.find(x => x.id == id); return c ? c.name : ''; };
    const overdueN = list.filter(isOverdue).length;
    container.innerHTML = voice +
      '<div class="qr-card">' +
        '<div class="card-h-row"><h3 style="margin:0"><i class="bi bi-flag-fill" style="color:var(--danger)"></i> מעקב דחוף</h3>' +
          '<span class="chip" style="' + (overdueN
            ? 'background:color-mix(in srgb,var(--danger) 15%,transparent);color:var(--danger)'
            : 'background:color-mix(in srgb,var(--muted) 16%,transparent);color:var(--muted)') + '">' +
            list.length + (overdueN ? ' · ' + overdueN + ' באיחור' : '') + (list.length < allOpen.length ? ' (מתוך ' + allOpen.length + ')' : '') + '</span></div>' +
        list.map(e => {
          const over = isOverdue(e);
          return '<div class="fu-widget-item" style="border-right:3px solid ' + flagColor(e.severity) + '">' +
            '<div class="fu-w-head"><i class="bi bi-flag-fill" style="color:' + flagColor(e.severity) + '"></i> <span>' + esc(nameOf(e.student_id)) + '</span>' +
              (e.due_date ? '<span style="font-size:.74rem;' + (over ? 'color:var(--danger);font-weight:700' : 'color:var(--muted)') + '">' +
                '<i class="bi bi-calendar' + (over ? '-x' : '-event') + '"></i> ' + esc(hebDate(e.due_date) || e.due_date) + '</span>' : '') +
            '</div>' +
            '<div class="fu-w-meta">' + esc(catOf(e.category_id)) + (e.note ? ' — ' + esc(e.note) : '') + '</div>' +
            (e.event_date ? '<div class="fu-w-meta" style="opacity:.7"><i class="bi bi-clock-history"></i> דווח ' +
              esc(hebDate(e.event_date) || e.event_date) + (relDay(e.event_date) ? ' · ' + esc(relDay(e.event_date)) : '') + '</div>' : '') +
            '<div style="display:flex;gap:4px;margin-top:5px">' +
              '<button class="btn-ghost sm" data-wcmt="' + e.id + '" style="padding:2px 8px;font-size:.76rem"><i class="bi bi-chat-left-text"></i> תגובה</button>' +
              '<button class="btn-ghost sm" data-wres="' + e.id + '" style="padding:2px 8px;font-size:.76rem"><i class="bi bi-check2-circle"></i> סגירה</button>' +
            '</div>' +
          '</div>';
        }).join('') +
        '<div style="text-align:center;margin-top:8px"><a href="#followup" class="btn-ghost sm">ללוח המעקב ←</a></div>' +
      '</div>';
    container.querySelectorAll('[data-wcmt]').forEach(b => b.addEventListener('click', () => {
      const ev = list.find(x => x.id == b.dataset.wcmt); if (!ev) return;
      openComments(ev, {
        title: nameOf(ev.student_id),
        onChange: () => { renderFollowupWidget(container, opts); if (opts.onChange) opts.onChange(); },
      });
    }));
    container.querySelectorAll('[data-wres]').forEach(b => b.addEventListener('click', async () => {
      const ev = list.find(x => x.id == b.dataset.wres); if (!ev) return;
      if (!(await resolveWithSummary(ev, nameOf(ev.student_id)))) return;
      renderFollowupWidget(container, opts);
      if (opts.onChange) opts.onChange();
    }));
  }

  // מחולל דף-לוג פשוט לקריאה/כתיבה (רמה + תאריך + הערה לתלמיד)
  function makeLog(table, title, icon) {
    return async function (page) {
      const uid = table;   // סיומת ייחודית ל-id-ים (מונע כפילות DOM בין קריאה/כתיבה)
      const studs = await students();
      const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
      const pickHtml = await window.cv3Picker.html('l');
      page.innerHTML =
        '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>' + title + '</h2></div>' +
        '<div class="qr-card"><h3><i class="bi ' + icon + '"></i> רישום חדש</h3><div class="qr-grid">' +
          pickHtml +
          '<input class="inp mb0" id="lLevel-' + uid + '" placeholder="רמה / הישג">' +
          '<textarea class="inp mb0 ta-auto" id="lNote-' + uid + '" rows="2" placeholder="הערה (רשות)"></textarea>' +
          '<button class="btn-primary sm" id="lSave-' + uid + '"><i class="bi bi-plus-lg"></i> הוסף</button>' +
        '</div></div><div id="logList-' + uid + '"></div>' +
        '<div id="logEmpty-' + uid + '" class="empty-state" hidden><i class="bi ' + icon + '"></i><div>אין רישומים עדיין</div></div>';
      const pick = window.cv3Picker.wire(page, 'l');
      if (window.Author) await window.Author.load();
      let data = await window.store.list(table);
      const _ids = window.cv3Students ? await window.cv3Students.accessibleIds() : null;
      if (_ids) data = data.filter(x => _ids.includes(x.student_id));
      function draw() {
        page.querySelector('#logList-' + uid).innerHTML = data.slice().reverse().map(x =>
          '<div class="tl-item"><span class="sev-dot mid"></span><div class="tl-main"><strong>' + esc(nameOf(x.student_id)) + '</strong> · ' + esc(x.level) +
          (x.note ? ' <span class="tl-note">— ' + esc(x.note) + '</span>' : '') + '</div><div class="tl-meta">' + esc(x.date) +
          ' · <i class="bi bi-person-badge"></i> ' + (window.Author ? window.Author.cell(x.created_by) : '') +
          '</div></div>').join('');
        page.querySelector('#logEmpty-' + uid).hidden = data.length > 0;
      }
      page.querySelector('#lSave-' + uid).addEventListener('click', async () => {
        const sid = pick.value(); if (!sid) { window.UI.toast('בחר תלמיד', 'err'); return; }
        const row = { student_id: Number(sid), level: page.querySelector('#lLevel-' + uid).value.trim(), note: page.querySelector('#lNote-' + uid).value.trim(), date: today() };
        const r = await window.store.add(table, row);
        data = data.concat([(r.data && r.data[0]) || row]);
        page.querySelector('#lLevel-' + uid).value = ''; page.querySelector('#lNote-' + uid).value = '';
        draw(); window.UI.toast('נוסף');
      });
      draw();
    };
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.behavior = renderBehavior;
  window.PAGE_RENDERERS.followup = renderFollowup;
  window.PAGE_RENDERERS.reading = makeLog('reading', 'קידום קריאה', 'bi-book');
  window.PAGE_RENDERERS.writing = makeLog('writing', 'מעקב כתיבה', 'bi-pencil-square');
})();
