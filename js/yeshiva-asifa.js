// yeshiva-asifa.js — שיבוץ פגישות להורים, אסיפת הורים של ישיבת משמרת חיים.
// ההורה מזין שם הורה, שם בחור, שיעור וטלפון (תלמידי הישיבה לא נמצאים במסד) ובוחר תורים.
// כל הגישה למסד דרך פונקציות yeshiva_asifa_* (RPC). בקוד אין שעות/רבנים: הכול מגיע מטבלת ההגדרות.
(function () {
  'use strict';
  const C = window.CV3 || {};
  const root = document.getElementById('root');
  const token = new URLSearchParams(location.search).get('g');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sb = (C.SUPABASE_URL && C.SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;

  let meeting = null, mine = [], busy = false, timer = null;
  let form = { parent: '', student: '', cls: '', phone: '' };
  let done = null;      // מסך אישור אחרי קביעה/שינוי/ביטול
  let moving = null;    // מזהה פגישה שמשנים לה שעה

  const normName = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const digits = s => String(s || '').replace(/\D/g, '');

  function hm2min(t) { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function min2hm(n) { return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
  function slotsOf(r) {
    const out = []; const st = hm2min(r.start), en = hm2min(r.end), d = meeting.slot_minutes;
    for (let t = st; t + d <= en; t += d) out.push(min2hm(t));
    return out;
  }
  function endOf(slot) { return min2hm(hm2min(slot) + meeting.slot_minutes); }

  // המרת מספר לאותיות עבריות (לתאריך העברי)
  function gematria(n) {
    const H = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'],
      [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'],
      [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
    n = Number(n) % 1000;
    if (n === 15) return 'ט״ו';
    if (n === 16) return 'ט״ז';
    let out = '';
    for (const [v, ch] of H) while (n >= v) { out += ch; n -= v; }
    if (!out) return '';
    return out.length > 1 ? out.slice(0, -1) + '״' + out.slice(-1) : out + '׳';
  }
  function hebDateTxt(d) {
    try {
      const parts = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(d);
      const get = t => (parts.find(p => p.type === t) || {}).value || '';
      let month = get('month');
      if (month && month.charAt(0) !== 'ב') month = 'ב' + month;
      return gematria(parseInt(get('day'), 10)) + ' ' + month + ' ' + gematria(parseInt(String(get('year')).replace(/\D/g, ''), 10));
    } catch (_) { return ''; }
  }
  function dateText() {
    try {
      const d = new Date(meeting.date + 'T12:00:00');
      const g = d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const h = hebDateTxt(d);
      return g + (h ? ' · ' + h : '');
    } catch (_) { return meeting.date; }
  }
  function ravOf(id) { return (meeting.rabbis || []).find(r => r.id === id) || { id: id, name: id, where: '' }; }

  function head() {
    const starts = (meeting.rabbis || []).map(r => r.start).filter(Boolean).sort();
    return '<div class="ya-card"><h1>' + esc(meeting.title) + '</h1>' +
      '<div class="ya-when">' + esc(dateText()) + (starts[0] ? '<br>החל משעה ' + esc(starts[0]) : '') + '</div>' +
      '<div class="ya-note">לכל הורה פגישה של ' + meeting.slot_minutes + ' דקות אצל כל רב. מי שנרשם קודם בוחר קודם.</div></div>';
  }

  async function loadMeeting() {
    const { data, error } = await sb.rpc('yeshiva_asifa_public', { p_token: token });
    if (error || !data) return null;
    return data;
  }
  async function loadMine() {
    const { data, error } = await sb.rpc('yeshiva_asifa_mine', { p_token: token, p_phone: form.phone });
    if (error) throw error;
    return data || [];
  }
  async function refresh() {
    meeting = (await loadMeeting()) || meeting;
    mine = await loadMine();
  }
  function say(t) { const m = document.getElementById('msg'); if (m) { m.textContent = t; m.scrollIntoView({ block: 'center' }); } }

  // ===== מסך 1: פרטי ההורה =====
  function viewForm(msg) {
    stopTimer();
    const closed = !meeting.open;
    root.innerHTML = head() +
      '<div class="ya-card">' +
      (closed ? '<div class="ya-msg" style="color:var(--primary-dark)">ההרשמה סגורה כרגע.' + (meeting.contact_text ? '<br>' + esc(meeting.contact_text) : '') + '</div>' : '') +
      '<label class="ya-lbl" for="f_parent" style="margin-top:0">שם ההורה</label>' +
      '<input id="f_parent" class="ya-inp" type="text" autocomplete="name" maxlength="60" value="' + esc(form.parent) + '">' +
      '<label class="ya-lbl" for="f_student">שם הבחור</label>' +
      '<input id="f_student" class="ya-inp" type="text" maxlength="60" value="' + esc(form.student) + '">' +
      '<span class="ya-lbl">שיעור</span><div class="ya-cls">' +
      (meeting.classes || []).map(c => '<label><input type="radio" name="f_cls" value="' + esc(c) + '"' + (form.cls === c ? ' checked' : '') + '><span>' + esc(c) + '</span></label>').join('') +
      '</div>' +
      '<label class="ya-lbl" for="f_phone">טלפון</label>' +
      '<input id="f_phone" class="ya-inp ltr" type="tel" inputmode="tel" autocomplete="tel" placeholder="05X-XXXXXXX" value="' + esc(form.phone) + '">' +
      '<div class="ya-note" style="margin-top:6px">הטלפון משמש לשינוי או לביטול של הפגישה, ולכן כדאי לרשום אותו נכון.</div>' +
      '<div class="ya-msg" id="msg">' + esc(msg || '') + '</div>' +
      '<button class="ya-btn" id="go"' + (closed ? ' disabled' : '') + '>המשך לבחירת תור</button></div>';
    const $ = id => document.getElementById(id);
    const go = async () => {
      form.parent = $('f_parent').value.trim();
      form.student = $('f_student').value.trim();
      const c = root.querySelector('input[name=f_cls]:checked'); form.cls = c ? c.value : '';
      form.phone = $('f_phone').value.trim();
      if (form.parent.length < 2) return say('נא למלא שם הורה');
      if (form.student.length < 2) return say('נא למלא שם בחור');
      if (!form.cls) return say('נא לבחור שיעור');
      if (digits(form.phone).length < 9) return say('נא למלא טלפון תקין (לפחות 9 ספרות)');
      $('go').disabled = true;
      try { await refresh(); done = null; moving = null; viewMain(); }
      catch (e) { viewForm('שגיאה בחיבור, נסו שוב'); }
    };
    $('go').addEventListener('click', go);
    ['f_parent', 'f_student', 'f_phone'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
  }

  // כפתורי שעות לרב אחד. excludeId = הפגישה שמשנים (השעה שלה לא נחשבת "חופפת")
  function slotsHtml(r, excludeId, attrs) {
    const taken = (meeting.occupied && meeting.occupied[r.id]) || [];
    const myAtRav = mine.filter(b => b.rav_id === r.id && b.id !== excludeId).map(b => b.slot);
    const myTimes = mine.filter(b => b.id !== excludeId).map(b => b.slot);
    const cur = excludeId ? (mine.find(b => b.id === excludeId) || {}).slot : null;
    let h = '<div class="ya-slots">';
    slotsOf(r).forEach(t => {
      let dis = false, label = 'פנוי', cls = '';
      if (t === cur) { dis = true; label = 'השעה הנוכחית'; cls = ' mine'; }
      else if (myAtRav.indexOf(t) >= 0) { dis = true; label = 'שלכם'; cls = ' mine'; }
      else if (taken.indexOf(t) >= 0) { dis = true; label = 'תפוס'; }
      else if (myTimes.indexOf(t) >= 0) { dis = true; label = 'כבר קבעתם'; }
      h += '<button class="ya-slot' + cls + '"' + (dis ? ' disabled' : '') + ' ' + attrs + ' data-slot="' + t + '"><b>' + t + '</b><small>' + label + '</small></button>';
    });
    return h + '</div>';
  }

  // ===== מסך 2: בחירת תורים =====
  function viewMain() {
    startTimer();
    if (done) return viewDone();
    if (moving) return viewMove();
    const skey = normName(form.student);
    let html = head();
    html += '<div class="ya-card"><div class="ya-hello">שלום, ' + esc(form.parent) + '</div>' +
      '<div class="ya-note" style="margin-top:2px">הבחור: <b>' + esc(form.student) + '</b>, ' + esc(form.cls) + '</div>';
    if (!meeting.open) html += '<div class="ya-msg" style="color:var(--primary-dark)">ההרשמה סגורה כרגע.</div>';

    if (mine.length) {
      html += '<div class="ya-sec" style="margin-top:14px">הפגישות שקבעתם</div>';
      mine.forEach(b => {
        const r = ravOf(b.rav_id);
        html += '<div class="ya-item"><b>' + esc(b.slot) + '</b> · ' + esc(r.name) + (r.where ? ' (' + esc(r.where) + ')' : '') +
          '<br>הבחור: ' + esc(b.student) +
          (meeting.open ? '<div class="ya-row"><button class="ya-btn ghost sm" data-move="' + b.id + '">שינוי שעה</button>' +
            '<button class="ya-btn danger sm" data-cancel="' + b.id + '">ביטול</button></div>' : '') + '</div>';
      });
    }
    html += '</div>';

    html += '<div class="ya-card"><div class="ya-sec">בחרו שעה אצל כל רב שרוצים לפגוש</div>';
    (meeting.rabbis || []).forEach(r => {
      const has = mine.find(b => b.rav_id === r.id && b.student_key === skey);
      html += '<div class="ya-rav' + (has ? ' done' : '') + '"><h3>' + esc(r.name) + '</h3>' +
        (r.where ? '<div class="ya-where">' + esc(r.where) + '</div>' : '');
      if (has) html += '<div class="ya-where" style="color:var(--ok)">נקבעה פגישה בשעה ' + esc(has.slot) + '. לשינוי או לביטול: למעלה.</div>';
      else if (meeting.open) html += slotsHtml(r, null, 'data-book="' + esc(r.id) + '"');
      html += '</div>';
    });
    html += '<div class="ya-msg" id="msg"></div><button class="ya-btn ghost" id="edit">שינוי פרטים או טלפון אחר</button></div>';
    root.innerHTML = html;
    root.querySelectorAll('[data-book]').forEach(b => b.addEventListener('click', () => book(b.dataset.book, b.dataset.slot)));
    root.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => { moving = +b.dataset.move; viewMain(); window.scrollTo(0, 0); }));
    root.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => cancel(+b.dataset.cancel)));
    document.getElementById('edit').addEventListener('click', () => { mine = []; viewForm(); });
  }

  // ===== שינוי שעה =====
  function viewMove() {
    const b = mine.find(x => x.id === moving);
    if (!b) { moving = null; return viewMain(); }
    const r = ravOf(b.rav_id);
    root.innerHTML = head() +
      '<div class="ya-card"><div class="ya-sec">שינוי שעה</div>' +
      '<div class="ya-rav"><h3>' + esc(r.name) + '</h3>' + (r.where ? '<div class="ya-where">' + esc(r.where) + '</div>' : '') +
      '<div class="ya-where">הבחור: ' + esc(b.student) + '. השעה הנוכחית: ' + esc(b.slot) + '. בחרו שעה חדשה:</div>' +
      slotsHtml(r, b.id, 'data-newslot="1"') + '</div>' +
      '<div class="ya-msg" id="msg"></div><button class="ya-btn ghost" id="back">חזרה בלי לשנות</button></div>';
    root.querySelectorAll('[data-newslot]').forEach(x => x.addEventListener('click', () => move(b.id, x.dataset.slot)));
    document.getElementById('back').addEventListener('click', () => { moving = null; viewMain(); });
  }

  // ===== מסך אישור =====
  function viewDone() {
    let html = head() + '<div class="ya-card"><div class="ya-ok"><i class="bi bi-check-circle-fill"></i>' +
      '<div class="big">' + (done.cancelled ? 'הפגישה בוטלה' : (done.moved ? 'השעה שונתה בהצלחה' : 'הפגישה נקבעה בהצלחה')) + '</div></div>';
    if (!done.cancelled) {
      html += '<div class="ya-sum">' + esc(done.student) + '<br>' + esc(done.rav) + (done.where ? ' (' + esc(done.where) + ')' : '') + '<br>' +
        esc(dateText()) + '<br><span class="t">בשעה ' + esc(done.slot) + '</span></div>' +
        '<div class="ya-note" style="font-weight:700;color:var(--ink)">כדאי לרשום את השעה. לשינוי או לביטול נכנסים שוב לדף ומזינים את אותו טלפון.</div>';
    }
    html += '<button class="ya-btn" id="more">חזרה לבחירת תורים</button></div>';
    root.innerHTML = html;
    document.getElementById('more').addEventListener('click', () => { done = null; viewMain(); window.scrollTo(0, 0); });
  }

  async function act(fn) {
    if (busy) return; busy = true;
    try { await fn(); } catch (e) { say('שגיאה בחיבור, נסו שוב'); } finally { busy = false; }
  }
  function book(ravId, slot) {
    return act(async () => {
      const { data, error } = await sb.rpc('yeshiva_asifa_book', { p_token: token, p_parent: form.parent, p_student: form.student,
        p_class: form.cls, p_phone: form.phone, p_rav: ravId, p_slot: slot });
      await refresh().catch(() => {});
      if (error) { viewMain(); say(error.message || 'שגיאה, נסו שוב'); return; }
      done = { student: data.student, rav: data.rav, where: data.where, slot: data.slot };
      viewMain(); window.scrollTo(0, 0);
    });
  }
  function move(id, slot) {
    return act(async () => {
      const { data, error } = await sb.rpc('yeshiva_asifa_move', { p_token: token, p_phone: form.phone, p_booking_id: id, p_slot: slot });
      await refresh().catch(() => {});
      if (error) { viewMain(); say(error.message || 'שגיאה, נסו שוב'); return; }
      moving = null;
      done = { moved: true, student: data.student, rav: data.rav, where: data.where, slot: data.slot };
      viewMain(); window.scrollTo(0, 0);
    });
  }
  function cancel(id) {
    if (busy) return;
    if (!window.confirm('לבטל את הפגישה?')) return;
    return act(async () => {
      const { error } = await sb.rpc('yeshiva_asifa_cancel', { p_token: token, p_phone: form.phone, p_booking_id: id });
      await refresh().catch(() => {});
      if (error) { viewMain(); say(error.message || 'שגיאה'); return; }
      done = { cancelled: true };
      viewMain(); window.scrollTo(0, 0);
    });
  }

  // רענון שקט של התפוסות כשההורה בוחר (רק כשאין פעולה באמצע)
  function startTimer() {
    stopTimer();
    timer = setInterval(async () => {
      if (busy || done || document.hidden) return;
      try { await refresh(); if (!done) { const y = window.scrollY; (moving ? viewMove : viewMain)(); window.scrollTo(0, y); } } catch (_) {}
    }, 30000);
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  (async function init() {
    if (!token) { root.innerHTML = '<div class="ya-card"><h1>קישור לא תקין</h1><div class="ya-note">פנו להנהלת הישיבה לקבלת קישור מעודכן.</div></div>'; return; }
    if (!sb) { root.innerHTML = '<div class="ya-card"><div class="ya-note">המערכת במצב הדגמה.</div></div>'; return; }
    meeting = await loadMeeting();
    if (!meeting) { root.innerHTML = '<div class="ya-card"><h1>הקישור לא נמצא</h1><div class="ya-note">ייתכן שהקישור אינו תקין. פנו להנהלת הישיבה.</div></div>'; return; }
    viewForm();
  })();
})();
