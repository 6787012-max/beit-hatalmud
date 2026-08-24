// tla.js — תל"א: תכנית לימודים אישית (2026-08-19).
// משחזר את התבנית הרשמית של המכינה (7 עמודים): שער · מערכת שעות אישית ·
// תיעוד ישיבות צוות · תיעוד שיחות הורים · דף הכנה (פרופיל) · תכנית היעדים.
// הכל ניתן לעריכה: תחומים, יעדים, בעלי תפקיד, חודשים ומשבצות שעות.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isAdmin = () => !!(window.currentUser && window.currentUser.role === 'מנהל');
  const pad = n => (n < 10 ? '0' : '') + n;
  const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  // ברשומות המיובאות name הוא כבר שם מלא — לא לשרשר את family פעמיים
  const dmy = iso => {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso);
  };
  const fullName = s => window.UI.fullName(s);

  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
  const HEB_MONTHS = ['תשרי', 'חשון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר א׳', 'אדר ב׳', 'ניסן', 'אייר', 'סיון', 'תמוז', 'אב', 'אלול'];
  // ברירת מחדל לפי התבנית של המכינה — ניתן לשנות/להוסיף/למחוק בכל תכנית
  const DEFAULT_SLOTS = [
    { from: '10:00', to: '10:50' }, { from: '11:20', to: '12:00' },
    { from: '12:30', to: '13:00' }, { from: '14:15', to: '14:55' }, { from: '15:30', to: '16:00' },
  ];
  const HL = [
    { v: '', label: 'רגיל', color: '' },
    { v: 'green', label: 'שיפור אסטרטגיות למידה', color: '#c9e7c0' },
    { v: 'pink', label: 'פיתוח מיומנויות', color: '#e8a8d8' },
    { v: 'orange', label: 'קריאה / לימוד יחידני', color: '#f5c199' },
    { v: 'blue', label: 'טיפול רגשי', color: '#a9c8e8' },
  ];
  const hlColor = v => (HL.find(h => h.v === v) || HL[0]).color;
  const DEFAULT_ROLES = ['מנהל חינוכי', 'מורה פרטי', 'מחנך'];
  // רשימת אנשי הצוות לבחירה בעמודות "הזדמנויות עבודה". מגיעה מ-RPC שמחזיר
  // שמות ותפקיד בלבד — טבלת staff עצמה נעולה למנהל (ת"ז ופרטי בנק).
  let _staffCache = null;
  async function staffNames() {
    if (_staffCache) return _staffCache;
    try {
      const { data, error } = await window.sb.rpc('staff_names');
      _staffCache = error ? [] : (data || []);
    } catch (_) { _staffCache = []; }
    return _staffCache;
  }
  const goalsArr = g => Array.isArray(g && g.goals_list) ? g.goals_list.filter(x => String(x || '').trim()) : [];
  // סדר עמודות הצוות נשמר במערך `opps` — ב-jsonb סדר מפתחות של אובייקט אובד,
  // ולכן `roles` הישן משמש רק כנפילה אחורה לרשומות שטרם הוגרו.
  function oppsArr(g) {
    if (Array.isArray(g && g.opps) && g.opps.length) {
      return g.opps.filter(o => o && String(o.who || '').trim()).map(o => ({ who: String(o.who).trim(), what: String(o.what || '').trim() }));
    }
    const r = (g && g.roles && typeof g.roles === 'object') ? g.roles : {};
    return roleKeysOf(r).map(k => ({ who: k, what: r[k] }));
  }
  const STATUSES = ['טיוטה', 'פעילה', 'הסתיימה'];

  // Intl מחזיר את השנה העברית כמספר (5786) — ממירים לגימטריה (תשפ"ו)
  function gematria(n) {
    const H = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'],
      [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
    let out = '';
    n = n % 1000;                       // 5786 → 786
    if (n === 15) return 'ט"ו';
    if (n === 16) return 'ט"ז';
    for (const [v, ch] of H) while (n >= v) { out += ch; n -= v; }
    return out.length > 1 ? out.slice(0, -1) + '"' + out.slice(-1) : out + "'";
  }
  function acadYear() {
    try {
      const y = new Intl.DateTimeFormat('en-u-ca-hebrew', { year: 'numeric' }).format(new Date());
      const n = parseInt(String(y).replace(/\D/g, ''), 10);
      return n ? gematria(n) : '';
    } catch (_) { return ''; }
  }

  // ───────────────────────── נתונים ─────────────────────────
  const S = window.store;
  async function allPlans() { return (await S.list('tla_plans')) || []; }
  async function planById(id) { return (await allPlans()).find(p => p.id == id) || null; }
  async function goalsOf(pid) {
    const l = (await S.list('tla_goals', { eq: { plan_id: pid } })) || [];
    return l.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
  }
  async function meetingsOf(pid, kind) {
    const l = (await S.list('tla_meetings', { eq: { plan_id: pid } })) || [];
    return l.filter(m => !kind || m.kind === kind)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
  }
  async function scheduleOf(pid) { return (await S.list('tla_schedule', { eq: { plan_id: pid } })) || []; }
  async function templates() { return (await S.list('tla_class_templates')) || []; }
  const slotsOf = p => (Array.isArray(p.slots) && p.slots.length ? p.slots : DEFAULT_SLOTS);
  const profOf = p => (p.profile && typeof p.profile === 'object' ? p.profile : {});

  async function savePlan(id, patch) {
    const r = await S.update('tla_plans', id, Object.assign({}, patch, { updated_at: new Date().toISOString() }));
    if (!r.ok) { window.UI.toast('שמירה נכשלה: ' + (r.error || ''), 'err'); return false; }
    return true;
  }

  // ───────────────────────── מסך רשימה ─────────────────────────
  async function renderPage(page) {
    const [plans, studs, cls] = await Promise.all([
      allPlans(),
      window.cv3Students ? window.cv3Students.getStudents() : [],
      window.cv3Students ? window.cv3Students.getClasses() : [],
    ]);
    const stOf = id => studs.find(x => x.id == id);
    const clsName = cid => { const c = cls.find(x => x.id == cid); return c ? c.name : ''; };

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
      '<h2>תל"א — תכנית לימודים אישית</h2>' +
      '<div class="head-actions"><button class="btn-primary sm" id="tlaNew"><i class="bi bi-plus-lg"></i> תל"א חדש</button></div></div>' +
      '<div class="toolbar" style="grid-template-columns:1fr auto auto">' +
        '<input class="inp mb0" id="tlaQ" placeholder="חיפוש תלמיד…">' +
        '<select class="inp mb0" id="tlaStat"><option value="">כל הסטטוסים</option>' +
          STATUSES.map(s => '<option>' + esc(s) + '</option>').join('') + '</select>' +
        '<span class="count-line" id="tlaCount" style="align-self:center"></span></div>' +
      '<div id="tlaList"></div>';

    function draw() {
      const q = (page.querySelector('#tlaQ').value || '').trim();
      const stf = page.querySelector('#tlaStat').value;
      // היה מיון לפי id יורד (סדר יצירה). ברשימת תל"אות מחפשים תלמיד — ולכן
      // ממיינים לפי שם משפחה, כמו בכל שאר המסכים.
      let rows = plans.slice().sort((a, b) => {
        const A = stOf(a.student_id) || {}, B = stOf(b.student_id) || {};
        return String(A.family || '').localeCompare(String(B.family || ''), 'he') ||
               String(A.name || '').localeCompare(String(B.name || ''), 'he') || b.id - a.id;
      });
      if (stf) rows = rows.filter(p => (p.status || 'טיוטה') === stf);
      if (q) rows = rows.filter(p => fullName(stOf(p.student_id)).indexOf(q) > -1);
      page.querySelector('#tlaCount').textContent = rows.length + ' תכניות';
      page.querySelector('#tlaList').innerHTML = rows.length
        ? '<table class="tbl"><thead><tr><th>תלמיד</th><th>כיתה</th><th>שנה"ל</th><th>מחנך</th><th>סטטוס</th><th></th></tr></thead><tbody>' +
          rows.map(p => {
            const s = stOf(p.student_id);
            return '<tr><td><strong>' + esc(fullName(s) || '—') + '</strong></td>' +
              '<td>' + esc(p.class_label || (s ? clsName(s.class_id) : '')) + '</td>' +
              '<td>' + esc(p.year_label || '') + '</td><td>' + esc(p.mentor || '') + '</td>' +
              '<td><span class="chip off">' + esc(p.status || 'טיוטה') + '</span></td>' +
              '<td style="white-space:nowrap">' +
                '<button class="btn-ghost sm" data-open="' + p.id + '"><i class="bi bi-pencil"></i> פתיחה</button> ' +
                '<button class="btn-ghost sm" data-print="' + p.id + '"><i class="bi bi-printer"></i></button> ' +
                (isAdmin() ? '<button class="btn-ghost sm danger" data-del="' + p.id + '"><i class="bi bi-trash"></i></button>' : '') +
              '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="empty-state"><i class="bi bi-journal-bookmark"></i><div>אין תכניות עדיין — הקש "תל"א חדש"</div></div>';

      page.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openEditor(page, +b.dataset.open)));
      page.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => printPlan(+b.dataset.print)));
      page.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        if (!await window.UI.confirm('למחוק את התל"א לצמיתות? כל היעדים, הישיבות והמערכת יימחקו.')) return;
        const r = await S.remove('tla_plans', +b.dataset.del);
        if (!r.ok) { window.UI.toast('מחיקה נכשלה', 'err'); return; }
        window.UI.toast('נמחק'); renderPage(page);
      }));
    }
    page.querySelector('#tlaQ').addEventListener('input', draw);
    page.querySelector('#tlaStat').addEventListener('change', draw);
    page.querySelector('#tlaNew').addEventListener('click', () => newPlanDialog(() => renderPage(page)));
    draw();
  }

  // ───────────────────────── יצירת תכנית ─────────────────────────
  async function newPlanDialog(onDone, preStudent) {
    const cls = window.cv3Students ? await window.cv3Students.getClasses() : [];
    const pick = preStudent ? '' : await window.cv3Picker.html('tla');
    const body =
      '<div class="form-grid">' +
      (preStudent
        ? '<label class="fld fld-wide"><span>תלמיד</span><input class="inp mb0" value="' + esc(fullName(preStudent)) + '" readonly></label>'
        : '<div class="fld fld-wide"><span>תלמיד</span>' + pick + '</div>') +
      '<label class="fld"><span>שנה"ל</span><input class="inp mb0" id="tp_year" value="' + esc(acadYear()) + '"></label>' +
      '<label class="fld"><span>כיתה</span><input class="inp mb0" id="tp_class" value="' +
        esc(preStudent ? ((cls.find(c => c.id == preStudent.class_id) || {}).name || '') : '') + '"></label>' +
      '<label class="fld"><span>מחנך</span><input class="inp mb0" id="tp_mentor"></label>' +
      '<label class="fld"><span>סטטוס</span><select class="inp mb0" id="tp_status">' +
        STATUSES.map(s => '<option>' + esc(s) + '</option>').join('') + '</select></label>' +
      '</div>';
    let sel = preStudent ? preStudent.id : null;
    const m = window.UI.modal({
      title: 'תל"א חדש', bodyHTML: body, saveLabel: 'יצירה',
      onSave: async (card) => {
        if (!sel) { window.UI.toast('נא לבחור תלמיד', 'err'); return false; }
        const row = {
          student_id: sel,
          year_label: card.querySelector('#tp_year').value.trim() || null,
          class_label: card.querySelector('#tp_class').value.trim() || null,
          mentor: card.querySelector('#tp_mentor').value.trim() || null,
          status: card.querySelector('#tp_status').value,
          profile: {}, slots: DEFAULT_SLOTS,
        };
        const r = await S.add('tla_plans', row);
        if (!r.ok) { window.UI.toast('שגיאה: ' + (r.error || ''), 'err'); return false; }
        window.UI.toast('נוצר תל"א'); if (onDone) onDone((r.data && r.data[0]) || null); return true;
      },
    });
    if (!preStudent) {
      const p = window.cv3Picker.wire(m.el, 'tla', id => { sel = id ? +id : null; });
      if (p && typeof p.value === 'function') { const v = p.value(); sel = v ? +v : null; }
    }
  }

  // ───────────────────────── עורך ─────────────────────────
  const TABS = [
    { id: 'profile', label: 'דף הכנה', icon: 'bi-person-lines-fill' },
    { id: 'goals', label: 'תכנית היעדים', icon: 'bi-bullseye' },
    { id: 'sched', label: 'מערכת שעות', icon: 'bi-table' },
    { id: 'team', label: 'ישיבות צוות', icon: 'bi-people' },
    { id: 'parents', label: 'שיחות הורים', icon: 'bi-telephone' },
  ];

  async function openEditor(page, planId, tab) {
    const plan = await planById(planId);
    if (!plan) { window.UI.toast('התכנית לא נמצאה', 'err'); return; }
    const studs = window.cv3Students ? await window.cv3Students.getStudents() : [];
    const stud = studs.find(s => s.id == plan.student_id) || {};
    tab = tab || 'profile';

    page.innerHTML =
      '<div class="page-head"><button class="back" id="tlaBack">→ חזרה לרשימה</button>' +
      '<h2>תל"א · ' + esc(fullName(stud)) + '</h2>' +
      '<div class="head-actions"><button class="btn-ghost sm" id="tlaPrint"><i class="bi bi-printer"></i> הדפסה / PDF</button></div></div>' +
      '<div class="qr-card"><div class="form-grid">' +
        '<label class="fld"><span>שנה"ל</span><input class="inp mb0" id="th_year" value="' + esc(plan.year_label || '') + '"></label>' +
        '<label class="fld"><span>כיתה</span><input class="inp mb0" id="th_class" value="' + esc(plan.class_label || '') + '"></label>' +
        '<label class="fld"><span>מחנך</span><input class="inp mb0" id="th_mentor" value="' + esc(plan.mentor || '') + '"></label>' +
        '<label class="fld"><span>סטטוס</span><select class="inp mb0" id="th_status">' +
          STATUSES.map(s => '<option' + ((plan.status || 'טיוטה') === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') +
        '</select></label>' +
      '</div></div>' +
      '<div class="tla-tabs">' + TABS.map(t =>
        '<button class="tla-tab' + (t.id === tab ? ' on' : '') + '" data-tab="' + t.id + '"><i class="bi ' + t.icon + '"></i> ' + esc(t.label) + '</button>').join('') + '</div>' +
      '<div id="tlaBody"></div>';

    page.querySelector('#tlaBack').addEventListener('click', () => renderPage(page));
    page.querySelector('#tlaPrint').addEventListener('click', () => printPlan(plan.id));
    const headMap = { th_year: 'year_label', th_class: 'class_label', th_mentor: 'mentor' };
    Object.keys(headMap).forEach(id => {
      const el = page.querySelector('#' + id);
      el.addEventListener('change', async () => {
        const v = el.value.trim() || null;
        if (await savePlan(plan.id, { [headMap[id]]: v })) plan[headMap[id]] = v;
      });
    });
    page.querySelector('#th_status').addEventListener('change', async e => {
      if (await savePlan(plan.id, { status: e.target.value })) plan.status = e.target.value;
    });
    page.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => openEditor(page, planId, b.dataset.tab)));

    const body = page.querySelector('#tlaBody');
    if (tab === 'profile') await tabProfile(body, plan, stud);
    else if (tab === 'goals') await tabGoals(body, plan);
    else if (tab === 'sched') await tabSchedule(body, plan, stud);
    else await tabMeetings(body, plan, tab === 'team' ? 'צוות' : 'הורים');
  }

  // ── לשונית 1: דף הכנה (פרופיל) ──
  const PROF_FIELDS = [
    { k: 'background', label: 'רקע ומגבלות', ph: 'אבחונים, רקע רפואי/לימודי, מגבלות…' },
    { k: 'env', label: 'נתונים סביבתיים', ph: 'מבנה משפחה, אחים, שפה בבית, נתונים רלוונטיים…' },
    // הסדר כאן קובע גם את הצדדים ברשת הדו-טורית: הראשון מימין.
    { k: 'strengths', label: 'מוקדי כח', ph: 'תחומי חוזק, כישרונות, נקודות אור…' },
    { k: 'focus', label: 'מוקדים לחיזוק', ph: 'תפקודים אקדמיים, רגשיים וחברתיים הדורשים חיזוק…' },
  ];
  async function tabProfile(host, plan, stud) {
    const pr = profOf(plan);
    host.innerHTML = '<div class="tla-grid2">' + PROF_FIELDS.map(f =>
      '<div class="qr-card"><h3>' + esc(f.label) + '</h3>' +
      '<textarea class="inp mb0" data-pf="' + f.k + '" rows="7" placeholder="' + esc(f.ph) + '">' + esc(pr[f.k] || '') + '</textarea></div>').join('') +
      '</div>' +
      '<div class="qr-card" style="margin-top:12px"><h3><i class="bi bi-pen"></i> חתימת הורים</h3><div class="form-grid">' +
      '<label class="fld"><span>שם החותם</span><input class="inp mb0" id="tp_sgn" value="' + esc(plan.signed_by || '') + '"></label>' +
      '<label class="fld"><span>תאריך</span><input type="date" class="inp mb0" id="tp_sgd" value="' + esc(plan.signed_at || '') + '"></label>' +
      '</div></div>' +
      '<div class="tla-save"><button class="btn-primary sm" id="tpSave"><i class="bi bi-check-lg"></i> שמירת דף ההכנה</button></div>';
    // "מלא אוטומטית מהאבחונים" — ממלא את השדות כטיוטה בלבד. השמירה לתיק
    // נשארת בידי המשתמש, דרך אותו כפתור "שמירת דף ההכנה" שלמטה.
    if (window.cv3TlaAutofill && stud) {
      window.cv3TlaAutofill.mount(host, stud, vals => {
        Object.keys(vals).forEach(k => {
          const t = host.querySelector('[data-pf="' + k + '"]');
          if (t && vals[k]) { t.value = vals[k]; t.style.background = '#fbfaff'; }
        });
      });
    }

    host.querySelector('#tpSave').addEventListener('click', async () => {
      const prof = {};
      host.querySelectorAll('[data-pf]').forEach(t => { prof[t.dataset.pf] = t.value.trim(); });
      const signedBy = host.querySelector('#tp_sgn').value.trim() || null;
      const signedAt = host.querySelector('#tp_sgd').value || null;
      if (await savePlan(plan.id, { profile: prof, signed_by: signedBy, signed_at: signedAt })) {
        Object.assign(plan, { profile: prof, signed_by: signedBy, signed_at: signedAt });
        window.UI.toast('נשמר');
      }
    });
  }

  // ── לשונית 2: תכנית היעדים ──
  async function tabGoals(host, plan) {
    const goals = await goalsOf(plan.id);
    host.innerHTML =
      '<div class="tla-bar"><button class="btn-primary sm" id="tgAdd"><i class="bi bi-plus-lg"></i> תחום / יעד חדש</button>' +
      '<span class="count-line">' + goals.length + ' תחומים</span></div>' +
      (goals.length ? goals.map(goalCard).join('')
        : '<div class="empty-state"><i class="bi bi-bullseye"></i><div>אין יעדים — הוסף תחום ראשון</div></div>');
    host.querySelector('#tgAdd').addEventListener('click', () => editGoal(plan, null, () => tabGoals(host, plan)));
    host.querySelectorAll('[data-ged]').forEach(b => b.addEventListener('click', () =>
      editGoal(plan, goals.find(g => g.id == b.dataset.ged), () => tabGoals(host, plan))));
    host.querySelectorAll('[data-gdel]').forEach(b => b.addEventListener('click', async () => {
      if (!await window.UI.confirm('למחוק את התחום הזה?')) return;
      await S.remove('tla_goals', +b.dataset.gdel); tabGoals(host, plan);
    }));
  }
  // jsonb לא שומר סדר מפתחות — מסדרים לפי התבנית ואז שאר התפקידים שנוספו
  function roleKeysOf(roles) {
    const keys = Object.keys(roles || {}).filter(k => roles[k]);
    const first = DEFAULT_ROLES.filter(k => keys.indexOf(k) > -1);
    return first.concat(keys.filter(k => DEFAULT_ROLES.indexOf(k) === -1));
  }
  function goalCard(g) {
    const roleRows = oppsArr(g).map(o =>
      '<div class="det-row"><span class="det-lbl">' + esc(o.who) + '</span><span class="det-val">' + esc(o.what) + '</span></div>').join('');
    const line = (lbl, v) => v ? '<div class="det-row"><span class="det-lbl">' + esc(lbl) + '</span><span class="det-val">' + esc(v) + '</span></div>' : '';
    const gl = goalsArr(g);
    return '<div class="qr-card tla-goal"><h3><i class="bi bi-bullseye"></i> ' + esc(g.domain || 'תחום') +
      '<span class="head-actions"><button class="btn-ghost sm" data-ged="' + g.id + '"><i class="bi bi-pencil"></i></button>' +
      '<button class="btn-ghost sm danger" data-gdel="' + g.id + '"><i class="bi bi-trash"></i></button></span></h3>' +
      line('קו בסיס', g.baseline) + line('מטרת על', g.top_goal) +
      (gl.length ? '<div class="det-row"><span class="det-lbl">יעדים</span><span class="det-val">' +
        '<ol style="margin:0;padding-inline-start:18px">' + gl.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol></span></div>' : '') +
      (roleRows ? '<div class="tla-roles"><div class="det-lbl" style="margin:6px 0 2px">הזדמנויות עבודה ואמצעים להשגתם</div>' + roleRows + '</div>' : '') +
      line('הערכה מעצבת', g.eval_form) + line('הערכה מסכמת', g.eval_sum) +
      line('המלצות', g.recommendations) +
      line('הערות ושינויים משמעותיים במהלך השנה', g.notes) +
      '</div>';
  }

  // עורך התחום — לפי הטבלה הרשמית: יעדים (רשימה) → הזדמנויות עבודה לפי איש
  // צוות נבחר → מעקב והערכה (מעצבת/מסכמת) → המלצות והערות.
  async function editGoal(plan, g, onDone) {
    g = g || {};
    const op = oppsArr(g);
    const staff = await staffNames();
    const staffOpts = staff.map(x => '<option value="' + esc(x.name) + '">' +
      (x.role_label ? ' — ' + esc(x.role_label) : '') + '</option>').join('');
    const ta = (id, lbl, v, ph, rows) => '<label class="fld fld-wide"><span>' + esc(lbl) + '</span>' +
      '<textarea class="inp mb0" id="' + id + '" rows="' + (rows || 2) + '" placeholder="' + esc(ph || '') + '">' + esc(v || '') + '</textarea></label>';

    const goalRow = v => '<div class="g-goal" style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px">' +
      '<textarea class="inp mb0 g-goal-t" rows="2" placeholder="יעד…" style="flex:1">' + esc(v || '') + '</textarea>' +
      '<button type="button" class="mini danger g-goal-del" title="הסר"><i class="bi bi-trash"></i></button></div>';
    const oppRow = (who, what) => '<div class="g-opp" style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px">' +
      '<input class="inp mb0 g-opp-who" list="tlaStaff" placeholder="איש צוות" value="' + esc(who || '') + '" style="max-width:190px">' +
      '<textarea class="inp mb0 g-opp-what" rows="2" placeholder="מה הוא עושה — הזדמנויות עבודה ואמצעים" style="flex:1">' + esc(what || '') + '</textarea>' +
      '<button type="button" class="mini danger g-opp-del" title="הסר"><i class="bi bi-trash"></i></button></div>';

    const gl = goalsArr(g);
    const body =
      '<datalist id="tlaStaff">' + staffOpts + DEFAULT_ROLES.map(r => '<option value="' + esc(r) + '"></option>').join('') + '</datalist>' +
      '<div class="form-grid">' +
        '<label class="fld"><span>תחום</span><input class="inp mb0" id="g_dom" list="tlaDomains" value="' + esc(g.domain || '') + '" placeholder="לימודי / רגשי / חברתי…">' +
          '<datalist id="tlaDomains"><option>לימודי</option><option>רגשי</option><option>חברתי</option><option>התנהגותי</option><option>תפקודי</option></datalist></label>' +
        '<label class="fld"><span>סדר תצוגה</span><input type="number" class="inp mb0" id="g_ord" value="' + (g.sort_order || 0) + '"></label>' +
        ta('g_base', 'קו בסיס (מצב קיים)', g.baseline, 'תיאור המצב היום — נקודת הפתיחה') +
        ta('g_top', 'מטרת על', g.top_goal) +
      '</div>' +
      '<h4 class="tla-sub">יעדים</h4>' +
      '<div id="g_goals">' + (gl.length ? gl.map(goalRow).join('') : goalRow('')) + '</div>' +
      '<button class="btn-ghost sm" id="g_addgoal" type="button"><i class="bi bi-plus-lg"></i> יעד נוסף</button>' +
      '<h4 class="tla-sub">הזדמנויות עבודה ואמצעים להשגתם</h4>' +
      '<p class="login-hint" style="margin:0 0 6px">כל שורה = איש צוות שותף ביישום, ומה שהוא עושה. אפשר לבחור מהרשימה או לכתוב חופשי.</p>' +
      '<div id="g_opps">' + (op.length ? op.map(o => oppRow(o.who, o.what)).join('') : oppRow('', '')) + '</div>' +
      '<button class="btn-ghost sm" id="g_addopp" type="button"><i class="bi bi-plus-lg"></i> איש צוות נוסף</button>' +
      '<h4 class="tla-sub">מעקב והערכה</h4><div class="form-grid">' +
        ta('g_evf', 'הערכה מעצבת', g.eval_form, 'הערכה במהלך השנה') +
        ta('g_evs', 'הערכה מסכמת', g.eval_sum, 'הערכה בסוף התקופה') +
      '</div>' +
      '<div class="form-grid" style="margin-top:10px">' +
        ta('g_rec', 'המלצות', g.recommendations) +
        ta('g_notes', 'הערות ושינויים משמעותיים במהלך השנה', g.notes) +
      '</div>';

    const m = window.UI.modal({
      title: g.id ? 'עריכת תחום' : 'תחום חדש', bodyHTML: body, saveLabel: 'שמירה',
      onSave: async (card) => {
        const list = [...card.querySelectorAll('.g-goal-t')].map(t => t.value.trim()).filter(Boolean);
        const opps = [];
        card.querySelectorAll('.g-opp').forEach(row => {
          const who = row.querySelector('.g-opp-who').value.trim();
          const what = row.querySelector('.g-opp-what').value.trim();
          if (who) opps.push({ who: who, what: what });
        });
        const row = {
          plan_id: plan.id,
          domain: card.querySelector('#g_dom').value.trim() || null,
          sort_order: +card.querySelector('#g_ord').value || 0,
          baseline: card.querySelector('#g_base').value.trim() || null,
          top_goal: card.querySelector('#g_top').value.trim() || null,
          goals_list: list,
          opps: opps,
          eval_form: card.querySelector('#g_evf').value.trim() || null,
          eval_sum: card.querySelector('#g_evs').value.trim() || null,
          recommendations: card.querySelector('#g_rec').value.trim() || null,
          notes: card.querySelector('#g_notes').value.trim() || null,
        };
        const r = g.id ? await S.update('tla_goals', g.id, row) : await S.add('tla_goals', row);
        if (!r.ok) { window.UI.toast('שגיאה: ' + (r.error || ''), 'err'); return false; }
        window.UI.toast('נשמר'); if (onDone) onDone(); return true;
      },
    });
    const el = m.el;
    const wireDel = (sel, cls) => el.querySelectorAll(sel).forEach(b => b.addEventListener('click', () => {
      const wrap = b.closest(cls), host = wrap.parentElement;
      if (host.children.length > 1) wrap.remove(); else host.querySelectorAll('input,textarea').forEach(x => { x.value = ''; });
    }));
    const rewire = () => { wireDel('.g-goal-del', '.g-goal'); wireDel('.g-opp-del', '.g-opp'); };
    el.querySelector('#g_addgoal').addEventListener('click', () => {
      el.querySelector('#g_goals').insertAdjacentHTML('beforeend', goalRow(''));
      rewire();
    });
    el.querySelector('#g_addopp').addEventListener('click', () => {
      el.querySelector('#g_opps').insertAdjacentHTML('beforeend', oppRow('', ''));
      rewire();
    });
    rewire();
  }

  // ── לשונית 3: מערכת שעות אישית ──
  async function tabSchedule(host, plan, stud) {
    const slots = slotsOf(plan);
    const cells = await scheduleOf(plan.id);
    const cellAt = (d, i) => cells.find(c => c.day_num == d && c.slot_idx == i);
    let html =
      '<div class="tla-bar">' +
      '<button class="btn-ghost sm" id="tsSlots"><i class="bi bi-clock"></i> עריכת שעות</button>' +
      '<button class="btn-ghost sm" id="tsFromTmpl"><i class="bi bi-box-arrow-in-down"></i> העתקה מתבנית כיתה</button>' +
      '<button class="btn-ghost sm" id="tsToTmpl"><i class="bi bi-save"></i> שמירה כתבנית כיתה</button>' +
      '<span class="tla-legend">' + HL.filter(h => h.v).map(h =>
        '<span><i style="background:' + h.color + '"></i>' + esc(h.label) + '</span>').join('') + '</span></div>' +
      '<div class="tla-schedwrap"><table class="tbl tla-sched"><thead><tr><th></th>' +
      DAYS.map(d => '<th>' + esc(d) + '</th>').join('') + '</tr></thead><tbody>';
    slots.forEach((s, i) => {
      html += '<tr><th class="slot">' + esc(s.from || '') + '<br>' + esc(s.to || '') + '</th>';
      for (let d = 1; d <= DAYS.length; d++) {
        const c = cellAt(d, i);
        const bg = c && c.highlight ? 'background:' + hlColor(c.highlight) : '';
        html += '<td class="cell" data-d="' + d + '" data-i="' + i + '" style="' + bg + '">' +
          (c ? esc(c.subject || '') + (c.note ? '<div class="cnote">' + esc(c.note) + '</div>' : '') : '') + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    host.innerHTML = html;

    host.querySelectorAll('.cell').forEach(td => td.addEventListener('click', () =>
      editCell(plan, +td.dataset.d, +td.dataset.i, cellAt(+td.dataset.d, +td.dataset.i), () => tabSchedule(host, plan, stud))));
    host.querySelector('#tsSlots').addEventListener('click', () => editSlots(plan, () => tabSchedule(host, plan, stud)));
    host.querySelector('#tsFromTmpl').addEventListener('click', () => copyFromTemplate(plan, stud, () => tabSchedule(host, plan, stud)));
    host.querySelector('#tsToTmpl').addEventListener('click', () => saveAsTemplate(plan, stud));
  }
  function editCell(plan, d, i, c, onDone) {
    c = c || {};
    const body = '<div class="form-grid">' +
      '<label class="fld fld-wide"><span>נושא / פעילות</span><input class="inp mb0" id="c_sub" value="' + esc(c.subject || '') + '"></label>' +
      '<label class="fld"><span>סוג</span><select class="inp mb0" id="c_hl">' +
        HL.map(h => '<option value="' + h.v + '"' + ((c.highlight || '') === h.v ? ' selected' : '') + '>' + esc(h.label) + '</option>').join('') +
      '</select></label>' +
      '<label class="fld fld-wide"><span>הערה</span><input class="inp mb0" id="c_note" value="' + esc(c.note || '') + '"></label>' +
      '</div><p class="login-hint" style="text-align:right">ריקון הנושא וההערה מוחק את המשבצת.</p>';
    window.UI.modal({
      title: DAYS[d - 1] + ' · משבצת ' + (i + 1), bodyHTML: body, saveLabel: 'שמירה',
      onSave: async (card) => {
        const row = {
          plan_id: plan.id, day_num: d, slot_idx: i,
          subject: card.querySelector('#c_sub').value.trim() || null,
          highlight: card.querySelector('#c_hl').value || null,
          note: card.querySelector('#c_note').value.trim() || null,
        };
        if (!row.subject && !row.note) {
          if (c.id) await S.remove('tla_schedule', c.id);
          if (onDone) onDone(); return true;
        }
        const r = c.id ? await S.update('tla_schedule', c.id, row) : await S.add('tla_schedule', row);
        if (!r.ok) { window.UI.toast('שגיאה: ' + (r.error || ''), 'err'); return false; }
        if (onDone) onDone(); return true;
      },
    });
  }
  function editSlots(plan, onDone) {
    const current = slotsOf(plan);
    const rowHtml = s => '<div class="slot-row">' +
      '<input type="time" class="inp mb0 s-from" value="' + esc(s.from || '') + '">' +
      '<input type="time" class="inp mb0 s-to" value="' + esc(s.to || '') + '">' +
      '<button class="btn-ghost sm danger s-del" type="button"><i class="bi bi-trash"></i></button></div>';
    const body = '<div id="slotList">' + current.map(rowHtml).join('') + '</div>' +
      '<button class="btn-ghost sm" id="slotAdd" type="button"><i class="bi bi-plus-lg"></i> משבצת</button>' +
      '<p class="login-hint" style="text-align:right;margin-top:8px">מחיקת משבצת מוחקת גם את מה שמולא בה בכל הימים.</p>';
    const m = window.UI.modal({
      title: 'עריכת שעות המערכת', bodyHTML: body, saveLabel: 'שמירה',
      onSave: async (card) => {
        const out = [];
        card.querySelectorAll('.slot-row').forEach(r => {
          out.push({ from: r.querySelector('.s-from').value, to: r.querySelector('.s-to').value });
        });
        if (!out.length) { window.UI.toast('צריך לפחות משבצת אחת', 'err'); return false; }
        if (out.length < current.length) {
          const cells = await scheduleOf(plan.id);
          for (const c of cells) if (c.slot_idx >= out.length) await S.remove('tla_schedule', c.id);
        }
        if (!await savePlan(plan.id, { slots: out })) return false;
        plan.slots = out; if (onDone) onDone(); return true;
      },
    });
    const wireDel = () => m.el.querySelectorAll('.s-del').forEach(b => { b.onclick = () => b.closest('.slot-row').remove(); });
    m.el.querySelector('#slotAdd').addEventListener('click', () => {
      const wrap = document.createElement('div');
      wrap.innerHTML = rowHtml({ from: '', to: '' });
      m.el.querySelector('#slotList').appendChild(wrap.firstChild);
      wireDel();
    });
    wireDel();
  }
  async function copyFromTemplate(plan, stud, onDone) {
    const tmpls = await templates();
    if (!tmpls.length) { window.UI.toast('אין תבניות כיתה שמורות עדיין', 'err'); return; }
    const body = '<label class="fld fld-wide"><span>תבנית</span><select class="inp mb0" id="tm_sel">' +
      tmpls.map(t => '<option value="' + t.id + '">' + esc(t.name || ('תבנית ' + t.id)) + '</option>').join('') +
      '</select></label><p class="login-hint" style="text-align:right">ההעתקה דורסת את המערכת הקיימת בתכנית זו.</p>';
    window.UI.modal({
      title: 'העתקה מתבנית כיתה', bodyHTML: body, saveLabel: 'העתקה',
      onSave: async (card) => {
        const t = tmpls.find(x => x.id == card.querySelector('#tm_sel').value);
        if (!t) return false;
        const old = await scheduleOf(plan.id);
        for (const c of old) await S.remove('tla_schedule', c.id);
        if (Array.isArray(t.slots) && t.slots.length) { await savePlan(plan.id, { slots: t.slots }); plan.slots = t.slots; }
        for (const c of (t.cells || [])) {
          await S.add('tla_schedule', {
            plan_id: plan.id, day_num: c.day_num, slot_idx: c.slot_idx,
            subject: c.subject || null, highlight: c.highlight || null, note: c.note || null,
          });
        }
        window.UI.toast('הועתק'); if (onDone) onDone(); return true;
      },
    });
  }
  async function saveAsTemplate(plan, stud) {
    const cells = await scheduleOf(plan.id);
    const body = '<label class="fld fld-wide"><span>שם התבנית</span><input class="inp mb0" id="tm_name" value="' +
      esc((plan.class_label || '') + ' — מערכת בסיס') + '"></label>' +
      '<p class="login-hint" style="text-align:right">נשמרת כמערכת כיתתית לשימוש חוזר בתלמידים אחרים.</p>';
    window.UI.modal({
      title: 'שמירה כתבנית כיתה', bodyHTML: body, saveLabel: 'שמירה',
      onSave: async (card) => {
        const r = await S.add('tla_class_templates', {
          class_id: stud && stud.class_id ? stud.class_id : null,
          name: card.querySelector('#tm_name').value.trim() || 'תבנית',
          slots: slotsOf(plan),
          cells: cells.map(c => ({ day_num: c.day_num, slot_idx: c.slot_idx, subject: c.subject, highlight: c.highlight, note: c.note })),
        });
        if (!r.ok) { window.UI.toast('שגיאה: ' + (r.error || ''), 'err'); return false; }
        window.UI.toast('התבנית נשמרה'); return true;
      },
    });
  }

  // ── לשוניות 4-5: ישיבות צוות / שיחות הורים ──
  async function tabMeetings(host, plan, kind) {
    const rows = await meetingsOf(plan.id, kind);
    const isTeam = kind === 'צוות';
    host.innerHTML =
      '<div class="tla-bar"><button class="btn-primary sm" id="tmAdd"><i class="bi bi-plus-lg"></i> ' +
        (isTeam ? 'ישיבה חדשה' : 'שיחה חדשה') + '</button><span class="count-line">' + rows.length + ' רשומות</span></div>' +
      (rows.length ? '<table class="tbl"><thead><tr><th style="width:90px">חודש</th><th style="width:110px">תאריך</th>' +
        '<th>' + (isTeam ? 'סיכום והמלצות' : 'סיכום השיחה') + '</th>' +
        '<th style="width:180px">' + (isTeam ? 'משתתפים' : 'הובא לידיעת') + '</th><th style="width:90px"></th></tr></thead><tbody>' +
        rows.map(r => '<tr><td>' + esc(r.heb_month || '') + '</td><td>' + esc(dmy(r.meeting_date)) + '</td>' +
          '<td>' + esc(r.summary || '') + '</td>' +
          '<td>' + esc((isTeam ? r.participants : r.follow_up) || '') + '</td>' +
          '<td style="white-space:nowrap"><button class="btn-ghost sm" data-med="' + r.id + '"><i class="bi bi-pencil"></i></button>' +
          '<button class="btn-ghost sm danger" data-mdel="' + r.id + '"><i class="bi bi-trash"></i></button></td></tr>').join('') +
        '</tbody></table>'
        : '<div class="empty-state"><i class="bi bi-chat-left-text"></i><div>אין רשומות עדיין</div></div>');
    host.querySelector('#tmAdd').addEventListener('click', () => editMeeting(plan, kind, null, () => tabMeetings(host, plan, kind)));
    host.querySelectorAll('[data-med]').forEach(b => b.addEventListener('click', () =>
      editMeeting(plan, kind, rows.find(r => r.id == b.dataset.med), () => tabMeetings(host, plan, kind))));
    host.querySelectorAll('[data-mdel]').forEach(b => b.addEventListener('click', async () => {
      if (!await window.UI.confirm('למחוק את הרשומה?')) return;
      await S.remove('tla_meetings', +b.dataset.mdel); tabMeetings(host, plan, kind);
    }));
  }
  function editMeeting(plan, kind, r, onDone) {
    r = r || {};
    const isTeam = kind === 'צוות';
    const body = '<div class="form-grid">' +
      '<label class="fld"><span>חודש</span><select class="inp mb0" id="m_mon"><option value="">—</option>' +
        HEB_MONTHS.map(x => '<option' + (r.heb_month === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>תאריך</span><input type="date" class="inp mb0" id="m_date" value="' + esc(r.meeting_date || todayIso()) + '"></label>' +
      '<label class="fld fld-wide"><span>' + (isTeam ? 'סיכום והמלצות' : 'סיכום השיחה') + '</span>' +
        '<textarea class="inp mb0" id="m_sum" rows="5">' + esc(r.summary || '') + '</textarea></label>' +
      '<label class="fld fld-wide"><span>' + (isTeam ? 'משתתפים' : 'הובא לידיעת / המשך טיפול') + '</span>' +
        '<textarea class="inp mb0" id="m_who" rows="3">' + esc((isTeam ? r.participants : r.follow_up) || '') + '</textarea></label>' +
      '</div>';
    window.UI.modal({
      title: isTeam ? 'ישיבת צוות' : 'שיחת הורים', bodyHTML: body, saveLabel: 'שמירה',
      onSave: async (card) => {
        const who = card.querySelector('#m_who').value.trim() || null;
        const row = {
          plan_id: plan.id, kind: kind,
          heb_month: card.querySelector('#m_mon').value || null,
          meeting_date: card.querySelector('#m_date').value || null,
          summary: card.querySelector('#m_sum').value.trim() || null,
          participants: isTeam ? who : null,
          follow_up: isTeam ? null : who,
        };
        const res = r.id ? await S.update('tla_meetings', r.id, row) : await S.add('tla_meetings', row);
        if (!res.ok) { window.UI.toast('שגיאה: ' + (res.error || ''), 'err'); return false; }
        window.UI.toast('נשמר'); if (onDone) onDone(); return true;
      },
    });
  }

  // ───────────────────────── הדפסה (התבנית הרשמית) ─────────────────────────
  async function printPlan(planId) {
    const plan = await planById(planId);
    if (!plan) return;
    const studs = window.cv3Students ? await window.cv3Students.getStudents() : [];
    const stud = studs.find(s => s.id == plan.student_id) || {};
    const [goals, team, parents, cells, settings] = await Promise.all([
      goalsOf(plan.id), meetingsOf(plan.id, 'צוות'), meetingsOf(plan.id, 'הורים'),
      scheduleOf(plan.id), S.list('institution_settings'),
    ]);
    const st = (settings && settings[0]) || {};
    const logo = st.letterhead_data || '';
    const slots = slotsOf(plan);
    const pr = profOf(plan);
    const inst = (window.CV3 && window.CV3.INSTANCE_NAME) || 'המוסד';
    const cellAt = (d, i) => cells.find(c => c.day_num == d && c.slot_idx == i);

    const hdr = t => '<div class="ph"><div class="pt">' + esc(t) + '</div><div class="pi">' + esc(inst) + '</div></div>';
    const meta = '<table class="meta"><tr><td>שם התלמיד: <b>' + esc(fullName(stud)) + '</b></td>' +
      '<td>כיתה: <b>' + esc(plan.class_label || '') + '</b></td>' +
      '<td>שנה"ל: <b>' + esc(plan.year_label || '') + '</b></td>' +
      '<td>מחנך: <b>' + esc(plan.mentor || '') + '</b></td></tr></table>';

    let h = '<section class="page cover">' + (logo ? '<img class="lh" src="' + logo + '">' : '') +
      '<h1>תיק תלמיד</h1><h2>שנה"ל ' + esc(plan.year_label || '') + '</h2>' +
      '<div class="cv-fields"><div>שם התלמיד: <b>' + esc(fullName(stud)) + '</b></div>' +
      '<div>ת.ז.: <b>' + esc(stud.tz || '') + '</b></div>' +
      '<div>כיתה: <b>' + esc(plan.class_label || '') + '</b></div></div></section>';

    h += '<section class="page">' + hdr('מערכת שעות אישית') + meta +
      '<table class="grid sched"><thead><tr><th></th>' + DAYS.map(d => '<th>' + esc(d) + '</th>').join('') + '</tr></thead><tbody>';
    slots.forEach((s, i) => {
      h += '<tr><th class="sl">' + esc(s.from || '') + '–' + esc(s.to || '') + '</th>';
      for (let d = 1; d <= DAYS.length; d++) {
        const c = cellAt(d, i);
        h += '<td' + (c && c.highlight ? ' style="background:' + hlColor(c.highlight) + '"' : '') + '>' +
          (c ? esc(c.subject || '') + (c.note ? '<div class="nt">' + esc(c.note) + '</div>' : '') : '') + '</td>';
      }
      h += '</tr>';
    });
    h += '</tbody></table></section>';

    h += '<section class="page">' + hdr('דף הכנה לתל"א — פרופיל תלמיד') + meta +
      '<table class="grid prof"><tr><th>רקע ומגבלות</th><th>נתונים סביבתיים</th></tr>' +
      '<tr><td class="tall">' + esc(pr.background || '') + '</td><td class="tall">' + esc(pr.env || '') + '</td></tr>' +
      // נעמי ביקשה (24/08): מוקדי כח מימין, מוקדים לחיזוק משמאל.
      // ב-RTL העמודה הראשונה היא הימנית.
      '<tr><th>מוקדי כח</th><th>מוקדים לחיזוק</th></tr>' +
      '<tr><td class="tall">' + esc(pr.strengths || '') + '</td><td class="tall">' + esc(pr.focus || '') + '</td></tr></table></section>';

    // ── הטבלה הרשמית: יעדים | הזדמנויות עבודה (עמודה לכל איש צוות) | מעקב והערכה ──
    // הסדר מימין לשמאל, ומתחת שורת המלצות + הערות ושינויים. זה בדיוק המבנה
    // שבטופס של המכינה (משוב נעמי לוי, 20/08).
    goals.forEach(g => {
      const op = oppsArr(g);
      const gl = goalsArr(g);
      const oppCols = op.length || 1;
      h += '<section class="page">' + hdr('תלי"א אינטגרטיבי — תכנית לימודים אישית') + meta +
        '<div class="band">תחום: <b>' + esc(g.domain || '') + '</b></div>' +
        '<div class="para"><b>קו בסיס:</b> ' + esc(g.baseline || '') + '</div>' +
        '<div class="para"><b>מטרת על:</b> ' + esc(g.top_goal || '') + '</div>' +
        '<table class="grid"><thead>' +
          '<tr><th rowspan="2" style="width:30%">יעדים</th>' +
              '<th colspan="' + oppCols + '">הזדמנויות עבודה ואמצעים להשגתם</th>' +
              '<th colspan="2" style="width:26%">מעקב והערכה</th></tr>' +
          '<tr>' +
              (op.length ? op.map(o => '<th class="sub">' + esc(o.who) + '</th>').join('') : '<th class="sub"></th>') +
              '<th class="sub">הערכה מעצבת</th><th class="sub">הערכה מסכמת</th></tr>' +
        '</thead><tbody><tr>' +
          '<td class="tall">' + (gl.length
            ? '<ol style="margin:0;padding-inline-start:5mm">' + gl.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>'
            : '') + '</td>' +
          (op.length ? op.map(o => '<td class="tall">' + esc(o.what) + '</td>').join('') : '<td class="tall"></td>') +
          '<td class="tall">' + esc(g.eval_form || '') + '</td>' +
          '<td class="tall">' + esc(g.eval_sum || '') + '</td>' +
        '</tr></tbody></table>' +
        '<table class="grid" style="margin-top:3mm"><tr><th style="width:50%">המלצות</th>' +
        '<th>הערות ושינויים משמעותיים במהלך השנה</th></tr>' +
        '<tr><td class="tall">' + esc(g.recommendations || '') + '</td>' +
        '<td class="tall">' + esc(g.notes || '') + '</td></tr></table>' +
        '<div class="sig">חתימת ההורים: ' + esc(plan.signed_by || '____________________') +
        (plan.signed_at ? ' &nbsp; תאריך: ' + esc(dmy(plan.signed_at)) : '') + '</div></section>';
    });

    const mtTable = (rows, title, col3, col4) => '<section class="page">' + hdr(title) + meta +
      '<table class="grid"><thead><tr><th style="width:70px">חודש</th><th style="width:90px">תאריך</th>' +
      '<th>' + esc(col3) + '</th><th style="width:24%">' + esc(col4) + '</th></tr></thead><tbody>' +
      (rows.length ? rows : [{}, {}, {}, {}]).map(r => '<tr><td>' + esc(r.heb_month || '') + '</td><td>' + esc(dmy(r.meeting_date)) +
        '</td><td class="tall">' + esc(r.summary || '') + '</td><td class="tall">' +
        esc(r.participants || r.follow_up || '') + '</td></tr>').join('') +
      '</tbody></table></section>';
    h += mtTable(team, 'תיעוד ישיבות צוות', 'סיכום והמלצות', 'משתתפים');
    h += mtTable(parents, 'תיעוד שיחות הורים', 'סיכום השיחה', 'הובא לידיעת');

    const css = '@page{size:A4 landscape;margin:8mm}' +
      '*{box-sizing:border-box}body{margin:0;font-family:"David","Narkisim","Arial",sans-serif;color:#111;direction:rtl}' +
      '.page{width:281mm;min-height:190mm;padding:6mm 8mm;page-break-after:always;position:relative}' +
      '.page:last-child{page-break-after:auto}' +
      '.ph{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #003048;padding-bottom:3mm;margin-bottom:4mm}' +
      '.pt{font-size:19pt;font-weight:bold;color:#003048}.pi{font-size:11pt;color:#a87830}' +
      '.meta{width:100%;border-collapse:collapse;margin-bottom:4mm;font-size:10.5pt}' +
      '.meta td{border:1px solid #999;padding:2mm 3mm}' +
      '.grid{width:100%;border-collapse:collapse;font-size:10.5pt;table-layout:fixed}' +
      '.grid th,.grid td{border:1px solid #666;padding:2mm 2.5mm;vertical-align:top;word-wrap:break-word}' +
      '.grid th{background:#eef2f6;color:#003048;font-size:11pt}.grid th.sub{background:#f7f9fb;font-size:10pt}' +
      '.grid td.tall{height:32mm}.grid .nt{font-size:8.5pt;color:#555}' +
      '.sched th.sl{width:22mm;background:#f4f6f8;font-size:9.5pt;white-space:nowrap}' +
      '.sched td{height:16mm;text-align:center;font-size:10pt}' +
      '.prof td.tall{height:52mm}' +
      '.band{background:#003048;color:#fff;padding:2mm 3mm;font-size:12pt;margin-bottom:3mm}' +
      '.para{font-size:11pt;margin:2mm 0 3mm;line-height:1.5}' +
      '.sig{margin-top:6mm;font-size:11pt}' +
      '.cover{text-align:center;padding-top:30mm}.cover .lh{max-width:70mm;margin-bottom:8mm}' +
      '.cover h1{font-size:34pt;color:#003048;margin:0 0 4mm}.cover h2{font-size:20pt;color:#a87830;font-weight:normal;margin:0 0 20mm}' +
      '.cv-fields{font-size:15pt;line-height:2.2;display:inline-block;text-align:right}' +
      '@media print{.noprint{display:none}}' +
      '.pdfbtn{left:112px !important;background:#a87830 !important}.noprint{position:fixed;top:8px;left:8px;background:#003048;color:#fff;border:0;padding:8px 16px;border-radius:6px;font-size:14px;cursor:pointer;z-index:9}';

    const w = window.open('', '_blank');
    if (!w) { window.UI.toast('חלון קופץ נחסם — אפשר חלונות קופצים לאתר', 'err'); return; }
    w.document.open();
    w.document.write('<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>תל"א — ' +
      esc(fullName(stud)) + '</title><style>' + css + '</style></head><body>' +
      '<button class=\"noprint pdfbtn\" id=\"pdfBtn\">⬇ הורד PDF</button>' +
      '<button class="noprint" onclick="window.print()">🖨️ הדפסה</button>' + h + "<script>(function(){var b=document.getElementById('pdfBtn');if(!b)return;b.onclick=function(){var o=window.opener;if(!o||!o.cv3Pdf){alert('צריך שהמערכת תישאר פתוחה ברקע');return;}b.disabled=true;var t=b.textContent;b.textContent='מכין…';o.cv3Pdf.save(document.querySelector('.page')||document.body,document.title,{margin:0})['finally'](function(){b.disabled=false;b.textContent=t;});};})();<\/script>" + '</body></html>');
    w.document.close();
  }

  // ───────────────────────── שילוב בכרטיס התלמיד ─────────────────────────
  function goToPlan(id) {
    window.showPage('tla');
    setTimeout(() => { const pg = document.getElementById('page-tla'); if (pg) openEditor(pg, id); }, 80);
  }
  async function openForStudent(student) {
    const plans = (await allPlans()).filter(p => p.student_id == student.id).sort((a, b) => b.id - a.id);
    if (plans.length === 1) { goToPlan(plans[0].id); return; }
    if (!plans.length) { newPlanDialog(row => { if (row && row.id) goToPlan(row.id); else window.showPage('tla'); }, student); return; }
    const body = '<label class="fld fld-wide"><span>תכנית</span><select class="inp mb0" id="tl_sel">' +
      plans.map(p => '<option value="' + p.id + '">' + esc((p.year_label || '') + ' · ' + (p.status || '')) + '</option>').join('') +
      '</select></label>';
    window.UI.modal({
      title: 'תל"א — ' + esc(fullName(student)), bodyHTML: body, saveLabel: 'פתיחה',
      onSave: card => { goToPlan(+card.querySelector('#tl_sel').value); return true; },
    });
  }
  function cardSection(plans, goals) {
    if (!plans || !plans.length) return '';
    const p = plans[0];
    const lines = (goals || []).slice(0, 4).map(g =>
      '<div class="det-row"><span class="det-lbl">' + esc(g.domain || 'תחום') + '</span><span class="det-val">' +
      esc(g.top_goal || g.goal_sum || '') + '</span></div>').join('');
    return '<div class="det-sec"><h4><i class="bi bi-journal-bookmark"></i> תל"א · תכנית לימודים אישית ' +
      '<span class="det-badge">' + esc(((p.year_label || '') + ' ' + (p.status || '')).trim()) + '</span></h4>' +
      (lines || '<div class="tl-note" style="font-size:.82rem">התכנית נוצרה — עדיין ללא יעדים</div>') + '</div>';
  }
  async function forStudent(sid) {
    const plans = (await allPlans()).filter(p => p.student_id == sid).sort((a, b) => b.id - a.id);
    if (!plans.length) return { plans: [], goals: [] };
    return { plans: plans, goals: await goalsOf(plans[0].id) };
  }

  window.cv3Tla = { openForStudent, cardSection, forStudent, printPlan };
  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.tla = renderPage;
})();
