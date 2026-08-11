// store.js — מאגר נתונים מרכזי משותף לכל המודולים.
// DEMO: בזיכרון עם seed עשיר ומקושר (מאפשר כרטיס תלמיד מלא + סטטיסטיקות אמיתיות).
// חי: מנתב ל-window.db (Supabase + RLS).
(function () {
  'use strict';
  const DEMO = !window.sb;
  const T = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  // ---------- seed דמו (שמות פיקטיביים בלבד) ----------
  const seed = {
    classes: [
      { id: 1, name: 'כיתה א׳' }, { id: 2, name: 'כיתה ב׳' }, { id: 3, name: 'כיתה ג׳' },
      { id: 4, name: 'כיתה ד׳' }, { id: 5, name: 'כיתה ה׳' }, { id: 6, name: 'כיתה ו׳' },
    ],
    // כניסה לפי שם; סיסמה ראשונית = מספר טלפון (המשתמש משנה אחר-כך)
    users: [
      { id: 1, name: 'עמנואל רקובסקי', phone: '0548451402', password: '0548451402', role: 'מנהל' },
      { id: 2, name: 'משה רביבו', phone: '0583256040', password: '0583256040', role: 'מחנך' },
      { id: 3, name: 'זאבי לוונשטיין', phone: '0583288616', password: '0583288616', role: 'מחנך' },
      { id: 4, name: 'דוד וינברגר', phone: '0548446682', password: '0548446682', role: 'מחנך' },
      { id: 5, name: 'רפאל פלדמן', phone: '0548442649', password: '0548442649', role: 'מחנך' },
      { id: 6, name: 'יעקב שפירא', phone: '0583234573', password: '0583234573', role: 'מחנך' },
      { id: 7, name: 'משה קופמן', phone: '0527153995', password: '0527153995', role: 'מחנך' },
      { id: 8, name: 'גדליה גורפלד', phone: '0533199345', password: '0533199345', role: 'מלמד' },
      { id: 9, name: 'שלמה שטארק', phone: '0548408914', password: '0548408914', role: 'מלמד' },
      { id: 10, name: 'רמי אברמוביץ', phone: '0556700049', password: '0556700049', role: 'מפקח' },
      { id: 11, name: 'מירי הולצמן', phone: '02-9931101', password: '02-9931101', role: 'מזכירה' },
    ],
    user_class_access: [
      { id: 1, user_id: 2, class_id: 1 }, { id: 2, user_id: 3, class_id: 2 }, { id: 3, user_id: 4, class_id: 3 },
      { id: 4, user_id: 5, class_id: 4 }, { id: 5, user_id: 6, class_id: 5 }, { id: 6, user_id: 7, class_id: 6 },
    ],
    students: [
      { id: 1, name: 'תלמיד לדוגמה א׳', class_id: 1, parent_name: 'משפחת א׳', parent_phone: '050-0000001', status: 'פעיל', notes: 'ילד מתמיד' },
      { id: 2, name: 'תלמיד לדוגמה ב׳', class_id: 1, parent_name: 'משפחת ב׳', parent_phone: '050-0000002', status: 'פעיל', notes: '' },
      { id: 3, name: 'תלמיד לדוגמה ג׳', class_id: 2, parent_name: 'משפחת ג׳', parent_phone: '050-0000003', status: 'פעיל', notes: '' },
      { id: 4, name: 'תלמיד לדוגמה ד׳', class_id: 3, parent_name: 'משפחת ד׳', parent_phone: '050-0000004', status: 'פעיל', notes: '' },
      { id: 5, name: 'תלמיד לדוגמה ה׳', class_id: 4, parent_name: 'משפחת ה׳', parent_phone: '050-0000005', status: 'פעיל', notes: '' },
      { id: 6, name: 'תלמיד לדוגמה ו׳', class_id: 5, parent_name: 'משפחת ו׳', parent_phone: '050-0000006', status: 'פעיל', notes: '' },
    ],
    // קטגוריות מעקב לפי בקשת עמנואל (המנהל יכול להוסיף עוד)
    categories: [
      { id: 1, name: 'משמעת', kind: 'behavior' }, { id: 2, name: 'כתיבה וקריאה', kind: 'behavior' },
      { id: 3, name: 'מוגנות', kind: 'behavior' }, { id: 4, name: 'שיחה עם הורים', kind: 'behavior' },
      { id: 5, name: 'שיחה עם תלמיד', kind: 'behavior' },
    ],
    subjects: [{ id: 1, name: 'חומש' }, { id: 2, name: 'משנה' }, { id: 3, name: 'גמרא' }, { id: 4, name: 'הלכה' }],
    behavior_events: [
      { id: 1, student_id: 1, category_id: 1, severity: 'בינונית', event_date: daysAgo(1), event_time: '09:15', note: 'הפריע בתפילה' },
      { id: 2, student_id: 1, category_id: 2, severity: 'נמוכה', event_date: daysAgo(4), event_time: '11:00', note: 'שיפור בכתיבה' },
      { id: 3, student_id: 2, category_id: 4, severity: 'נמוכה', event_date: daysAgo(2), event_time: '13:30', note: 'שיחה עם ההורים על התקדמות' },
      { id: 4, student_id: 3, category_id: 5, severity: 'נמוכה', event_date: daysAgo(3), event_time: '10:20', note: 'שיחת עידוד' },
      { id: 5, student_id: 4, category_id: 3, severity: 'גבוהה', event_date: daysAgo(1), event_time: '08:45', note: 'נושא מוגנות — טופל' },
      { id: 6, student_id: 2, category_id: 1, severity: 'נמוכה', event_date: daysAgo(6), event_time: '12:10', note: '' },
    ],
    attendance: [
      { id: 1, student_id: 1, date: T(), status: 'present' }, { id: 2, student_id: 2, date: T(), status: 'late' },
      { id: 3, student_id: 3, date: T(), status: 'present' }, { id: 4, student_id: 4, date: T(), status: 'absent' },
    ],
    tests: [
      { id: 1, student_id: 1, subject: 'פרשת בראשית', grade: 95, date: daysAgo(5) },
      { id: 2, student_id: 2, subject: 'פרשת נח', grade: 82, date: daysAgo(5) },
      { id: 3, student_id: 3, subject: 'פרשת לך לך', grade: 88, date: daysAgo(5) },
    ],
    functioning: [
      { id: 1, student_id: 1, area: 'תפילה', score: 9, date: daysAgo(7) },
      { id: 2, student_id: 2, area: 'לימוד', score: 7, date: daysAgo(7) },
    ],
    medications: [
      { id: 1, student_id: 3, kind: 'allergy', name: 'אלרגיה לבוטנים', details: 'להימנע ממאכלים עם בוטנים', date: daysAgo(30) },
    ],
    conversations: [
      { id: 1, student_id: 2, date: daysAgo(3), summary: 'שיחת עידוד לגבי ההתנהגות בשיעור' },
    ],
    meetings: [
      { id: 1, student_id: 1, date: daysAgo(10), attendees: 'הורים + מלמד', summary: 'אסיפה תקופתית — התקדמות טובה' },
    ],
    reading: [{ id: 1, student_id: 1, level: 'שוטף', date: daysAgo(8), note: 'קורא יפה' }],
    writing: [{ id: 1, student_id: 1, level: 'טוב', date: daysAgo(8), note: '' }],
    tuition: [
      { id: 1, student_id: 1, month: T().slice(0, 7), pay_date: T(), amount: 500, method: 'העברה', status: 'paid', note: '' },
      { id: 2, student_id: 2, month: T().slice(0, 7), pay_date: '', amount: 500, method: '', status: 'due', note: '' },
    ],
    // קופה כללית — הכנסות (מעבר לגבייה) והוצאות (עובדים/כלליות)
    income: [
      { id: 1, date: daysAgo(10), source: 'מלגת קרן', amount: 2000, method: 'העברה', note: 'תרומה חד-פעמית' },
    ],
    expenses: [
      { id: 1, date: daysAgo(5), name: 'ספק ניקיון', tz: '', kind: 'כללית', method: 'העברה', payslip: 'ללא תלוש', amount: 800, note: 'חומרי ניקיון' },
    ],
    forms: [
      { id: 1, title: 'אישור השתתפות בטיול שנתי', body: 'הורים יקרים, נא לאשר את השתתפות בנכם בטיול השנתי שייערך בעז״ה החודש. נא לחתום למטה.', created_at: daysAgo(2) },
    ],
    form_responses: [
      { id: 1, form_id: 1, student_id: 1, status: 'signed', signer_name: 'משפחת לדוגמה א׳', signed_at: daysAgo(1), token: 'demo1a' },
      { id: 2, form_id: 1, student_id: 2, status: 'pending', signer_name: '', signed_at: null, token: 'demo2b' },
      { id: 3, form_id: 1, student_id: 3, status: 'pending', signer_name: '', signed_at: null, token: 'demo3c' },
    ],
    projects: [
      { id: 1, name: 'הכנות לסיום שנה', description: 'מסיבת סיום + תעודות', status: 'active', color: '#6c3fc0', due_date: daysAgo(-20), created_by: null },
      { id: 2, name: 'שיפוץ כיתות', description: 'צביעה וריהוט', status: 'active', color: '#1f8a5b', due_date: daysAgo(-40), created_by: null },
    ],
    tasks: [
      { id: 1, title: 'להזמין תעודות', description: 'להדפיס לכל התלמידים', project_id: 1, assignee: 2, student_id: null, due_date: daysAgo(-3), priority: 'גבוה', status: 'open', created_by: null },
      { id: 2, title: 'לתאם מסיבה', description: '', project_id: 1, assignee: 3, student_id: null, due_date: daysAgo(-7), priority: 'רגיל', status: 'in_progress', created_by: null },
      { id: 3, title: 'לבדוק אלרגיות לפני טיול', description: '', project_id: null, assignee: 2, student_id: 3, due_date: daysAgo(-1), priority: 'גבוה', status: 'open', created_by: null },
      { id: 4, title: 'לקנות צבע', description: '', project_id: 2, assignee: 4, student_id: null, due_date: daysAgo(2), priority: 'נמוך', status: 'done', created_by: null },
    ],
    calendar_events: [
      { id: 1, title: 'אסיפת הורים כללית', date: daysAgo(-5), end_date: null, time: '20:00', kind: 'meeting', note: 'בבית הכנסת', created_by: null },
      { id: 2, title: 'טיול שנתי', date: daysAgo(-14), end_date: null, time: '08:00', kind: 'event', note: '', created_by: null },
      { id: 3, title: 'ראש חודש', date: daysAgo(-2), end_date: null, time: '', kind: 'holiday', note: '', created_by: null },
    ],
    feedback: [],
    audit_log: [
      { id: 1, action: 'login', detail: 'מנהל המערכת נכנס', created_at: T() + ' 08:12' },
      { id: 2, action: 'create', detail: 'דיווח התנהגות נוסף', created_at: T() + ' 08:20' },
    ],
  };

  const mem = DEMO ? JSON.parse(JSON.stringify(seed)) : null;
  const seqs = {};
  if (DEMO) for (const t in mem) seqs[t] = 1 + mem[t].reduce((m, r) => Math.max(m, r.id || 0), 0);

  // כשל קריאה החזיר קודם [] — בדיוק כמו טבלה ריקה. המסך נראה ריק והמשתמש הסיק
  // שהנתונים נמחקו. מכאן והלאה כשל נראה למשתמש, עם השהיה כדי לא להציף בטוסטים.
  let lastReadErrorAt = 0;
  function reportReadFailure(table, err) {
    console.error('[cheder-v3] קריאה נכשלה מטבלה ' + table + ': ' + err);
    const now = Date.now();
    if (now - lastReadErrorAt < 6000) return;
    lastReadErrorAt = now;
    if (window.UI && window.UI.toast) window.UI.toast('טעינת הנתונים נכשלה — ייתכן שהמסך אינו מעודכן. רענן.', 'err');
  }

  async function list(table, opts) {
    if (DEMO) { let r = (mem[table] || []).slice(); if (opts && opts.eq) for (const k in opts.eq) r = r.filter(x => x[k] == opts.eq[k]); return r; }
    const res = await window.db.list(table, opts);
    if (!res.ok) reportReadFailure(table, res.error);
    return res.data || [];
  }
  async function byStudent(table, sid) {
    if (DEMO) return (mem[table] || []).filter(r => r.student_id == sid);
    const res = await window.db.list(table, { eq: { student_id: sid } });
    if (!res.ok) reportReadFailure(table, res.error);
    return res.data || [];
  }
  async function add(table, row) {
    if (DEMO) { row = Object.assign({}, row); if (!seqs[table]) seqs[table] = 1; row.id = seqs[table]++; (mem[table] = mem[table] || []).push(row); return { ok: true, data: [row] }; }
    return window.db.insert(table, row);
  }
  async function update(table, id, patch) {
    if (DEMO) { const r = (mem[table] || []).find(x => x.id == id); if (r) Object.assign(r, patch); return { ok: true }; }
    return window.db.update(table, id, patch);
  }
  async function remove(table, id) {
    if (DEMO) { mem[table] = (mem[table] || []).filter(x => x.id != id); return { ok: true }; }
    return window.db.remove(table, id);
  }

  window.store = { DEMO, list, add, update, remove, byStudent, _mem: mem };
})();
