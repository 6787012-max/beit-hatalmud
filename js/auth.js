// auth.js — חלק 2: אימות (Supabase Auth) + הרשאות.
// אמת: OTP/Magic-Link במייל דרך Supabase (צד-שרת). במצב DEMO — כניסת צפייה לבחירת תפקיד.
// ההגנה האמיתית על הנתונים היא ה-RLS בצד-שרת; כאן זו רק חוויית משתמש.
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const DEMO = !window.sb;
  const A = { currentUser: null };

  function buildLoginPage() {
    if ($('#page-login')) return;
    const sec = document.createElement('section');
    sec.className = 'page';
    sec.id = 'page-login';
    sec.innerHTML =
      '<div class="login-wrap"><div class="login-card">' +
        '<div class="login-logo"><img src="img/logo.png" alt="לוגו המכינה" class="login-logo-img"></div>' +
        '<h2>כניסה למערכת</h2>' +
        '<p class="login-sub">מערכת מעקב — מכינה בית התלמוד</p>' +
        '<label class="lbl">שם משתמש</label>' +
        '<input type="text" id="loginTz" class="inp" placeholder="השם המלא שלך" autocomplete="username">' +
        '<label class="lbl">סיסמה</label>' +
        '<input type="password" id="loginPw" class="inp" placeholder="סיסמה (בפעם הראשונה — מספר הטלפון)" autocomplete="current-password">' +
        '<button class="btn-primary" id="loginBtn"><i class="bi bi-box-arrow-in-left"></i> כניסה</button>' +
        '<div id="loginMsg" class="login-msg"></div>' +
        (DEMO
          ? '<div class="demo-note" style="margin-top:14px"><i class="bi bi-info-circle"></i> הדגמה — כניסה בשם + טלפון כסיסמה. מנהל: <b>עמנואל רקובסקי</b> / <b>0548451402</b></div>'
          : '<p class="login-hint">כניסה בשם; סיסמה ראשונית — מספר הטלפון. אין גישה? פנה למנהל.</p>') +
      '</div></div>';
    $('#pages').appendChild(sec);
    $('#loginBtn').addEventListener('click', doLogin);
    $('#loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  }

  async function doLogin() {
    const id = ($('#loginTz').value || '').trim();
    const pw = $('#loginPw').value || '';
    const msg = $('#loginMsg');
    if (!id || !pw) { msg.textContent = 'נא להזין שם וסיסמה.'; return; }
    msg.textContent = 'מתחבר…';
    if (DEMO) {
      const users = await window.store.list('users');
      // כניסה לפי שם (וגם ת״ז/טלפון כגיבוי); סיסמה ראשונית = טלפון
      const u = users.find(x => (x.name === id || x.tz === id || x.phone === id) && x.password === pw && x.active !== false);
      if (!u) { msg.textContent = 'שם או סיסמה שגויים.'; return; }
      msg.textContent = '';
      await setUser({ id: u.id, name: u.name, role: u.role, tz: u.tz, perms: u.perms });
    } else {
      // Supabase: המזהה ממופה למייל סינתטי; הסיסמה מאומתת בצד-שרת (hashed).
      // כניסה לפי **מספר טלפון** (או מייל מלא). כניסה-לפי-שם בוטלה בכוונה:
      // ה-RPC email_by_name היה פתוח לאנונימי והחזיר את כתובת הכניסה (= הטלפון)
      // לפי שם איש צוות — ומאחר שסיסמת ברירת המחדל היא הטלפון, זו היתה
      // השתלטות על חשבון בשתי בקשות. אל תחזיר את ההרשאה ל-anon.
      let email, usedName = false;
      if (id.includes('@')) email = id;
      else if (/^[0-9()+\-\s]+$/.test(id)) email = id.replace(/[^0-9]/g, '') + '@bht.co.il';
      else { usedName = true; email = id + '@bht.co.il'; }
      const { error } = await window.sb.auth.signInWithPassword({ email, password: pw });
      if (error) {
        msg.textContent = usedName
          ? 'כניסה עם שם אינה נתמכת — נא להזין את מספר הטלפון שלך.'
          : 'מספר טלפון או סיסמה שגויים.';
        return;
      }
      msg.textContent = '';   // onAuthStateChange יטען את הפרופיל
    }
  }

  // יכולות לפי תפקיד (בקשת עמנואל): מסכים מותרים + מצב (מלא/צפייה-בלבד/הזנה-בלבד).
  function roleCaps(role) {
    const money = ['cashbox', 'exporter'];
    const entry = ['behavior', 'attendance', 'tests'];  // מסכי הזנה (מלמד)
    const nonMoney = ['behavior', 'attendance', 'tests', 'readassess', 'tla', 'students', 'medical', 'forms', 'calendar', 'reports', 'exporter'];
    switch (role) {
      case 'מנהל':  return { perms: null, mode: 'full', scoped: false };          // הכל + שינויים + כספים
      case 'מפקח':  return { perms: null, mode: 'readonly', scoped: false };       // הכל, ללא שינויים
      case 'מזכירה': return { perms: money, mode: 'full', scoped: false };          // כספים בלבד
      case 'מחנך':  return { perms: nonMoney, mode: 'full', scoped: true };        // הכל חוץ מכספים/ניהול, כיתתו בלבד
      case 'מלמד':  return { perms: entry, mode: 'writeonly', scoped: false };      // הזנה בלבד (לכל התלמידים), בלי צפייה
      default:      return { perms: null, mode: 'full', scoped: false };            // legacy מורה
    }
  }
  window.roleCaps = roleCaps;

  async function setUser(u) {
    A.currentUser = u; window.currentUser = u;
    const caps = roleCaps(u.role);
    // הרשאות מסך: אם המנהל הגדיר perms פרטניות למשתמש — הן גוברות; אחרת ברירת-מחדל לפי התפקיד
    A.perms = (u.perms && u.perms.length) ? u.perms : caps.perms;
    // רמת גישה: אם המנהל הגדיר למשתמש override (full/readonly/writeonly) — גובר על ברירת-המחדל של התפקיד
    A.mode = (u.access_mode && ['full', 'readonly', 'writeonly'].includes(u.access_mode)) ? u.access_mode : caps.mode;
    A.scope = null;                    // null = הכל; מערך = כיתות מורשות
    if (caps.scoped && window.store) {
      try { const acc = await window.store.list('user_class_access', { eq: { user_id: u.id } }); A.scope = acc.map(x => x.class_id); } catch (_) { A.scope = []; }
    }
    // אכיפת מצב צפייה/הזנה דרך class על ה-body (CSS מסתיר כפתורי פעולה / רשימות)
    document.body.classList.remove('mode-readonly', 'mode-writeonly');
    if (A.mode === 'readonly') document.body.classList.add('mode-readonly');
    else if (A.mode === 'writeonly') document.body.classList.add('mode-writeonly');
    renderUserInfo();
    filterByPermissions();
    if (window.showPage) window.showPage('home');
  }

  function renderUserInfo() {
    const box = $('#userInfo');
    if (!box) return;
    if (A.currentUser) {
      box.innerHTML = '<span class="ui-name"><i class="bi bi-person-circle"></i> ' +
        (A.currentUser.name || '') + ' · ' + (A.currentUser.role || '') + '</span>' +
        '<button class="icon-btn" id="pwBtn" title="שינוי סיסמה" aria-label="שינוי סיסמה"><i class="bi bi-key"></i></button>' +
        '<button class="icon-btn" id="helpBtn" title="עזרה והדרכה" aria-label="עזרה"><i class="bi bi-question-lg"></i></button>' +
        '<button class="icon-btn" id="logoutBtn" title="יציאה" aria-label="יציאה"><i class="bi bi-box-arrow-right"></i></button>';
      const pb = $('#pwBtn'); if (pb) pb.addEventListener('click', changeOwnPassword);
      const hb = $('#helpBtn'); if (hb) hb.addEventListener('click', () => { if (window.cv3Help) { const a = document.querySelector('.page.active'); const id = a ? (a.id || '').replace('page-', '') : ''; window.cv3Help(id && id !== 'home' ? id : null); } });
      const lb = $('#logoutBtn'); if (lb) lb.addEventListener('click', logout);
      box.hidden = false;
    } else { box.innerHTML = ''; box.hidden = true; }
  }

  // שינוי סיסמה עצמי — זמין לכל משתמש מחובר (מנהל/מורה/צוות).
  function changeOwnPassword() {
    const u = A.currentUser; if (!u) return;
    window.UI.modal({
      title: 'שינוי הסיסמה שלי', saveLabel: 'עדכן סיסמה', saveAlways: true,
      bodyHTML: '<div class="form-grid">' +
        '<label class="fld fld-wide"><span>סיסמה חדשה *</span><input class="inp mb0" id="cp_new" type="password" autocomplete="new-password"></label>' +
        '<label class="fld fld-wide"><span>אימות סיסמה *</span><input class="inp mb0" id="cp_conf" type="password" autocomplete="new-password"></label>' +
        '</div>',
      onSave: async (mel) => {
        const p1 = mel.querySelector('#cp_new').value, p2 = mel.querySelector('#cp_conf').value;
        if (!p1 || p1.length < 4) { window.UI.toast('סיסמה קצרה מדי (4 תווים לפחות)', 'err'); return false; }
        if (p1 !== p2) { window.UI.toast('הסיסמאות אינן תואמות', 'err'); return false; }
        if (DEMO) { await window.store.update('users', u.id, { password: p1 }); }
        else if (window.sb) { const { error } = await window.sb.auth.updateUser({ password: p1 }); if (error) { window.UI.toast('שגיאה: ' + error.message, 'err'); return false; } }
        window.UI.toast('הסיסמה עודכנה בהצלחה'); return true;
      },
    });
  }

  function filterByPermissions() {
    const u = A.currentUser; if (!u) return;
    const isAdmin = u.role === 'מנהל';
    (window.MODULES || []).forEach(m => {
      let allowed;
      if (isAdmin) allowed = true;
      else if (m.adminOnly) allowed = false;
      else if (A.perms) allowed = A.perms.includes(m.id);   // הרשאות גרנולריות שהמנהל הגדיר
      else allowed = true;                                   // ברירת מחדל — כל המסכים הלא-ניהוליים
      const tile = document.querySelector('.tile[data-id="' + m.id + '"]');
      if (tile) tile.style.display = allowed ? '' : 'none';
      if (!allowed) { const p = document.getElementById('page-' + m.id); if (p) p.classList.remove('active'); }
    });
  }

  async function logout() {
    if (!DEMO && window.sb) { try { await window.sb.auth.signOut(); } catch (_) {} }
    A.currentUser = null; window.currentUser = null;
    document.body.classList.remove('mode-readonly', 'mode-writeonly');
    renderUserInfo();
    if (window.showPage) window.showPage('login');
  }

  async function loadProfile(user) {
    let role = 'צוות', name = user.email, perms = null, access_mode = null;
    try {
      const { data } = await window.sb.from('profiles').select('*').eq('id', user.id).single();
      if (data) { role = data.role || 'צוות'; name = data.name || user.email; perms = data.perms || null; access_mode = data.access_mode || null; }
    } catch (_) {}
    setUser({ id: user.id, email: user.email, name, role, perms, access_mode });
  }

  async function init() {
    buildLoginPage();
    renderUserInfo();
    if (DEMO) { if (window.showPage) window.showPage('login'); return; }
    try {
      const { data: { session } } = await window.sb.auth.getSession();
      if (session && session.user) await loadProfile(session.user);
      else if (window.showPage) window.showPage('login');
      window.sb.auth.onAuthStateChange(async (_e, s) => {
        if (s && s.user) {
          // אל תטען מחדש ואל תחזור לבית אם זה אותו משתמש (רענון טוקן/מעבר טאב מפעילים את האירוע הזה) — רק אם התחלף
          if (!A.currentUser || A.currentUser.id !== s.user.id) await loadProfile(s.user);
        } else if (A.currentUser) {
          A.currentUser = null; window.currentUser = null; renderUserInfo(); if (window.showPage) window.showPage('login');
        }
      });
    } catch (_) { if (window.showPage) window.showPage('login'); }
  }

  window.Auth = {
    init: init, logout: logout, changePassword: changeOwnPassword, get currentUser() { return A.currentUser; }, scopeClasses: function () { return A.scope; },
    get mode() { return A.mode || 'full'; }, isReadonly: function () { return A.mode === 'readonly'; },
    hasPermission: function (m) { const u = A.currentUser; if (!u) return false; return u.role === 'מנהל' || !m.adminOnly; },
    canAccess: function (id) {
      const u = A.currentUser; if (!u) return false;
      if (u.role === 'מנהל') return true;
      const m = (window.MODULES || []).find(x => x.id === id);
      if (m && m.adminOnly) return false;
      if (A.perms) return A.perms.includes(id);
      return true;
    },
  };
})();
