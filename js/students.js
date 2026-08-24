// students.js — חלק 3: תלמידים וכיתות. רשימה + חיפוש/סינון + הוספה/עריכה/מחיקה + CSV.
// נתונים דרך window.db (Supabase) או דמו מקומי במצב DEMO.
(function () {
  'use strict';
  const DEMO = !window.sb;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // סכמת פרטי הרישום — מחולקת לקבוצות. משמשת גם להצגה בכרטיס וגם לעריכה. שדות שמורים ב-students.reg לפי התווית.
  const LONG_FIELDS = ['האם הרשימה הבאה חלה על בנכם', 'במידה וסימנתם אחד מהסימנים או יותר נא לפרט', 'הערות / בקשות / הוספות'];
  const REG_GROUPS = [
    { title: 'פרטי התלמיד', icon: 'bi-person-vcard', fields: ['שם התלמיד', 'משפחה', 'תעודת זהות', 'תאריך לידה עברי - שנה', 'תאריך לידה עברי - חודש', 'תאריך לידה עברי - יום', 'תאריך לידה לועזי', 'מקום לימודים נוכחי', 'כיתה', 'מספר ילדים בבית', 'מיקום הילד במשפחה'] },
    { title: 'כתובת', icon: 'bi-geo-alt', fields: ['עיר', 'רחוב', 'מספר', 'טלפון בבית'] },
    { title: 'פרטי האב', icon: 'bi-person', fields: ['שם האב', 'תעודת זהות אב', 'נייד אב', 'אימייל אב', 'ארץ לידה אב', 'מקום לימודים אב - ישיבה גדולה', 'עיסוק אב'] },
    { title: 'פרטי האם', icon: 'bi-person', fields: ['שם האם', 'שם משפחה קודם', 'תעודת זהות אם', 'נייד אם', 'אימייל אם', 'ארץ לידה אם', 'מקום לימודים אם - תיכון וסמינר', 'עיסוק אם'] },
    { title: 'פרטים מוסדיים', icon: 'bi-building', fields: ['שם מנהל', 'נייד רבה', 'שם בית הכנסת בו מתפללים בשבת', 'שם הרב של המשפחה', 'קופת חולים'] },
    { title: 'בריאות והערות', icon: 'bi-heart-pulse', fields: LONG_FIELDS },
  ];
  const regVal = (s, label) => (s && s.reg && s.reg[label] != null) ? String(s.reg[label]) : '';

  // כל הנתונים דרך המאגר המרכזי (store.js) — משותף עם שאר המודולים.
  async function getClasses() { return window.store.list('classes'); }
  async function getStudents() {
    // מודל עמנואל: כל צוות רואה את כל התלמידים; היקף הנתונים נאכף ב-RLS בשרת.
    //
    // ⚠️ ממוין כאן, במקום אחד, ולא בכל מסך בנפרד: כמעט כל המסכים (נוכחות,
    // מעקב, תל"א, טפסים, בוררי תלמיד, יצוא) שואבים דרך הפונקציה הזאת, ולפני
    // כן הם הציגו את סדר ההכנסה למסד — כלומר בלי סדר בכלל.
    // המיון לפי **שם משפחה**: העמודה `name` היא "פרטי + משפחה", ולכן מיון
    // לפיה בלבד הוא מיון לפי שם פרטי, וזה לא מה שמצפים ברשימת שיעור.
    const list = await window.store.list('students');
    return (list || []).slice().sort((a, b) =>
      String(a.family || '').localeCompare(String(b.family || ''), 'he') ||
      String(a.name || '').localeCompare(String(b.name || ''), 'he'));
  }
  async function saveStudent(row) { return row.id ? window.store.update('students', row.id, row) : window.store.add('students', row); }
  async function removeStudent(id) { return window.store.remove('students', id); }

  const classNameOf = (classes, id) => { const c = classes.find(x => x.id === id); return c ? c.name : ''; };

  async function render(page) {
    const [students, classes] = await Promise.all([getStudents(), getClasses()]);
    page.innerHTML =
      '<div class="page-head">' +
        '<button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
        '<h2>תלמידים</h2>' +
        '<div class="head-actions">' +
          '<button class="btn-primary sm" id="stuAdd"><i class="bi bi-plus-lg"></i> תלמיד חדש</button>' +
          '<button class="btn-ghost sm" id="stuCsv"><i class="bi bi-download"></i> ייצוא CSV</button>' +
        '</div>' +
      '</div>' +
      '<div class="toolbar">' +
        '<input type="search" class="inp mb0" id="stuSearch" placeholder="חיפוש תלמיד / הורה / טלפון…">' +
        '<select class="inp mb0" id="stuClass"><option value="">כל הכיתות</option>' +
          classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select>' +
        '<select class="inp mb0" id="stuStatus"><option value="">כל הסטטוסים</option><option value="פעיל">פעיל</option><option value="לא פעיל">לא פעיל</option></select>' +
        (window.cv3Sort ? window.cv3Sort.bar('stu') : '') +
      '</div>' +
      '<div class="count-line" id="stuCount"></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th style="width:44px">#</th><th>שם</th><th>כיתה</th><th>הורה</th><th>טלפון</th><th>סטטוס</th><th></th>' +
      '</tr></thead><tbody id="stuBody"></tbody></table></div>' +
      '<div id="stuEmpty" class="empty-state" hidden><i class="bi bi-people"></i><div>אין תלמידים להצגה</div></div>';

    // ── מיון ──────────────────────────────────────────────────────────────
    // העמודה `name` היא "פרטי + משפחה" ("דוד אריה אוליאל"), ולכן מיון לפיה
    // הוא מיון לפי שם פרטי. ברשימת שיעור מצפים לשם משפחה — וזו ברירת המחדל.
    const he = (a, b) => String(a || '').localeCompare(String(b || ''), 'he');
    const famOf = s => String(s.family || '').trim();
    const clsOf = s => classNameOf(classes, s.class_id) || 'ללא שיעור';

    function draw() {
      const q = (page.querySelector('#stuSearch').value || '').trim();
      const cf = page.querySelector('#stuClass').value;
      const sf = page.querySelector('#stuStatus').value;
      let rows = students.slice();
      if (q) rows = rows.filter(s => [s.name, s.family, s.parent_name, s.parent_phone].join(' ').includes(q));
      if (cf) rows = rows.filter(s => String(s.class_id) === cf);
      if (sf) rows = rows.filter(s => (s.status || '') === sf);

      const tr = (s, n) =>
        '<tr>' +
        '<td class="idx">' + n + '</td>' +
        '<td><span class="ava">' + esc((s.name || '?').slice(0, 2)) + '</span> <span class="name-link" data-view="' + s.id + '">' + esc(s.name) + '</span></td>' +
        '<td>' + esc(classNameOf(classes, s.class_id)) + '</td>' +
        '<td>' + esc(s.parent_name) + '</td>' +
        '<td>' + (s.parent_phone ? '<a href="tel:' + esc(s.parent_phone) + '">' + esc(s.parent_phone) + '</a>' : '') + '</td>' +
        '<td><span class="chip ' + (s.status === 'פעיל' ? 'ok' : 'off') + '">' + esc(s.status || '') + '</span></td>' +
        '<td class="row-act"><button class="mini" data-view="' + s.id + '" title="פרטים"><i class="bi bi-eye"></i></button>' +
        '<button class="mini" data-edit="' + s.id + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
        ((window.currentUser || {}).role === 'מנהל' ? '<button class="mini danger" data-del="' + s.id + '" title="מחיקה"><i class="bi bi-trash"></i></button>' : '') + '</td>' +
        '</tr>';

      const body = page.querySelector('#stuBody');
      // מיון וקיבוץ דרך המודול המשותף — אותה התנהגות בדיוק בכל המסכים
      body.innerHTML = window.cv3Sort
        ? window.cv3Sort.rows(page, 'stu', rows, clsOf, tr, 7)
        : rows.map((s, i) => tr(s, i + 1)).join('');
      page.querySelector('#stuCount').textContent = rows.length + ' מתוך ' + students.length + ' תלמידים';
      page.querySelector('#stuEmpty').hidden = rows.length > 0;
      body.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => openDetail(students.find(s => s.id == b.dataset.view))));
      body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(students.find(s => s.id == b.dataset.edit))));
      body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => del(students.find(s => s.id == b.dataset.del))));
    }

    async function openDetail(s) {
      if (!s) return;
      const m = window.UI.modal({ title: 'כרטיס תלמיד', bodyHTML: '<div style="padding:26px;text-align:center;color:var(--muted)"><i class="bi bi-hourglass-split"></i> טוען…</div>' });
      // ⚠️ סדר המשתנים חייב להתאים אחד-לאחד לסדר ההבטחות למטה. כשהוסר
      // שכר הלימוד נשאר כאן משתנה מיותר, וכל מה שאחריו הוזז במקום אחד:
      // קטגוריות הקריאה הוצגו כ"משימות" ותיק המסמכים נעלם. אין להוסיף או
      // להסיר כאן שורה בלי לעדכן את שני הצדדים יחד.
      const [cats, beh, att, tst, fnc, med, cnv, mtg, rdg, wrt, tsk, raCats, raAssess, tlaData, frmRes, frmAll, voice, sdocs, psp] = await Promise.all([
        window.store.list('categories'),
        window.store.byStudent('behavior_events', s.id), window.store.byStudent('attendance', s.id),
        window.store.byStudent('tests', s.id), window.store.byStudent('functioning', s.id),
        window.store.byStudent('medications', s.id), window.store.byStudent('conversations', s.id),
        window.store.byStudent('meetings', s.id), window.store.byStudent('reading', s.id), window.store.byStudent('writing', s.id),
        window.store.byStudent('tasks', s.id),
        (window.cv3ReadAssess ? window.cv3ReadAssess.cats() : Promise.resolve([])),
        (window.cv3ReadAssess ? window.cv3ReadAssess.forStudent(s.id) : Promise.resolve([])),
        (window.cv3Tla ? window.cv3Tla.forStudent(s.id) : Promise.resolve({ plans: [], goals: [] })),
        window.store.byStudent('form_responses', s.id), window.store.list('forms'),
        ((!window.Auth || window.Auth.canAccess('voicereports')) ? window.store.byStudent('voice_reports', s.id) : Promise.resolve([])),
        (window.cv3StudentDocs ? window.cv3StudentDocs.forStudent(s.id) : Promise.resolve([])),
        window.store.byStudent('passport', s.id),
      ]);
      const canTla = !window.Auth || window.Auth.canAccess('tla');
      const catName = id => { const c = cats.find(x => x.id == id); return c ? c.name : ''; };
      const row = (lbl, val) => val ? '<div class="det-row"><span class="det-lbl">' + lbl + '</span><span class="det-val">' + esc(val) + '</span></div>' : '';
      const sevc = x => x === 'גבוהה' ? 'hi' : x === 'נמוכה' ? 'lo' : 'mid';
      const li = (main, meta, dot) => '<div class="det-item">' + (dot ? '<span class="sev-dot ' + dot + '"></span>' : '') + '<span class="di-main">' + main + '</span><span class="di-meta">' + esc(meta || '') + '</span></div>';
      // מציג את כל הרשומות מהחדשה לישנה, אבל בגובה של כחמש שורות ועם גלילה
      // פנימית. קודם הוצגו ארבע בלבד והשאר פשוט לא היו נגישים; מצד שני תלמיד
      // עם 100 דיווחים היה מותח את הכרטיס לאורך אינסופי.
      const sec = (title, icon, items, fmt) => {
        if (!items.length) return '';
        const body = items.slice().reverse().map(fmt).join('');
        return '<div class="det-sec"><h4><i class="bi ' + icon + '"></i> ' + title +
          ' <span class="det-badge">' + items.length + '</span>' +
          (items.length > 5 ? '<span class="det-hint">5 אחרונים · גלול לעוד</span>' : '') +
          '</h4>' + (items.length > 5 ? '<div class="det-scroll">' + body + '</div>' : body) + '</div>';
      };
      const attC = { present: 0, late: 0, absent: 0 }; att.forEach(a => attC[a.status] != null && attC[a.status]++);
      // משימות הקשורות לתלמיד — תאריך יעד בעברית + צ'יפ סטטוס (מראה זהה לסקשנים קריאה/כתיבה/מבחנים)
      const hebDate = iso => window.UI.hebDate(iso, { year: false });
      const taskLbl = st => st === 'done' ? 'הושלם' : st === 'in_progress' ? 'בתהליך' : 'לביצוע';
      const taskChip = st => '<span class="chip ' + (st === 'done' ? 'ok' : 'off') + '">' + taskLbl(st) + '</span>';
      const tasksSec = '<div class="det-sec"><h4><i class="bi bi-kanban"></i> משימות הקשורות <span class="det-badge">' + tsk.length + '</span></h4>' +
        (tsk.length ? tsk.slice(-4).reverse().map(t => li('<strong>' + esc(t.title) + '</strong> ' + taskChip(t.status), hebDate(t.due_date))).join('')
          : '<div class="tl-note" style="padding:6px 2px;font-size:.84rem">אין משימות משויכות</div>') + '</div>';
      // ── נוכחות: אחוזים + פירוט אחרון (היה: שורת ספירה בלבד, בלי תאריכים ובלי אחוז) ──
      const attTot = attC.present + attC.late + attC.absent;
      const attPct = (a, b) => b ? Math.round((a / b) * 100) : 0;
      const attStatus = { present: ['נוכח', 'lo'], late: ['איחור', 'mid'], absent: ['נעדר', 'hi'] };
      const gregDate = x => { const mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x || '')); return mm ? mm[3] + '/' + mm[2] + '/' + mm[1] : (x || ''); };
      const attSec = !attTot ? '' :
        '<div class="det-sec"><h4><i class="bi bi-calendar-check"></i> נוכחות <span class="det-badge">' + attTot + '</span></h4>' +
        '<div class="det-grid">' +
          '<div class="det-row"><span class="det-lbl">אחוז הגעה</span><span class="det-val"><span class="chip ' +
            (attPct(attC.present + attC.late, attTot) >= 90 ? 'ok' : 'off') + '">' + attPct(attC.present + attC.late, attTot) + '%</span></span></div>' +
          '<div class="det-row"><span class="det-lbl">אחוז בזמן</span><span class="det-val"><span class="chip ' +
            (attPct(attC.present, attTot) >= 90 ? 'ok' : 'off') + '">' + attPct(attC.present, attTot) + '%</span></span></div>' +
          '<div class="det-row"><span class="det-lbl">נוכח</span><span class="det-val">' + attC.present + '</span></div>' +
          '<div class="det-row"><span class="det-lbl">איחורים</span><span class="det-val">' + attC.late + '</span></div>' +
          '<div class="det-row"><span class="det-lbl">היעדרויות</span><span class="det-val">' + attC.absent + '</span></div>' +
        '</div>' +
        att.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-5).reverse().map(a => {
          const st = attStatus[a.status] || ['—', 'mid'];
          return li('<strong>' + esc(st[0]) + '</strong>' + (a.note ? ' — ' + esc(a.note) : ''),
            (hebDate(a.date) || '') + ' · ' + gregDate(a.date), st[1]);
        }).join('') + '</div>';

      // ── טפסים וחתימות ──
      const formTitle = id => { const f = (frmAll || []).find(x => x.id == id); return f ? f.title : 'טופס'; };
      const frmSec = !(frmRes && frmRes.length) ? '' :
        '<div class="det-sec"><h4><i class="bi bi-file-earmark-check"></i> טפסים וחתימות <span class="det-badge">' + frmRes.length + '</span></h4>' +
        frmRes.slice().reverse().slice(0, 5).map(r => li(
          '<strong>' + esc(formTitle(r.form_id)) + '</strong> <span class="chip ' + (r.status === 'signed' ? 'ok' : 'off') + '">' +
          (r.status === 'signed' ? 'נחתם' : 'ממתין') + '</span>' + (r.signer_name ? ' — ' + esc(r.signer_name) : ''),
          r.signed_at ? (hebDate(String(r.signed_at).slice(0, 10)) || gregDate(r.signed_at)) : '', r.status === 'signed' ? 'lo' : 'mid'
        )).join('') + '</div>';

      // ── דיווחים קוליים (רק למי שרשאי למסך) ──
      const vSec = !(voice && voice.length) ? '' :
        '<div class="det-sec"><h4><i class="bi bi-mic-fill"></i> דיווחים קוליים <span class="det-badge">' + voice.length + '</span></h4>' +
        voice.slice().reverse().slice(0, 4).map(v => li(
          '<strong>' + esc(v.report_type || 'דיווח') + '</strong>' + (v.teacher_name ? ' · ' + esc(v.teacher_name) : '') +
          (v.report_text ? ' — ' + esc(String(v.report_text).slice(0, 140)) : ''),
          v.created_at ? gregDate(String(v.created_at).slice(0, 10)) : '', sevc(v.severity)
        )).join('') + '</div>';

      // פרטי רישום — מחולקים יפה לקבוצות (תלמיד / כתובת / אב / אם / מוסדי / בריאות). כל קבוצה מוצגת רק אם יש בה נתונים.
      const hasReg = s.reg && typeof s.reg === 'object' && Object.keys(s.reg).length;
      const regSec = !hasReg ? '' : REG_GROUPS.map(g => {
        const rows = g.fields.map(label => {
          const v = regVal(s, label);
          if (!v.trim() || /^data:image\//.test(v)) return '';
          return '<div class="det-row"><span class="det-lbl">' + esc(label) + '</span><span class="det-val">' + esc(v) + '</span></div>';
        }).filter(Boolean).join('');
        return rows ? '<div class="det-sec"><h4><i class="bi ' + g.icon + '"></i> ' + esc(g.title) + '</h4><div class="det-grid">' + rows + '</div></div>' : '';
      }).join('') + (function () {
        if (!hasReg) return '';
        const known = {}; REG_GROUPS.forEach(g => g.fields.forEach(l => known[l] = 1));
        const extra = Object.keys(s.reg).filter(k => !known[k] && String(s.reg[k] == null ? '' : s.reg[k]).trim() && !/^data:image\//.test(String(s.reg[k])));
        if (!extra.length) return '';
        return '<div class="det-sec"><h4><i class="bi bi-list-ul"></i> פרטים נוספים</h4><div class="det-grid">' +
          extra.map(k => '<div class="det-row"><span class="det-lbl">' + esc(k) + '</span><span class="det-val">' + esc(s.reg[k]) + '</span></div>').join('') + '</div></div>';
      })();
      // פאנלי מייל + דרייב (חיפוש לפי כתובת ההורים / שם התלמיד)
      const pEmails = [regVal(s, 'אימייל אב'), regVal(s, 'אימייל אם')].map(x => x.trim()).filter(Boolean);
      const gmailQ = pEmails.map(e => 'from:(' + e + ') OR to:(' + e + ')').join(' OR ');
      const gmailUrl = gmailQ ? 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(gmailQ) : '';
      const driveUrl = 'https://drive.google.com/drive/u/0/search?q=' + encodeURIComponent(s.name || '');
      const linksHTML =
        '<div class="stu-links">' +
          '<div class="stu-link-col">' +
            '<h4><i class="bi bi-envelope"></i> מיילים עם ההורים</h4>' +
            (pEmails.length ? '<p class="sub">' + esc(pEmails.join(' · ')) + '</p>' : '<p class="sub">אין כתובת מייל בכרטיס</p>') +
            (gmailUrl ? '<a class="btn-ghost sm" href="' + esc(gmailUrl) + '" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-left"></i> פתח בג׳ימייל</a>' : '') +
            '<div class="stu-link-results" id="stuMailRes"></div>' +
          '</div>' +
          '<div class="stu-link-col">' +
            '<h4><i class="bi bi-folder2-open"></i> קבצים בדרייב</h4>' +
            '<p class="sub">חיפוש: ' + esc(s.name || '') + '</p>' +
            '<a class="btn-ghost sm" href="' + esc(driveUrl) + '" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-left"></i> פתח בדרייב</a>' +
            '<div class="stu-link-results" id="stuDriveRes"></div>' +
          '</div>' +
        '</div>';
      m.el.querySelector('.modal-body').innerHTML =
        '<div class="det-head"><span class="ava lg">' + esc((s.name || '?').slice(0, 2)) + '</span>' +
        '<div><div class="det-name">' + esc(s.name) + '</div><span class="chip ' + (s.status === 'פעיל' ? 'ok' : 'off') + '">' + esc(s.status || '') + '</span></div></div>' +
        '<div class="det-grid">' + row('כיתה', classNameOf(classes, s.class_id)) + row('שם הורה', s.parent_name) +
          (s.parent_phone ? '<div class="det-row"><span class="det-lbl">טלפון</span><span class="det-val"><a href="tel:' + esc(s.parent_phone) + '">' + esc(s.parent_phone) + '</a></span></div>' : '') +
          row('הערות', s.notes) + '</div>' +
        '<div class="det-stats">' +
          '<div class="ds"><b>' + beh.length + '</b><span>דיווחים</span></div>' +
          '<div class="ds"><b>' + attC.present + '</b><span>נוכחות</span></div>' +
          '<div class="ds"><b>' + tst.length + '</b><span>מבחנים</span></div>' +
          '<div class="ds"><b>' + (med.length ? '⚠' : '—') + '</b><span>רפואי</span></div>' +
        '</div>' +
        // ── מה שרואים תמיד: המידע שבגללו פותחים כרטיס ──
        '<div class="det-sec"><h4><i class="bi bi-stars"></i> סיכום AI</h4>'
          + '<div id="aiStuSum"></div></div>' +
        // רפואי מופרד לשלושה סוגים (ראה js/medical.js): רגישות היא לא תרופה,
        // ובכרטיס צריך לראות מיד מה אסור לתת לו.
        sec('רגישויות ואלרגיות', 'bi-exclamation-octagon', med.filter(x => x.category === 'רגישות'),
          x => li('<strong>' + esc(x.name) + '</strong>' + (x.details ? ' — ' + esc(x.details) : ''), '', 'hi')) +
        sec('מצב רפואי', 'bi-heart-pulse', med.filter(x => x.category === 'מצב רפואי'),
          x => li('<strong>' + esc(x.name) + '</strong>' + (x.details ? ' — ' + esc(x.details) : ''), '', 'mid')) +
        sec('נטילת תרופות', 'bi-capsule', med.filter(x => (x.category || 'תרופה') === 'תרופה'), x => {
          const f = window.cv3Medical ? window.cv3Medical.freshness(x) : { txt: '', cls: 'off' };
          const parts = [x.purpose, x.dose && ('מינון ' + x.dose), x.hours && (x.hours + ' שעות'),
            x.take_time, x.take_how, x.second ? 'כדור נוסף בצהריים' : ''].filter(Boolean);
          return li('<strong>' + esc(x.name) + '</strong>' + (parts.length ? ' — ' + esc(parts.join(' · ')) : '') +
            ' <span class="chip ' + f.cls + '">' + esc(f.txt) + '</span>', '', 'hi');
        }) +
        sec('התנהגות ומעקב', 'bi-clipboard-check', beh, e => li('<strong>' + esc(catName(e.category_id)) + '</strong>' + (e.note ? ' — ' + esc(e.note) : ''), e.event_date, sevc(e.severity))) +
        attSec +
        (window.cv3Passport ? window.cv3Passport.cardSection(psp) : '') +
        // תל"א מוצג רק למי שיש לו גישה למסך תל"א (מלמד — לא).
        ((window.cv3Tla && canTla) ? window.cv3Tla.cardSection(tlaData.plans, tlaData.goals) : '') +
        (window.cv3StudentDocs ? window.cv3StudentDocs.cardSection(sdocs) : '') +
        // ── כל השאר מאחורי "הרחב": פרטי הרישום המלאים וההיסטוריה ──
        '<button class="btn-ghost sm det-more-btn" id="stuMoreBtn" type="button">' +
          '<i class="bi bi-chevron-down"></i> <span>הצג את כל הנתונים</span></button>' +
        '<div id="stuMore" hidden>' +
          regSec +
          linksHTML +
          sec('מבחנים', 'bi-card-checklist', tst, t => li(esc(t.subject) + ' · <strong>' + esc(t.grade) + '</strong>', t.date)) +
          sec('ציוני תפקוד', 'bi-bar-chart-line', fnc, f => li(esc(f.area) + ' · <strong>' + esc(f.score) + '</strong>', f.date)) +
          sec('שיחות', 'bi-chat-dots', cnv, c => li(esc(c.summary), c.date)) +
          sec('אסיפות הורים', 'bi-people', mtg, x => li(esc(x.summary), x.date)) +
          sec('קריאה', 'bi-book', rdg, x => li('רמה: ' + esc(x.level) + (x.note ? ' — ' + esc(x.note) : ''), x.date)) +
          sec('כתיבה', 'bi-pencil-square', wrt, x => li('רמה: ' + esc(x.level), x.date)) +
          (window.cv3ReadAssess ? window.cv3ReadAssess.cardSection(raCats, raAssess) : '') +
          frmSec + vSec + tasksSec +
        '</div>' +
        '<div class="det-actions" style="margin-top:14px">' +
          '<button class="btn-primary sm" data-edit2><i class="bi bi-pencil"></i> עריכת פרטים</button>' +
          '<button class="btn-ghost sm" data-reading><i class="bi bi-book-half"></i> מעקב קריאה</button>' +
          '<button class="btn-ghost sm" data-cert><i class="bi bi-award"></i> אישור לימודים</button>' +
          (canTla ? '<button class="btn-ghost sm" data-tla><i class="bi bi-journal-bookmark"></i> תל"א</button>' : '') +
          '<button class="btn-ghost sm" data-docs><i class="bi bi-folder2-open"></i> תיק מסמכים</button>' +
          '<button class="btn-ghost sm" data-pdf2><i class="bi bi-file-earmark-pdf"></i> הורד PDF</button>' +
          '<button class="btn-ghost sm" data-print2><i class="bi bi-printer"></i> הדפסה</button>' +
          '<button class="btn-ghost sm" data-go="behavior"><i class="bi bi-plus-lg"></i> דיווח חדש</button>' +
        '</div>';
      // "הצג את כל הנתונים" — הכרטיס נפתח על העיקר, וכל השאר בלחיצה אחת.
      const moreBtn = m.el.querySelector('#stuMoreBtn'), moreBox = m.el.querySelector('#stuMore');
      if (moreBtn && moreBox) moreBtn.addEventListener('click', () => {
        const open = moreBox.hidden;
        moreBox.hidden = !open;
        moreBtn.querySelector('span').textContent = open ? 'הסתר את הנתונים המלאים' : 'הצג את כל הנתונים';
        moreBtn.querySelector('i').className = open ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
        if (open) moreBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      m.el.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => { m.close(); showPage(btn.dataset.go); }));
      const eb = m.el.querySelector('[data-edit2]'); if (eb) eb.addEventListener('click', () => { m.close(); openForm(s); });
      // הדפסה של הכרטיס בלבד — קודם window.print() הדפיס את כל הדף שמאחורי המודאל
      // הורדת הכרטיס כ-PDF — אותו תוכן שמודפס, בלי לעבור דרך חלון ההדפסה
      if (window.cv3Pdf) window.cv3Pdf.wire(m.el.querySelector('[data-pdf2]'),
        () => m.el.querySelector('.modal-body') || m.el,
        () => 'כרטיס תלמיד - ' + (window.UI.fullName ? window.UI.fullName(s) : s.name));
      const pb = m.el.querySelector('[data-print2]');
      if (pb) pb.addEventListener('click', () => {
        document.body.classList.add('printing-card');
        const done = () => document.body.classList.remove('printing-card');
        window.addEventListener('afterprint', done, { once: true });
        setTimeout(done, 8000);   // דפדפנים שלא יורים afterprint
        window.print();
      });
      const rab = m.el.querySelector('[data-reading]'); if (rab && window.cv3ReadAssess) rab.addEventListener('click', () => window.cv3ReadAssess.openAssessment(s, () => { m.close(); openDetail(s); }));
      const ctb = m.el.querySelector('[data-cert]'); if (ctb && window.cv3Cert) ctb.addEventListener('click', () => window.cv3Cert.openCertificate(s));
      const tlb = m.el.querySelector('[data-tla]'); if (tlb && window.cv3Tla) tlb.addEventListener('click', () => { m.close(); window.cv3Tla.openForStudent(s); });
      // סיכום AI נטען אחרי שהכרטיס כבר על המסך, כדי לא לעכב את הפתיחה
      if (window.cv3AI) setTimeout(() => window.cv3AI.renderStudent(m.el.querySelector('#aiStuSum'), s), 60);
      const dcb = m.el.querySelector('[data-docs]');
      if (dcb && window.cv3StudentDocs) dcb.addEventListener('click', () => { m.close(); window.cv3StudentDocs.openManager(s, () => {}); });

      // ---------- מייל+דרייב מתוך Supabase (אונדקסו ע"י Apps Script בענן — עוקף חסימת NetFree) ----------
      m.el.classList.add('modal-wide');
      if (window.sb) {
        const mailEl = m.el.querySelector('#stuMailRes'), driveEl = m.el.querySelector('#stuDriveRes');
        const load = el => { if (el) el.innerHTML = '<div class="ld"><i class="bi bi-hourglass-split"></i> טוען…</div>'; };
        const renderMail = items => {
          if (!mailEl) return;
          if (!pEmails.length) { mailEl.innerHTML = '<div class="ld">אין כתובת מייל בכרטיס</div>'; return; }
          if (!items || !items.length) { mailEl.innerHTML = '<div class="ld">אין מיילים (או טרם עודכן)</div>'; return; }
          mailEl.innerHTML = items.slice(0, 100).map(it =>
            '<details class="r-item"><summary><span class="r-t">' + esc(it.subject || '(ללא נושא)') + '</span>' +
            '<div class="r-m">' + esc(it.from || '') + ' · ' + esc(it.date || '') + '</div>' +
            (it.snippet ? '<div class="r-snip">' + esc(it.snippet) + '</div>' : '') + '</summary>' +
            (it.body ? '<pre class="r-full">' + esc(it.body) + '</pre>' : '<div class="r-m" style="padding:6px 0">אין תוכן שמור</div>') +
            (it.link ? '<a class="r-open" href="' + esc(it.link) + '" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-left"></i> פתח וענה בג׳ימייל</a>' : '') +
            '</details>').join('');
        };
        const renderDrive = items => {
          if (!driveEl) return;
          if (!items || !items.length) { driveEl.innerHTML = '<div class="ld">אין קבצים (או טרם עודכן)</div>'; return; }
          driveEl.innerHTML = items.slice(0, 100).map(it =>
            '<a class="r-item r-file" href="' + esc(it.link || '#') + '" target="_blank" rel="noopener"><span class="r-t"><i class="bi bi-file-earmark"></i> ' + esc(it.name || '') + '</span>' +
            '<span class="r-m">' + esc(it.type || '') + (it.modified ? ' · ' + esc(it.modified) : '') + '</span></a>').join('');
        };
        load(mailEl); load(driveEl);
        (async () => {
          let mails = [], files = [];
          try {
            const { data } = await window.sb.from('student_links').select('mails,files').eq('student_id', s.id).maybeSingle();
            if (data) { mails = data.mails || []; files = data.files || []; }
          } catch (_) {}
          renderMail(mails); renderDrive(files);
        })();
      }
    }

    function openForm(existing) {
      const s = existing || {};
      const classOpts = classes.map(c => '<option value="' + c.id + '"' + (s.class_id === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
      const regFields = [];   // מיפוי id→תווית לאיסוף בשמירה
      const fieldHTML = (label) => {
        const id = 'rg_' + regFields.length; regFields.push({ id: id, label: label });
        const val = esc(regVal(s, label));
        const isLong = LONG_FIELDS.indexOf(label) >= 0;
        const input = isLong
          ? '<textarea class="inp mb0" id="' + id + '" rows="2">' + val + '</textarea>'
          : '<input class="inp mb0" id="' + id + '" value="' + val + '">';
        return '<label class="fld' + (isLong ? ' fld-wide' : '') + '"><span>' + esc(label) + (label === 'שם התלמיד' ? ' *' : '') + '</span>' + input + '</label>';
      };
      const groupsHTML = REG_GROUPS.map(g =>
        '<div class="det-sec"><h4><i class="bi ' + g.icon + '"></i> ' + esc(g.title) + '</h4><div class="form-grid">' +
        g.fields.map(fieldHTML).join('') + '</div></div>'
      ).join('');
      const body =
        '<div class="det-sec"><h4><i class="bi bi-gear"></i> מערכת</h4><div class="form-grid">' +
        '<label class="fld"><span>כיתה במערכת</span><select class="inp mb0" id="f_class"><option value="">—</option>' + classOpts + '</select></label>' +
        '<label class="fld"><span>סטטוס</span><select class="inp mb0" id="f_status"><option' + (s.status !== 'לא פעיל' ? ' selected' : '') + '>פעיל</option><option' + (s.status === 'לא פעיל' ? ' selected' : '') + '>לא פעיל</option></select></label>' +
        '<label class="fld fld-wide"><span>הערות פנימיות (צוות)</span><textarea class="inp mb0" id="f_notes" rows="2">' + esc(s.notes) + '</textarea></label>' +
        '</div></div>' +
        groupsHTML;
      window.UI.modal({
        title: existing ? 'עריכת תלמיד' : 'תלמיד חדש', bodyHTML: body, saveLabel: 'שמירה',
        onSave: async (m) => {
          const reg = Object.assign({}, s.reg || {});   // שימור שדות מיובאים שאינם בטופס
          regFields.forEach(function (fld) { const el = m.querySelector('#' + fld.id); if (!el) return; const v = el.value.trim(); if (v) reg[fld.label] = v; else delete reg[fld.label]; });
          const first = (reg['שם התלמיד'] || '').trim(), family = (reg['משפחה'] || '').trim();
          const fullName = first ? (family ? first + ' ' + family : first) : (s.name || '').trim();
          if (!fullName) { window.UI.toast('נא להזין שם התלמיד', 'err'); return false; }
          const row = {
            name: fullName,
            family: family || null,
            tz: (reg['תעודת זהות'] || '').trim() || null,
            parent_name: (reg['שם האב'] || reg['שם האם'] || '').trim() || null,
            parent_phone: (reg['נייד אב'] || reg['נייד אם'] || reg['טלפון בבית'] || '').trim() || null,
            mother_name: (reg['שם האם'] || '').trim() || null,
            mother_phone: (reg['נייד אם'] || '').trim() || null,
            mother_email: (reg['אימייל אם'] || '').trim() || null,
            birthdate_heb: [reg['תאריך לידה עברי - יום'], reg['תאריך לידה עברי - חודש'], reg['תאריך לידה עברי - שנה']].map(function (x) { return (x || '').trim(); }).filter(Boolean).join(' ') || null,
            class_id: m.querySelector('#f_class').value ? Number(m.querySelector('#f_class').value) : null,
            status: m.querySelector('#f_status').value,
            notes: m.querySelector('#f_notes').value.trim(),
            reg: reg,
          };
          if (existing) row.id = existing.id;
          const r = await saveStudent(row);
          if (!r.ok) { window.UI.toast('שגיאה: ' + (r.error || ''), 'err'); return false; }
          window.UI.toast(existing ? 'עודכן' : 'נוסף תלמיד');
          if (existing) Object.assign(existing, row); else students.push((r.data && r.data[0]) || row);
          draw();
          return true;
        },
      });
    }

    async function del(s) {
      if (!s) return;
      const ok = await window.UI.confirm('למחוק את "' + esc(s.name) + '"? הפעולה אינה הפיכה.');
      if (!ok) return;
      const r = await removeStudent(s.id);
      if (!r.ok) { window.UI.toast('שגיאה במחיקה', 'err'); return; }
      const i = students.indexOf(s); if (i >= 0) students.splice(i, 1);
      window.UI.toast('נמחק'); draw();
    }

    function exportCsv() {
      const head = ['שם', 'כיתה', 'הורה', 'טלפון', 'סטטוס'];
      const lines = [head.join(',')].concat(students.map(s =>
        [s.name, classNameOf(classes, s.class_id), s.parent_name, s.parent_phone, s.status].map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'students.csv'; a.click();
    }

    page.querySelector('#stuAdd').addEventListener('click', () => openForm(null));
    page.querySelector('#stuCsv').addEventListener('click', exportCsv);
    // select ו-checkbox משדרים change, לא input — בלי זה המיון לא היה מגיב
    ['#stuSearch', '#stuClass', '#stuStatus', '#stuSort', '#stuGroup'].forEach(sel => {
      const el = page.querySelector(sel);
      el.addEventListener('input', draw);
      el.addEventListener('change', draw);
    });
    draw();
  }

  async function addClass(name) { const r = await window.store.add('classes', { name }); return { ok: r.ok, id: r.data && r.data[0] && r.data[0].id }; }
  // מודל עמנואל: כל צוות רואה את כל התלמידים; היקף הנתונים נאכף ב-RLS. null = הכל.
  async function accessibleIds() { return null; }
  window.cv3Students = { getStudents: getStudents, getClasses: getClasses, addClass: addClass, accessibleIds: accessibleIds };
  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.students = render;
})();
