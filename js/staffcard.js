// staffcard.js — כרטיס איש צוות (צפייה בלבד): הכיתות שלי, המשימות שלי, פעילות אחרונה.
// נפתח דרך window.cv3StaffCard.open(staffId). עובד בדמו (users) וגם חי (profiles). כל תוכן משתמש עובר esc().
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  // תאריך עברי מוגן — מקבל ISO/תאריך חלקי, נופל חזרה למחרוזת המקורית אם לא תקין
  const hebDate = iso => {
    if (!iso) return '';
    try { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); return isNaN(d.getTime()) ? String(iso) : new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long' }).format(d); }
    catch (_) { return String(iso); }
  };
  const initials = name => String(name || '?').trim().slice(0, 2) || '?';
  const taskLbl = st => st === 'done' ? 'הושלם' : st === 'in_progress' ? 'בתהליך' : 'לביצוע';
  // שליפה בטוחה — לא מפילה את הכרטיס אם טבלה חסרה/חסומה (RLS)
  async function safeList(table) { try { const r = await window.store.list(table); return Array.isArray(r) ? r : []; } catch (_) { return []; } }

  async function open(staffId) {
    const m = window.UI.modal({ title: 'כרטיס איש צוות', bodyHTML: '<div style="padding:26px;text-align:center;color:var(--muted)"><i class="bi bi-hourglass-split"></i> טוען…</div>' });

    // מקור צוות: profiles ואם ריק — users (לפי המוסכמה במערכת)
    let staff = await safeList('profiles');
    if (!staff.length) staff = await safeList('users');
    const person = staff.find(u => u.id == staffId) || {};

    const [classes, access, tasks, beh] = await Promise.all([
      (window.cv3Students && window.cv3Students.getClasses) ? window.cv3Students.getClasses().catch(() => []) : safeList('classes'),
      safeList('user_class_access'),
      safeList('tasks'),
      safeList('behavior_events'),
    ]);

    // הכיתות שלי — classes.melamed==staffId או שיוך דרך user_class_access
    const teaches = c => (c.melamed != null && c.melamed == staffId) || access.some(a => a.user_id == staffId && a.class_id == c.id);
    const myClasses = (classes || []).filter(teaches);

    // המשימות שלי — assignee==staffId; יעד באדום אם עבר ולא הושלם
    const myTasks = (tasks || []).filter(t => t.assignee != null && t.assignee == staffId);
    const today = todayISO();
    const overdue = t => t.due_date && String(t.due_date).slice(0, 10) < today && t.status !== 'done';
    const dot = t => overdue(t) ? 'hi' : (t.status === 'done' ? 'lo' : 'mid');
    const chip = st => '<span class="chip ' + (st === 'done' ? 'ok' : 'off') + '">' + taskLbl(st) + '</span>';
    const dueHtml = t => { if (!t.due_date) return ''; const h = esc(hebDate(t.due_date)); return overdue(t) ? '<span style="color:var(--danger);font-weight:700">' + h + '</span>' : h; };
    const doneN = myTasks.filter(t => t.status === 'done').length;
    const overdueN = myTasks.filter(overdue).length;
    const summary = myTasks.length + ' משימות · ' + doneN + ' הושלמו · ' + (myTasks.length - doneN) + ' פתוחות' + (overdueN ? ' · ' + overdueN + ' באיחור' : '');

    // פעילות אחרונה (רשות, קליל) — דיווחי התנהגות שנרשמו ע"י איש הצוות
    const myBeh = (beh || []).filter(e => e.created_by != null && e.created_by == staffId);

    const phone = person.phone || '';
    const isAdmin = (window.currentUser || {}).role === 'מנהל';

    const clsSec = '<div class="det-sec"><h4><i class="bi bi-mortarboard"></i> הכיתות שלי <span class="det-badge">' + myClasses.length + '</span></h4>' +
      (myClasses.length ? '<div class="chip-list">' + myClasses.map(c => '<span class="chip ok">' + esc(c.name) + '</span>').join('') + '</div>'
        : '<div class="tl-note" style="padding:6px 2px;font-size:.84rem">לא משויכות כיתות</div>') + '</div>';

    const tasksSec = '<div class="det-sec"><h4><i class="bi bi-kanban"></i> המשימות שלי <span class="det-badge">' + myTasks.length + '</span></h4>' +
      (myTasks.length ? (myTasks.slice().reverse().map(t =>
          '<div class="det-item"><span class="sev-dot ' + dot(t) + '"></span><span class="di-main"><strong>' + esc(t.title) + '</strong> ' + chip(t.status) + '</span><span class="di-meta">' + dueHtml(t) + '</span></div>').join('') +
          '<div class="count-line" style="margin:6px 2px 0">' + esc(summary) + '</div>')
        : '<div class="tl-note" style="padding:6px 2px;font-size:.84rem">אין משימות משויכות</div>') + '</div>';

    const behSec = myBeh.length ? '<div class="det-sec"><h4><i class="bi bi-clipboard-check"></i> פעילות אחרונה</h4>' +
      '<div class="det-item"><span class="sev-dot lo"></span><span class="di-main">' + myBeh.length + ' דיווחי התנהגות נרשמו על ידי איש הצוות</span></div></div>' : '';

    const adminNote = isAdmin ? '<div class="tl-note" style="padding:4px 2px;font-size:.8rem"><i class="bi bi-shield-lock"></i> תצוגת מנהל · צפייה בלבד</div>' : '';

    m.el.querySelector('.modal-body').innerHTML =
      '<div class="det-head"><span class="ava lg">' + esc(initials(person.name)) + '</span>' +
        '<div><div class="det-name">' + esc(person.name || 'איש צוות') + '</div>' +
        (person.role ? '<span class="chip ok">' + esc(person.role) + '</span>' : '') +
        (phone ? ' <span class="tl-meta"><i class="bi bi-telephone"></i> <a href="tel:' + esc(phone) + '">' + esc(phone) + '</a></span>' : '') +
        '</div></div>' +
      clsSec + tasksSec + behSec + adminNote;
  }

  window.cv3StaffCard = { open: open };
})();
