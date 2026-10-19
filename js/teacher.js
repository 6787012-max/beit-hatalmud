// teacher.js — תצוגת בית פשוטה ויפה למורים (מלמד/מחנך): רישום מהיר גדול + כפתורי פעולה גדולים.
// מוצגת במקום רשת האריחים כשמתחבר מורה. נתונים דרך store.js.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // תאריך מקומי, לא UTC: אחרי חצות ועד 03:00 toISOString נתן את אתמול.
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  // מונה ריצות: החלפת משתמש מפעילה רינדור חדש בזמן שהקודם עוד ממתין
  // לנתונים. בלי הבדיקה בסוף, הרינדור הישן היה דורס את החדש והמסך היה מציג
  // את תפריט המשתמש הקודם.
  let runSeq = 0;

  window.renderTeacherHome = async function (host) {
    const seq = ++runSeq;
    // מנקים מיד: אחרת התפריט של המשתמש הקודם נשאר על המסך עד שהנתונים
    // מגיעים — כלומר מי שהתחלף רואה לרגע מסכים שאינם שלו.
    host.innerHTML = '<div class="page-loading"><span class="spin">' +
      '<i class="bi bi-arrow-repeat"></i></span><div>טוען…</div></div>';
    const u = window.currentUser || {};
    const isMechanech = u.role === 'מחנך';
    // כפתורי הפעולה נגזרים מההרשאות בפועל, ולא מרשימה קשיחה.
    // קודם היו כאן ארבעה כפתורים קבועים (מעקב/נוכחות/מבחנים/תלמידים), ורשת
    // האריחים מוסתרת למורים — כך שמסך שהמנהל הוסיף למורה בהגדרות (למשל
    // "דרכון" לרפאל רוקמיל) פשוט לא היה לו דרך להגיע אליו בכלל.
    const allowed = (window.MODULES || []).filter(m =>
      !m.adminOnly && m.id !== 'settings' &&
      (!window.Auth || !window.Auth.canAccess || window.Auth.canAccess(m.id)) &&
      // "תלמידים" נשמר למחנך בלבד — מלמד מזין ולא מעיין בתיקי התלמידים
      (m.id !== 'students' || isMechanech));
    const goBtn = m => '<button class="teacher-btn" data-go="' + m.id + '">' +
      '<i class="bi ' + m.icon + '"></i><span>' +
      esc(m.id === 'behavior' ? 'מעקב מלא' : m.id === 'students' ? 'התלמידים שלי' : m.label) +
      '</span></button>';
    host.innerHTML =
      // טופס גרסה 2 (behavior.js → quickForm): מי (אפשר כמה) → מה קרה → כמה חמור → צריך המשך?
      '<div class="teacher-card"><h3><i class="bi bi-lightning-charge"></i> דיווח מהיר</h3><div id="thForm"></div></div>' +
      '<div id="thFollowupWidget"></div>' +
      '<div class="teacher-actions">' + allowed.map(goBtn).join('') + '</div>';
    if (seq !== runSeq) return;
    if (window.cv3Behavior) window.cv3Behavior.renderFollowupWidget(host.querySelector('#thFollowupWidget'));
    host.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => window.showPage(b.dataset.go)));
    if (window.cv3Behavior) await window.cv3Behavior.quickForm(host.querySelector('#thForm'), 'th', {
      // מקרה שנפתח צריך להופיע בחלונית מיד, לא רק בכניסה הבאה למסך
      onSaved: rows => {
        if (rows.some(r => r.followup || r.status === 'open') && seq === runSeq)
          window.cv3Behavior.renderFollowupWidget(host.querySelector('#thFollowupWidget'));
      },
    });
  };
})();
