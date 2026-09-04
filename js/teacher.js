// teacher.js — תצוגת בית פשוטה ויפה למורים (מלמד/מחנך): רישום מהיר גדול + כפתורי פעולה גדולים.
// מוצגת במקום רשת האריחים כשמתחבר מורה. נתונים דרך store.js.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);

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
    const cats = await window.store.list('categories');
    if (seq !== runSeq) return;
    const catOpts = cats.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const pickHtml = await window.cv3Picker.html('th');
    if (seq !== runSeq) return;
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
      '<div class="teacher-card"><h3><i class="bi bi-lightning-charge"></i> רישום מהיר לתלמיד</h3>' +
        '<div class="qr-grid" style="grid-template-columns:repeat(3,1fr) auto">' +
          pickHtml +
          '<select class="inp mb0" id="thCat"><option value="">בחר קטגוריה…</option>' + catOpts + '</select>' +
          '<input class="inp mb0" id="thDate" type="date" value="' + today() + '" title="תאריך">' +
          '<input class="inp mb0" id="thTime" type="time" title="שעה">' +
          '<textarea class="inp mb0 fld-wide ta-auto" id="thNote" rows="3" placeholder="הערה (רשות) — אפשר כמה שורות" style="grid-column:1/-2"></textarea>' +
          '<label style="display:flex;align-items:center;gap:5px;font-size:.85rem;color:var(--muted);white-space:nowrap;cursor:pointer"><input type="checkbox" id="thFollow"> מעקב — דורש טיפול המשך</label>' +
          '<button class="btn-primary" id="thSave"><i class="bi bi-check-lg"></i> שמור רישום</button>' +
        '</div><div id="thMsg" class="count-line" style="margin-top:8px;min-height:1.2em"></div></div>' +
      '<div id="thFollowupWidget"></div>' +
      '<div class="teacher-actions">' + allowed.map(goBtn).join('') + '</div>';
    if (seq !== runSeq) return;
    if (window.cv3Behavior) window.cv3Behavior.renderFollowupWidget(host.querySelector('#thFollowupWidget'));
    const pick = window.cv3Picker.wire(host, 'th');
    host.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => window.showPage(b.dataset.go)));
    host.querySelector('#thSave').addEventListener('click', async () => {
      const sid = pick.value();
      if (!sid) { window.UI.toast('בחר תלמיד', 'err'); return; }
      const cat = host.querySelector('#thCat').value;
      const followup = host.querySelector('#thFollow').checked;
      const row = { student_id: Number(sid), category_id: cat ? Number(cat) : null, event_date: host.querySelector('#thDate').value || today(), event_time: host.querySelector('#thTime').value, note: host.querySelector('#thNote').value.trim(), followup };
      const r = await window.store.add('behavior_events', row);
      if (r.ok) {
        host.querySelector('#thNote').value = ''; host.querySelector('#thTime').value = '';
        host.querySelector('#thFollow').checked = false;
        pick.reset();
        host.querySelector('#thMsg').textContent = '✓ הרישום נשמר בהצלחה';
        window.UI.toast('נשמר');
        // דיווח חדש שסומן "מעקב" צריך להופיע בחלונית מיד, לא רק בכניסה הבאה למסך.
        if (followup && window.cv3Behavior) window.cv3Behavior.renderFollowupWidget(host.querySelector('#thFollowupWidget'));
      } else { window.UI.toast('שגיאה', 'err'); }
    });
  };
})();
