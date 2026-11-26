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
  // יוסף 26/11: יעד הוא אובייקט {text, acts, eval_form, eval_sum, notes}.
  // acts = מה כל איש צוות עושה ליעד הזה: [{who, what}]. מחרוזת ישנה ב-goals_list נקראת כ-{text} בלבד.
  const hasGoalContent = x => !!(x.text || (x.acts && x.acts.length) || x.eval_form || x.eval_sum || x.notes);
  function goalsObj(g) {
    const raw = Array.isArray(g && g.goals_list) ? g.goals_list : [];
    return raw.map(x => {
      if (typeof x === 'string') return { text: x.trim(), acts: [], eval_form: '', eval_sum: '', notes: '' };
      if (!x || typeof x !== 'object') return null;
      const acts = (Array.isArray(x.acts) ? x.acts : [])
        .map(a => ({ who: String(a && a.who || '').trim(), what: String(a && a.what || '').trim() }))
        .filter(a => a.who && a.what);
      return {
        text: String(x.text || '').trim(), acts: acts,
        eval_form: String(x.eval_form || '').trim(), eval_sum: String(x.eval_sum || '').trim(), notes: String(x.notes || '').trim(),
      };
    }).filter(x => x && hasGoalContent(x));
  }
  // נשמר לתאימות: מי שקורא goalsArr מקבל מחרוזות בלבד, כמו קודם
  const goalsArr = g => goalsObj(g).map(x => x.text).filter(Boolean);
  // מה איש צוות מסוים עושה ליעד (ריק אם לא נכתב)
  const actOf = (x, who) => ((x.acts || []).find(a => a.who === who) || {}).what || '';
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
      '<div class="head-actions">' +
        (isAdmin() ? '<button class="btn-ghost sm" id="tlaBatch"><i class="bi bi-cloud-download"></i> הזמנת נתונים אוטומטית לכולם</button> ' : '') +
        '<button class="btn-primary sm" id="tlaNew"><i class="bi bi-plus-lg"></i> תל"א חדש</button></div></div>' +
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
    // הזמנה קבוצתית — מנהל בלבד. יוצרת טיוטות, לא כותבת לתיקים.
    const bb = page.querySelector('#tlaBatch');
    if (bb && window.cv3TlaAutofill) bb.addEventListener('click', () => window.cv3TlaAutofill.batchModal());
    else if (bb) bb.style.display = 'none';
    // פאנל הטיוטות — מוצג מעל הרשימה, כדי שיהיה נגיש גם לתלמידים
    // שאין להם עדיין תכנית תל"א (רובם).
    if (window.cv3TlaAutofill) {
      const wrap = page.querySelector('#tlaList');
      window.cv3TlaAutofill.draftsPanel(wrap.parentNode, () => renderPage(page)).catch(() => {});
    }
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
    // "הזמנת נתונים אוטומטית" — קורא את האבחונים ומציע תוכן כטיוטה בלבד.
    // השמירה לתיק נשארת בידי המשתמש, דרך "שמירת דף ההכנה" שלמטה.
    // "תיק מסמכים" — נעמי ביקשה שיהיה אפשר לראות כאן, ליד הכפתור האוטומטי,
    // גם את המסמכים עצמם (לא רק את התוצאה שהמודל מפיק מהם).
    if (window.cv3StudentDocs && stud && stud.id) {
      const docsBtn = document.createElement('button');
      docsBtn.className = 'btn-ghost sm'; docsBtn.style.marginInlineStart = '8px';
      docsBtn.innerHTML = '<i class="bi bi-folder2-open"></i> מסמכי התלמיד (דרייב)';
      docsBtn.addEventListener('click', () => window.cv3StudentDocs.openManager(stud, () => {}));
      host.insertBefore(docsBtn, host.firstChild);
    }
    if (window.cv3TlaAutofill && stud) {
      window.cv3TlaAutofill.mount(host, stud, (vals, mode) => {
        Object.keys(vals).forEach(k => {
          const t = host.querySelector('[data-pf="' + k + '"]');
          if (!t || !vals[k]) return;
          // 'append' משרשר לקיים במקום לדרוס. בגרסה הקודמת הכפתור **דרס**
          // תמיד, וטקסט שהצוות כתב ידנית נמחק בלי אזהרה ובלי דרך לשחזר.
          t.value = (mode === 'append' && t.value.trim())
            ? t.value.trim() + '\n' + vals[k]
            : vals[k];
          t.style.background = '#fbfaff';
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
    ensureGoalCss();
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

  // יוסף 26/11: סגנונות העורך והכרטיס. מוזרקים פעם אחת, בלי לגעת ב-main.css
  function ensureGoalCss() {
    if (document.getElementById('tlaGoalCss')) return;
    const st = document.createElement('style');
    st.id = 'tlaGoalCss';
    st.textContent =
      '.modal-card.tla-wide{width:min(96vw,1400px)!important;max-width:96vw!important}' +
      '.tla-gridwrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;margin:6px 0}' +
      '.tla-egrid{width:100%;border-collapse:collapse;min-width:820px;font-size:.9rem}' +
      '.tla-egrid th,.tla-egrid td{border:1px solid var(--line);padding:6px;vertical-align:top;text-align:right}' +
      '.tla-egrid th{background:#eef2f6;color:var(--primary,#003048);font-weight:600}' +
      '.tla-egrid textarea{width:100%;min-height:56px;resize:vertical;box-sizing:border-box;font-size:.88rem}' +
      '.tla-gv{width:100%;border-collapse:collapse;font-size:.92rem;margin-top:6px}' +
      '.tla-gv th,.tla-gv td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:right}' +
      '.tla-gv th{background:#eef2f6;color:var(--primary,#003048);font-weight:600}' +
      '#g_staff{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}' +
      '.tla-staffrow{width:250px}' +
      '.tla-srow{display:flex;gap:6px;align-items:center}' +
      '.tla-srow input{flex:1;min-width:0}' +
      '.tla-sdesc{font-size:.78rem;color:var(--muted);margin-top:2px}';
    document.head.appendChild(st);
  }
  function growArea(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }

  // טבלת היעדים בתצוגת קריאה: אותה טבלה כמו בעורך ובהדפסה
  function gridView(op, gl) {
    const head = '<thead><tr><th rowspan="2" style="width:22%">יעדים</th>' +
      op.map(o => '<th rowspan="2">' + esc(o.who) + '</th>').join('') +
      '<th colspan="2">מעקב והערכה</th><th rowspan="2">הערות ליעד</th></tr>' +
      '<tr><th>הערכה מעצבת</th><th>הערכה מסכמת</th></tr></thead>';
    const body = gl.length ? gl.map(x => '<tr><td>' + esc(x.text) + '</td>' +
      op.map(o => '<td>' + esc(actOf(x, o.who)) + '</td>').join('') +
      '<td>' + esc(x.eval_form) + '</td><td>' + esc(x.eval_sum) + '</td><td>' + esc(x.notes) + '</td></tr>').join('')
      : '<tr><td colspan="' + (op.length + 4) + '" style="color:var(--muted)">אין יעדים עדיין</td></tr>';
    return '<div class="tla-gridwrap"><table class="tla-gv">' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  // כרטיס התחום: קריאה בלבד, באותה טבלה של העורך
  function goalCard(g) {
    const op = oppsArr(g);
    const gl = goalsObj(g);
    const line = (lbl, v) => v ? '<div class="det-row"><span class="det-lbl">' + esc(lbl) + '</span><span class="det-val">' + esc(v) + '</span></div>' : '';
    const staffLine = op.length ? '<div class="tla-roles"><div class="det-lbl" style="margin:6px 0 2px">אנשי צוות המשתתפים ביישום התכנית</div>' +
      '<div class="det-val">' + op.map(o => esc(o.who)).join(' · ') + '</div></div>' : '';
    return '<div class="qr-card tla-goal"><h3><i class="bi bi-bullseye"></i> ' + esc(g.domain || 'תחום') +
      '<span class="head-actions"><button class="btn-ghost sm" data-ged="' + g.id + '"><i class="bi bi-pencil"></i></button>' +
      '<button class="btn-ghost sm danger" data-gdel="' + g.id + '"><i class="bi bi-trash"></i></button></span></h3>' +
      line('קו בסיס', g.baseline) + staffLine + line('מטרת על', g.top_goal) +
      gridView(op, gl) +
      line('הערכה מעצבת (כללי, מהגרסה הקודמת)', g.eval_form) + line('הערכה מסכמת (כללי, מהגרסה הקודמת)', g.eval_sum) +
      line('המלצות', g.recommendations) +
      line('הערות ושינויים משמעותיים במהלך השנה', g.notes) +
      '</div>';
  }

  // עורך התחום: הכול פתוח בעמוד אחד, בלי לשוניות. הטבלה: יעד | עמודה לכל איש צוות | מעצבת | מסכמת | הערות.
  // מצב העריכה נמצא ב-M. לפני כל ציור מחדש קוראים את ה-DOM אל M (readDom), כך שלא הולך מידע.
  async function editGoal(plan, g, onDone) {
    ensureGoalCss();
    g = g || {};
    const staff = await staffNames();
    const staffOpts = staff.map(x => '<option value="' + esc(x.name) + '">' +
      (x.role_label ? ' — ' + esc(x.role_label) : '') + '</option>').join('');
    const ta = (id, lbl, v, ph, rows) => '<label class="fld fld-wide"><span>' + esc(lbl) + '</span>' +
      '<textarea class="inp mb0" id="' + id + '" rows="' + (rows || 2) + '" placeholder="' + esc(ph || '') + '">' + esc(v || '') + '</textarea></label>';
    const taCell = (f, v, sid) => '<textarea class="inp mb0 tla-c" data-f="' + f + '"' +
      (sid != null ? ' data-sid="' + sid + '"' : '') + ' rows="3">' + esc(v || '') + '</textarea>';

    // בניית המצב מהנתונים השמורים. מי שמופיע ב-acts אבל לא ב-opps נוסף לרשימה, כדי לא לאבד אותו
    let nextSid = 1;
    const staffM = oppsArr(g).map(o => ({ sid: nextSid++, who: o.who, what: o.what || '' }));
    const goalsM = goalsObj(g).map(x => {
      const acts = {};
      x.acts.forEach(a => {
        let s = staffM.find(q => q.who === a.who);
        if (!s) { s = { sid: nextSid++, who: a.who, what: '' }; staffM.push(s); }
        acts[s.sid] = a.what;
      });
      return { text: x.text, acts: acts, eval_form: x.eval_form, eval_sum: x.eval_sum, notes: x.notes };
    });
    const M = { staff: staffM, goals: goalsM, nextSid: nextSid };

    // הערכה כללית מהגרסה הקודמת: מוצגת רק אם יש בה תוכן, כדי שלא תאבד
    const legacy = (g.eval_form || g.eval_sum)
      ? '<div class="tla-legacy"><p class="login-hint" style="margin:8px 0 4px">הערכה כללית מהגרסה הקודמת (לא שייכת ליעד מסוים). אפשר לערוך או למחוק.</p>' +
        '<div class="form-grid">' + ta('g_legevf', 'הערכה מעצבת (כללי)', g.eval_form) +
        ta('g_legevs', 'הערכה מסכמת (כללי)', g.eval_sum) + '</div></div>'
      : '';

    const body =
      '<datalist id="tlaStaff">' + staffOpts + DEFAULT_ROLES.map(r => '<option value="' + esc(r) + '"></option>').join('') + '</datalist>' +
      '<div class="form-grid">' +
        '<label class="fld"><span>תחום</span><input class="inp mb0" id="g_dom" list="tlaDomains" value="' + esc(g.domain || '') + '" placeholder="לימודי / רגשי / חברתי…">' +
          '<datalist id="tlaDomains"><option>לימודי</option><option>רגשי</option><option>חברתי</option><option>התנהגותי</option><option>תפקודי</option></datalist></label>' +
        '<label class="fld"><span>סדר תצוגה</span><input type="number" class="inp mb0" id="g_ord" value="' + (g.sort_order || 0) + '"></label>' +
        ta('g_base', 'קו בסיס (מצב קיים)', g.baseline, 'תיאור המצב היום — נקודת הפתיחה') +
      '</div>' +
      '<h4 class="tla-sub">אנשי צוות המשתתפים ביישום התכנית</h4>' +
      '<p class="login-hint" style="margin:0 0 6px">כל איש צוות מקבל עמודה בטבלת היעדים למטה. אפשר לבחור מהרשימה או לכתוב חופשי.</p>' +
      '<div id="g_staff"></div>' +
      '<button class="btn-ghost sm" id="g_addstaff" type="button"><i class="bi bi-plus-lg"></i> איש צוות נוסף</button>' +
      '<div style="margin:12px 0 4px"><button class="btn-ghost sm" id="g_suggest" type="button">' +
        '<i class="bi bi-magic"></i> הצעה אוטומטית: מטרת על, יעדים וחלוקת עבודה</button>' +
        '<span class="login-hint" id="g_sugmsg" style="margin-inline-start:8px">לפי דף ההכנה, קו הבסיס ואנשי הצוות. ההצעה נכנסת לשדות לעריכה, ונשמרת רק בלחיצה על שמירה.</span></div>' +
      '<div class="form-grid" style="margin-top:6px">' + ta('g_top', 'מטרת על', g.top_goal) + '</div>' +
      '<h4 class="tla-sub">יעדים, חלוקת עבודה והערכה</h4>' +
      '<div class="tla-gridwrap"><table class="tla-egrid" id="g_grid"></table></div>' +
      '<button class="btn-ghost sm" id="g_addgoal" type="button"><i class="bi bi-plus-lg"></i> יעד נוסף</button>' +
      legacy +
      '<div class="form-grid" style="margin-top:10px">' +
        ta('g_rec', 'המלצות', g.recommendations) +
        ta('g_notes', 'הערות ושינויים משמעותיים במהלך השנה', g.notes) +
      '</div>';

    let el = null;
    // קורא את מה שמוקלד בעמוד אל M
    function readDom() {
      if (!el) return;
      const prev = M.staff;
      M.staff = [...el.querySelectorAll('.tla-staffrow')].map(r => {
        const sid = +r.dataset.sid;
        const old = prev.find(s => s.sid === sid) || {};
        return { sid: sid, who: r.querySelector('.g-staff-who').value.trim(), what: old.what || '' };
      });
      M.goals = [...el.querySelectorAll('#g_grid tr.tla-grow')].map(tr => {
        const x = { text: '', acts: {}, eval_form: '', eval_sum: '', notes: '' };
        tr.querySelectorAll('textarea').forEach(t => {
          if (t.dataset.f === 'act') x.acts[t.dataset.sid] = t.value;
          else x[t.dataset.f] = t.value;
        });
        return x;
      });
    }
    function drawStaff() {
      el.querySelector('#g_staff').innerHTML = M.staff.length ? M.staff.map(s =>
        '<div class="tla-staffrow" data-sid="' + s.sid + '"><div class="tla-srow">' +
        '<input class="inp mb0 g-staff-who" list="tlaStaff" placeholder="איש צוות" value="' + esc(s.who) + '">' +
        '<button type="button" class="mini danger g-staff-del" title="הסר איש צוות"><i class="bi bi-trash"></i></button></div>' +
        (s.what ? '<div class="tla-sdesc">תיאור כללי (מהגרסה הקודמת): ' + esc(s.what) + '</div>' : '') + '</div>').join('')
        : '<p class="login-hint">עדיין אין אנשי צוות. מוסיפים כאן, ואז כל אחד מקבל עמודה בטבלה.</p>';
    }
    function drawGrid() {
      const staffNow = M.staff;
      const head = '<thead><tr><th rowspan="2" style="width:22%">יעד</th>' +
        staffNow.map(s => '<th rowspan="2" style="min-width:150px"><span data-hname="' + s.sid + '">' + esc(s.who || 'איש צוות') + '</span></th>').join('') +
        '<th colspan="2">מעקב והערכה</th><th rowspan="2" style="width:17%">הערות ליעד</th>' +
        '<th rowspan="2" style="width:44px"></th></tr>' +
        '<tr><th style="width:15%">הערכה מעצבת</th><th style="width:15%">הערכה מסכמת</th></tr></thead>';
      const body = M.goals.length ? M.goals.map((x, i) => '<tr class="tla-grow" data-gi="' + i + '">' +
        '<td>' + taCell('text', x.text) + '</td>' +
        staffNow.map(s => '<td>' + taCell('act', x.acts[s.sid], s.sid) + '</td>').join('') +
        '<td>' + taCell('eval_form', x.eval_form) + '</td><td>' + taCell('eval_sum', x.eval_sum) + '</td>' +
        '<td>' + taCell('notes', x.notes) + '</td>' +
        '<td><button type="button" class="mini danger g-goal-del" title="מחק יעד"><i class="bi bi-trash"></i></button></td></tr>').join('')
        : '<tr><td colspan="' + (staffNow.length + 5) + '" class="login-hint">אין יעדים עדיין. מוסיפים יעד בכפתור שמתחת לטבלה.</td></tr>';
      const tb = el.querySelector('#g_grid');
      tb.innerHTML = head + '<tbody>' + body + '</tbody>';
      tb.querySelectorAll('textarea').forEach(growArea);
    }
    function focusLast(sel) {
      const all = el.querySelectorAll(sel);
      if (all.length) all[all.length - 1].focus();
    }

    // הצעה אוטומטית: מחזירה מטרת על, 3-4 יעדים, ולכל יעד מה כל איש צוות עושה
    async function suggest(btn) {
      const msg = el.querySelector('#g_sugmsg');
      const base = el.querySelector('#g_base').value.trim();
      if (!base) { window.UI.toast('קודם למלא את קו הבסיס', 'err'); return; }
      const topEl = el.querySelector('#g_top');
      readDom();
      const hasGoals = M.goals.some(x => x.text.trim());
      if ((topEl.value.trim() || hasGoals) && !confirm('ההצעה תחליף את מטרת העל והיעדים שכבר כתובים. ההערכות וההערות נשארות לפי סדר היעדים. להמשיך?')) return;
      const usingDefault = !M.staff.some(s => s.who);
      const who = usingDefault ? DEFAULT_ROLES.slice() : M.staff.filter(s => s.who).map(s => s.who);
      const domain = el.querySelector('#g_dom').value.trim();
      // נשלח: דף ההכנה, התחום, קו הבסיס ותפקידי הצוות. בלי שם התלמיד, ומוחקים ת"ז וטלפונים.
      const scrub = s => String(s || '').replace(/\b\d{9}\b/g, '[ת"ז]').replace(/\b0\d{1,2}-?\d{7}\b/g, '[טלפון]').trim();
      const pr = profOf(plan);
      const prep = PROF_FIELDS.filter(f => scrub(pr[f.k])).map(f => f.label + ': ' + scrub(pr[f.k])).join('\n');
      const prompt = 'את/ה יועץ/ת חינוכי/ת במכינה תורנית לנערים.\n' +
        (prep ? 'דף ההכנה של התלמיד:\n"""' + prep + '"""\n\n' : '') +
        'קו בסיס (מצב קיים)' + (domain ? ' בתחום "' + domain + '"' : '') + ':\n"""' + scrub(base) + '"""\n\n' +
        'המטרה והיעדים צריכים להישען גם על דף ההכנה (מוקדי הכח, המוקדים לחיזוק והרקע) וגם על קו הבסיס.\n' +
        'אנשי הצוות שעובדים עם התלמיד: ' + who.join(', ') + '.\n\n' +
        'כתוב/י בעברית פשוטה:\n' +
        '1. מטרת על אחת לשנה: כללית, אבל מדויקת וממוקדת בקו הבסיס. משפט אחד.\n' +
        '2. שלושה או ארבעה יעדים ישימים במהלך השנה, שמפרקים את מטרת העל. כל יעד קונקרטי וניתן למדידה.\n' +
        '3. לכל יעד: מה כל אחד מאנשי הצוות מהרשימה עושה כדי לקדם אותו (פעולה קצרה אחת או שתיים). להשתמש בשמות בדיוק כפי שנכתבו. אם איש צוות לא רלוונטי ליעד, אפשר להשאיר אותו ריק.\n' +
        '4. אל תכתוב הערכות.\n' +
        'החזר JSON בלבד בצורה: {"top_goal":"...","goals":[{"text":"...","acts":[{"who":"...","what":"..."}]}]}';
      btn.disabled = true; msg.textContent = 'חושב…';
      try {
        const r = await window.cv3call('gemini-2.5-flash', {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
        });
        const j = await r.json();
        const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('') || '';
        const out = JSON.parse(txt.replace(/^```(?:json)?\s*|\s*```$/g, ''));
        if (!out || !out.top_goal) throw new Error('לא התקבלה תשובה מהמודל');
        const goals = (Array.isArray(out.goals) ? out.goals : []).slice(0, 4).map(x => (typeof x === 'string')
          ? { text: x.trim(), acts: [] }
          : { text: String(x && x.text || '').trim(), acts: Array.isArray(x && x.acts) ? x.acts : [] }).filter(x => x.text);
        if (!goals.length) throw new Error('לא התקבלו יעדים');
        topEl.value = String(out.top_goal).trim();
        if (usingDefault) M.staff = DEFAULT_ROLES.map(w => ({ sid: M.nextSid++, who: w, what: '' }));
        // הערכות והערות נשארות לפי סדר היעדים, כדי שלא יאבדו
        const oldGoals = M.goals;
        M.goals = goals.map((x, i) => {
          const o = oldGoals[i] || {};
          const acts = {};
          x.acts.forEach(a => {
            const s = M.staff.find(q => q.who === String(a && a.who || '').trim());
            const w = String(a && a.what || '').trim();
            if (s && w) acts[s.sid] = w;
          });
          return { text: x.text, acts: acts, eval_form: o.eval_form || '', eval_sum: o.eval_sum || '', notes: o.notes || '' };
        });
        drawStaff(); drawGrid();
        msg.textContent = 'ההצעה מולאה. כדאי לעבור עליה ולתקן לפני השמירה.';
      } catch (e) {
        msg.textContent = 'ההצעה לא הצליחה: ' + (e && e.message || e);
      } finally { btn.disabled = false; }
    }

    const m = window.UI.modal({
      title: g.id ? 'עריכת תחום' : 'תחום חדש', bodyHTML: body, saveLabel: 'שמירה',
      onSave: async () => {
        readDom();
        const staffOk = M.staff.filter(s => s.who);
        const opps = staffOk.map(s => ({ who: s.who, what: s.what || '' }));
        const goalsOut = M.goals.map(x => ({
          text: x.text.trim(),
          acts: staffOk.map(s => ({ who: s.who, what: String(x.acts[s.sid] || '').trim() })).filter(a => a.what),
          eval_form: x.eval_form.trim(), eval_sum: x.eval_sum.trim(), notes: x.notes.trim(),
        })).filter(hasGoalContent);
        const lf = el.querySelector('#g_legevf'), ls = el.querySelector('#g_legevs');
        const row = {
          plan_id: plan.id,
          domain: el.querySelector('#g_dom').value.trim() || null,
          sort_order: +el.querySelector('#g_ord').value || 0,
          baseline: el.querySelector('#g_base').value.trim() || null,
          top_goal: el.querySelector('#g_top').value.trim() || null,
          goals_list: goalsOut,
          opps: opps,
          eval_form: lf ? (lf.value.trim() || null) : null,
          eval_sum: ls ? (ls.value.trim() || null) : null,
          recommendations: el.querySelector('#g_rec').value.trim() || null,
          notes: el.querySelector('#g_notes').value.trim() || null,
        };
        const r = g.id ? await S.update('tla_goals', g.id, row) : await S.add('tla_goals', row);
        if (!r.ok) { window.UI.toast('שגיאה: ' + (r.error || ''), 'err'); return false; }
        window.UI.toast('נשמר'); if (onDone) onDone(); return true;
      },
    });
    el = m.el;
    el.classList.add('tla-wide');

    el.addEventListener('input', e => {
      const t = e.target;
      if (t.tagName === 'TEXTAREA') growArea(t);
      if (t.classList && t.classList.contains('g-staff-who')) {
        const sid = t.closest('.tla-staffrow').dataset.sid;
        el.querySelectorAll('[data-hname="' + sid + '"]').forEach(s => { s.textContent = t.value.trim() || 'איש צוות'; });
      }
    });
    el.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('#g_addstaff')) {
        readDom(); M.staff.push({ sid: M.nextSid++, who: '', what: '' });
        drawStaff(); drawGrid(); focusLast('.g-staff-who'); return;
      }
      const sd = t.closest('.g-staff-del');
      if (sd) {
        readDom();
        const sid = +sd.closest('.tla-staffrow').dataset.sid;
        // יוסף 26/11: לא למחוק בטעות עמודה שכבר כתוב בה משהו
        const hasText = M.goals.some(gg => gg.acts && String(gg.acts[sid] || '').trim());
        if (hasText && !confirm('בעמודה של איש הצוות הזה כבר כתובות פעולות. להסיר אותו ואת מה שכתוב בעמודה?')) return;
        M.staff = M.staff.filter(s => s.sid !== sid);
        drawStaff(); drawGrid(); return;
      }
      if (t.closest('#g_addgoal')) {
        readDom(); M.goals.push({ text: '', acts: {}, eval_form: '', eval_sum: '', notes: '' });
        drawGrid(); focusLast('#g_grid tr.tla-grow [data-f="text"]'); return;
      }
      const gd = t.closest('.g-goal-del');
      if (gd) {
        readDom();
        const i = +gd.closest('tr').dataset.gi;
        const x = M.goals[i];
        const filled = x && (x.text.trim() || Object.values(x.acts).some(v => String(v).trim()) ||
          x.eval_form.trim() || x.eval_sum.trim() || x.notes.trim());
        if (filled && !await window.UI.confirm('למחוק את היעד הזה?')) return;
        M.goals.splice(i, 1);
        drawGrid(); return;
      }
      const sg = t.closest('#g_suggest');
      if (sg) suggest(sg);
    });

    drawStaff();
    drawGrid();
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
      '<label class="fld fld-wide"><span>הערה</span><textarea class="inp mb0 ta-auto" id="c_note" rows="3">' + esc(c.note || '') + '</textarea></label>' +
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
      '<div>כיתה: <b>' + esc(plan.class_label || '') + '</b></div></div>' +
      '<div class="cv-credit">מערכת ניהול תלמידים זו פותחה ע"י <b>יוסף שלום שניידר</b> · מעוניינים במערכת דומה למוסד שלכם? ' +
      '0556742853 · 6742853@gmail.com</div>' +
      '</section>';

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
    // יוסף 26/11: עמוד לכל תחום, לפי הטבלה של היועצת (A4 לרוחב). בלי תחומים — עמוד ריק להשלמה.
    (goals.length ? goals : [{}]).forEach(g => {
      const op = oppsArr(g);
      const gl = goalsObj(g);
      const blank = '<td style="height:12mm"></td>';
      const rowsHtml = (gl.length ? gl : [null, null, null, null]).map(x => x
        ? '<tr><td>' + esc(x.text) + '</td>' + op.map(o => '<td>' + esc(actOf(x, o.who)) + '</td>').join('') +
          '<td>' + esc(x.eval_form) + '</td><td>' + esc(x.eval_sum) + '</td><td>' + esc(x.notes) + '</td></tr>'
        : '<tr>' + blank + op.map(() => blank).join('') + blank + blank + blank + '</tr>').join('');
      const headTop = '<tr><th rowspan="2" style="width:' + (op.length ? '24%' : '40%') + '">יעדים</th>' +
        (op.length ? '<th colspan="' + op.length + '">הזדמנויות עבודה ואמצעים להשגתם</th>' : '') +
        '<th colspan="2">מעקב והערכה</th><th rowspan="2" style="width:16%">הערות</th></tr>';
      const headSub = '<tr>' + op.map(o => '<th class="sub">' + esc(o.who) +
          (o.what ? '<div class="nt">' + esc(o.what) + '</div>' : '') + '</th>').join('') +
        '<th class="sub" style="width:14%">הערכה מעצבת</th><th class="sub" style="width:14%">הערכה מסכמת</th></tr>';
      h += '<section class="page">' + hdr('תלי"א אינטגרטיבי — תכנית לימודים אישית') + meta +
        '<div class="band">תחום: <b>' + esc(g.domain || '') + '</b></div>' +
        '<div class="para"><b>קו בסיס:</b> ' + esc(g.baseline || '') + '</div>' +
        '<div class="para"><b>מטרת על:</b> ' + esc(g.top_goal || '') + '</div>' +
        '<table class="grid"><thead>' + headTop + headSub + '</thead><tbody>' + rowsHtml + '</tbody></table>' +
        ((g.eval_form || g.eval_sum)
          ? '<div class="para" style="margin-top:2mm"><b>הערכה כללית (מהגרסה הקודמת):</b> ' +
            (g.eval_form ? 'מעצבת: ' + esc(g.eval_form) + ' ' : '') + (g.eval_sum ? 'מסכמת: ' + esc(g.eval_sum) : '') + '</div>'
          : '') +
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
      // ⚠️ **לא position:absolute** — נבדק חי (02/09/2026) ומצא ש-.cover אינו תמיד
      // מגיע לגובה min-height המלא מחוץ להקשר הדפסה אמיתי, ואז "bottom:10mm"
      // נוחת בתוך שדות "שם התלמיד/כיתה" ומתנגש איתם. בזרימה רגילה עם margin-top
      // אי אפשר להתנגש בשום דבר, לא משנה גובה העמוד בפועל.
      '.cv-credit{margin-top:14mm;text-align:center;font-size:10.5pt;color:#a87830;' +
      'border-top:1px solid #e5d3b8;padding-top:3mm}' +
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
