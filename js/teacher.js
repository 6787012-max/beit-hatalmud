// teacher.js — תצוגת בית פשוטה ויפה למורים (מלמד/מחנך): רישום מהיר גדול + כפתורי פעולה גדולים.
// מוצגת במקום רשת האריחים כשמתחבר מורה. נתונים דרך store.js.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);

  window.renderTeacherHome = async function (host) {
    const cats = await window.store.list('categories');
    const catOpts = cats.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const pickHtml = await window.cv3Picker.html('th');
    const u = window.currentUser || {};
    const isMechanech = u.role === 'מחנך';
    host.innerHTML =
      '<div class="teacher-card"><h3><i class="bi bi-lightning-charge"></i> רישום מהיר לתלמיד</h3>' +
        '<div class="qr-grid" style="grid-template-columns:repeat(3,1fr) auto">' +
          pickHtml +
          '<select class="inp mb0" id="thCat"><option value="">בחר קטגוריה…</option>' + catOpts + '</select>' +
          '<input class="inp mb0" id="thDate" type="date" value="' + today() + '" title="תאריך">' +
          '<input class="inp mb0" id="thTime" type="time" title="שעה">' +
          '<input class="inp mb0 fld-wide" id="thNote" placeholder="הערה (רשות)" style="grid-column:1/-2">' +
          '<button class="btn-primary" id="thSave"><i class="bi bi-check-lg"></i> שמור רישום</button>' +
        '</div><div id="thMsg" class="count-line" style="margin-top:8px;min-height:1.2em"></div></div>' +
      '<div class="teacher-actions">' +
        '<button class="teacher-btn" data-go="behavior"><i class="bi bi-clipboard-check"></i><span>מעקב מלא</span></button>' +
        '<button class="teacher-btn" data-go="attendance"><i class="bi bi-calendar-check"></i><span>נוכחות</span></button>' +
        '<button class="teacher-btn" data-go="tests"><i class="bi bi-card-checklist"></i><span>מבחנים</span></button>' +
        (isMechanech ? '<button class="teacher-btn" data-go="students"><i class="bi bi-people-fill"></i><span>התלמידים שלי</span></button>' : '') +
      '</div>';
    const pick = window.cv3Picker.wire(host, 'th');
    host.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => window.showPage(b.dataset.go)));
    host.querySelector('#thSave').addEventListener('click', async () => {
      const sid = pick.value();
      if (!sid) { window.UI.toast('בחר תלמיד', 'err'); return; }
      const cat = host.querySelector('#thCat').value;
      const row = { student_id: Number(sid), category_id: cat ? Number(cat) : null, event_date: host.querySelector('#thDate').value || today(), event_time: host.querySelector('#thTime').value, note: host.querySelector('#thNote').value.trim() };
      const r = await window.store.add('behavior_events', row);
      if (r.ok) {
        host.querySelector('#thNote').value = ''; host.querySelector('#thTime').value = '';
        pick.reset();
        host.querySelector('#thMsg').textContent = '✓ הרישום נשמר בהצלחה';
        window.UI.toast('נשמר');
      } else { window.UI.toast('שגיאה', 'err'); }
    });
  };
})();
