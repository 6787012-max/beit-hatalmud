// admin.js — חלק 7: הגדרות והרשאות (מנהל), בקשות תיקון, יומן פעולות.
(function () {
  'use strict';
  const DEMO = !window.sb;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);

  // כל הנתונים (משתמשים/יומן/בקשות/שכר-לימוד) דרך המאגר המרכזי store.js — אין נתונים מקומיים.

  async function renderSettings(page) {
    const [classes, users, access, audit, feedbacks, cats] = await Promise.all([
      window.cv3Students ? window.cv3Students.getClasses() : [],
      (async () => { const u = await window.store.list('users'); return u.length ? u : window.store.list('profiles'); })(),
      window.store.list('user_class_access'),
      window.store.list('audit_log'), window.store.list('feedback'),
      window.store.list('categories'),
    ]);
    const clsName = id => { const c = classes.find(x => x.id == id); return c ? c.name : ''; };
    const userClasses = uid => access.filter(a => a.user_id == uid).map(a => a.class_id);
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>הגדרות והרשאות</h2></div>' +
      '<div class="qr-card"><h3><i class="bi bi-mortarboard"></i> כיתות</h3><div id="clsList" class="chip-list"></div>' +
        '<div class="qr-grid" style="grid-template-columns:1fr auto;margin-top:10px"><input class="inp mb0" id="newCls" placeholder="שם כיתה חדשה"><button class="btn-primary sm" id="addCls"><i class="bi bi-plus-lg"></i> הוסף</button></div></div>' +
      '<div class="qr-card"><h3><i class="bi bi-tags"></i> קטגוריות התנהגות</h3><p class="login-hint" style="margin:0 0 8px">הקטגוריות מופיעות בבחירה בעת דיווח התנהגות. ניתן להוסיף, לערוך ולמחוק.</p><div id="catList"></div>' +
        '<div class="qr-grid" style="grid-template-columns:1fr auto;margin-top:10px"><input class="inp mb0" id="newCat" placeholder="שם קטגוריה חדשה"><button class="btn-primary sm" id="addCat"><i class="bi bi-plus-lg"></i> הוסף</button></div></div>' +
      '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-people"></i> צוות והרשאות</h3><button class="btn-primary sm" id="usrAdd"><i class="bi bi-person-plus"></i> משתמש חדש</button></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>שם</th><th>טלפון</th><th>תפקיד</th><th>כיתות</th><th>סיסמה</th><th></th></tr></thead><tbody id="usrBody"></tbody></table></div>' +
        '<p class="login-hint" style="margin:8px 2px 0">סיסמת הכניסה הראשונית היא מספר הטלפון. מי שלא החליף ' +
        'מקבל התראה בכניסה, ואחרי שבוע הוא נחסם עד שיחליף.</p></div>' +
      '<div id="staffCard"></div>' +
      '<div class="qr-card"><h3><i class="bi bi-clock-history"></i> יומן פעולות</h3><div id="audList"></div></div>' +
      '<div class="qr-card"><h3><i class="bi bi-bug"></i> בקשות תיקון</h3><div class="qr-grid" style="grid-template-columns:auto 2fr auto"><select class="inp mb0" id="fbKind"><option value="bug">באג</option><option value="idea">רעיון</option></select><textarea class="inp mb0 ta-auto" id="fbBody" rows="2" placeholder="תיאור…"></textarea><button class="btn-primary sm" id="fbSave"><i class="bi bi-send"></i> שלח</button></div><div id="fbList" style="margin-top:10px"></div></div>' +
      '<div class="qr-card"><h3><i class="bi bi-info-circle"></i> אודות</h3><ul class="about-list"><li>מערכת מעקב — מכינה בית התלמוד · גרסה 0.2</li><li>ארכיטקטורה: GitHub Pages + Supabase (RLS)</li><li>מוסד: <b id="aboutInst"></b></li></ul></div>';

    const drawCls = () => { page.querySelector('#clsList').innerHTML = classes.map(c => '<span class="chip ok">' + esc(c.name) + '</span>').join('') || '<span class="tl-note">אין כיתות</span>'; };
    function drawCats() {
      page.querySelector('#catList').innerHTML = cats.length ? cats.map(c =>
        '<div class="tl-item"><span class="sev-dot mid"></span><div class="tl-main">' + esc(c.name) + '</div>' +
        '<button class="mini" data-cedit="' + c.id + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
        '<button class="mini danger" data-cdel="' + c.id + '" title="מחיקה"><i class="bi bi-trash"></i></button></div>').join('')
        : '<div class="tl-note" style="padding:8px">אין קטגוריות עדיין</div>';
      page.querySelectorAll('[data-cedit]').forEach(b => b.addEventListener('click', () => catForm(cats.find(c => c.id == b.dataset.cedit))));
      page.querySelectorAll('[data-cdel]').forEach(b => b.addEventListener('click', async () => {
        const c = cats.find(x => x.id == b.dataset.cdel); if (!c) return;
        if (!(await window.UI.confirm('למחוק את הקטגוריה "' + esc(c.name) + '"? דיווחים קיימים יישמרו.'))) return;
        await window.store.remove('categories', c.id); const i = cats.indexOf(c); if (i >= 0) cats.splice(i, 1);
        drawCats(); window.UI.toast('הקטגוריה נמחקה');
      }));
    }
    function catForm(existing) {
      const c = existing || {};
      window.UI.modal({
        title: existing ? 'עריכת קטגוריה' : 'קטגוריה חדשה', saveLabel: 'שמירה',
        bodyHTML: '<div class="form-grid"><label class="fld fld-wide"><span>שם הקטגוריה *</span><input class="inp mb0" id="cat_name" value="' + esc(c.name) + '"></label></div>',
        onSave: async (mel) => {
          const name = mel.querySelector('#cat_name').value.trim();
          if (!name) { window.UI.toast('שם חובה', 'err'); return false; }
          if (existing) { await window.store.update('categories', c.id, { name }); c.name = name; }
          else { const r = await window.store.add('categories', { name, kind: 'behavior' }); cats.push((r.data && r.data[0]) || { id: Date.now(), name, kind: 'behavior' }); }
          drawCats(); window.UI.toast('נשמר'); return true;
        },
      });
    }
    function drawUsers() {
      page.querySelector('#usrBody').innerHTML = users.map(u => {
        const cls = (u.role === 'מנהל' ? '<span class="tl-note">כל הכיתות</span>' : (userClasses(u.id).map(clsName).filter(Boolean).join(', ') || '—')) +
          (u.role !== 'מנהל' && u.perms && u.perms.length ? ' <span class="det-badge">' + u.perms.length + ' מסכים</span>' : '');
        // pw_changed_at ריק = עדיין בסיסמת ברירת המחדל (הטלפון)
        const pw = u.pw_changed_at
          ? '<span class="chip ok" title="הוחלפה ב-' + esc(String(u.pw_changed_at).slice(0, 10)) + '">הוחלפה</span>'
          : '<span class="chip off" style="color:#b45309;border-color:#b45309" title="עדיין מספר הטלפון">ברירת מחדל</span>';
        return '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.phone || u.tz || '') + '</td><td><span class="chip ' + (u.role === 'מנהל' ? 'ok' : 'off') + '">' + esc(u.role) + '</span></td><td>' + cls + '</td>' +
          '<td>' + pw + '</td>' +
          '<td class="row-act"><button class="mini" data-ucard="' + u.id + '" title="כרטיס איש צוות"><i class="bi bi-person-vcard"></i></button><button class="mini" data-uedit="' + u.id + '" title="עריכה"><i class="bi bi-pencil"></i></button><button class="mini danger" data-udel="' + u.id + '" title="מחיקה"><i class="bi bi-trash"></i></button></td></tr>';
      }).join('');
      page.querySelectorAll('[data-ucard]').forEach(b => b.addEventListener('click', () => { if (window.cv3StaffCard) window.cv3StaffCard.open(b.dataset.ucard); }));
      page.querySelectorAll('[data-uedit]').forEach(b => b.addEventListener('click', () => openUserForm(users.find(u => u.id == b.dataset.uedit))));
      page.querySelectorAll('[data-udel]').forEach(b => b.addEventListener('click', async () => {
        const u = users.find(x => x.id == b.dataset.udel); if (!u) return;
        if (u.role === 'מנהל' && users.filter(x => x.role === 'מנהל').length <= 1) { window.UI.toast('חייב להישאר מנהל אחד לפחות', 'err'); return; }
        const LIVE = !!window.sb;
        if (!(await window.UI.confirm(LIVE ? ('להשבית את המשתמש "' + esc(u.name) + '"? (לא ניתן למחוק לגמרי משתמש מאומת — הוא יושבת ולא יוכל להיכנס)') : ('למחוק את המשתמש "' + esc(u.name) + '"?')))) return;
        if (LIVE) {
          const r = await window.store.update('profiles', u.id, { active: false });
          if (!r || r.ok === false) { window.UI.toast('ההשבתה נכשלה — המשתמש עדיין פעיל', 'err'); return; }
          const i = users.indexOf(u); if (i >= 0) users.splice(i, 1);
        }
        else { await window.store.remove('users', u.id); const i = users.indexOf(u); if (i >= 0) users.splice(i, 1); }
        drawUsers(); window.UI.toast(LIVE ? 'המשתמש הושבת' : 'נמחק');
      }));
    }
    function openUserForm(existing) {
      const u = existing || {};
      const uc = existing ? userClasses(u.id) : [];
      const clsBoxes = classes.map(c => '<label class="cb"><input type="checkbox" value="' + c.id + '"' + (uc.includes(c.id) ? ' checked' : '') + '> ' + esc(c.name) + '</label>').join('');
      const assignable = (window.MODULES || []).filter(m => !m.adminOnly);
      // ברירת מחדל של מסכים לפי התפקיד (null = כל המסכים, כמו מנהל/מפקח); ניתן להתאמה אישית
      const roleDefPerms = r => { try { const c = window.roleCaps && window.roleCaps(r); return c ? c.perms : null; } catch (_) { return null; } };
      const up = (existing && u.perms && u.perms.length) ? u.perms : (roleDefPerms(u.role || 'מחנך') || assignable.map(m => m.id));
      const permBoxes = assignable.map(m => '<label class="cb"><input type="checkbox" value="' + m.id + '"' + (up.includes(m.id) ? ' checked' : '') + '> ' + esc(m.label) + '</label>').join('');
      const mm = window.UI.modal({
        title: existing ? 'עריכת משתמש והרשאות' : 'משתמש חדש', saveLabel: 'שמירה',
        bodyHTML:
          '<div class="form-grid">' +
          '<label class="fld"><span>שם מלא * <small style="font-weight:400;color:var(--muted)">(שם הכניסה)</small></span><input class="inp mb0" id="u_name" value="' + esc(u.name) + '"></label>' +
          '<label class="fld"><span>טלפון * <small style="font-weight:400;color:var(--muted)">(סיסמה ראשונית)</small></span><input class="inp mb0" id="u_phone" value="' + esc(u.phone || u.tz || '') + '"></label>' +
          '<label class="fld"><span>סיסמה ' + (existing ? '(ריק = טלפון/ללא שינוי)' : '(ריק = הטלפון)') + '</span>' +
            '<div style="display:flex;gap:6px"><input class="inp mb0" id="u_pw" type="password" placeholder="סיסמה" style="flex:1" value="' + esc(existing ? (u.password || '') : '') + '">' +
            '<button type="button" class="btn-ghost sm" id="u_pw_show" title="הצג/הסתר"><i class="bi bi-eye"></i></button></div></label>' +
          '<label class="fld"><span>תפקיד</span><select class="inp mb0" id="u_role">' +
            ['מנהל', 'מחנך', 'מלמד', 'מפקח', 'מזכירה'].map(r => '<option' + ((u.role === r || (!u.role && r === 'מחנך')) ? ' selected' : '') + '>' + r + '</option>').join('') +
            '</select></label>' +
          '<label class="fld"><span>רמת גישה <small style="font-weight:400;color:var(--muted)">— מה מותר לו לעשות</small></span><select class="inp mb0" id="u_mode">' +
            [['', 'ברירת מחדל (לפי תפקיד)'], ['full', 'גישה מלאה — צפייה + עריכה'], ['readonly', 'צפייה בלבד — בלי לערוך'], ['writeonly', 'הזנה בלבד — בלי לצפות']].map(o => '<option value="' + o[0] + '"' + (((u.access_mode || '') === o[0]) ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
            '</select></label>' +
          '<div class="fld fld-wide"><span>כיתות מורשות</span>' +
            '<div class="cb-grid" id="classGrid">' + (clsBoxes || '<span class="tl-note">אין כיתות — הוסף כיתה קודם</span>') + '</div>' +
            '<div style="margin-top:7px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              '<button type="button" class="btn-ghost sm" id="clsAll">כל השיעורים</button>' +
              '<button type="button" class="btn-ghost sm" id="clsNone">נקה הכל</button>' +
              '<span class="tl-note" id="clsHint" style="font-size:.78rem"></span>' +
            '</div></div>' +
          '<div class="fld fld-wide"><span>מסכים מורשים <small style="font-weight:400;color:var(--muted)">— מנהל רואה הכל</small></span>' +
            '<div class="cb-grid" id="permGrid">' + permBoxes + '</div>' +
            '<div style="margin-top:7px;display:flex;gap:6px"><button type="button" class="btn-ghost sm" id="permAll">סמן הכל</button><button type="button" class="btn-ghost sm" id="permNone">נקה הכל</button></div></div>' +
          '</div>',
        onSave: async (mel) => {
          const name = mel.querySelector('#u_name').value.trim(), phone = mel.querySelector('#u_phone').value.trim(), pw = mel.querySelector('#u_pw').value, role = mel.querySelector('#u_role').value;
          const access_mode = mel.querySelector('#u_mode').value || null;   // null = ברירת מחדל לפי תפקיד
          if (!name || !phone) { window.UI.toast('שם וטלפון חובה', 'err'); return false; }
          const chosenPerms = [...mel.querySelectorAll('#permGrid input:checked')].map(c => c.value);
          const allIds = assignable.map(m => m.id);
          // perms=null → ברירת-מחדל לפי התפקיד (roleCaps); רק אם המנהל צמצם ידנית נשמור רשימה
          // שמירה מפורשת: מה שסומן = מה שהמשתמש רואה (מנהל=null=הכל). כך שליטה מדויקת מסך-מסך.
          const perms = (role === 'מנהל') ? null : chosenPerms;
          const LIVE = !!window.sb;
          let uid;
          if (!LIVE) {
            // ── מצב הדגמה: טבלת users בזיכרון ──
            const row = { name, phone, role, perms, access_mode, password: pw || phone };
            if (existing) { await window.store.update('users', u.id, row); Object.assign(u, row); uid = u.id; }
            else { const r = await window.store.add('users', row); const nu = (r.data && r.data[0]) || Object.assign({ id: Date.now() }, row); uid = nu.id; users.push(nu); }
          } else if (existing) {
            // ── חי: עדכון פרופיל קיים (שם/תפקיד/הרשאות) ──
            const ur = await window.store.update('profiles', u.id, { name, role, tz: phone, perms, access_mode });
            if (!ur || ur.ok === false) { window.UI.toast('עדכון המשתמש נכשל: ' + ((ur && ur.error) || ''), 'err'); return false; }
            Object.assign(u, { name, role, tz: phone, perms, access_mode }); uid = u.id;
            // מנהל שאיפס סיסמה — המשתמש חוזר להיות "לא החליף" ויתבקש שוב.
            // אחרת סיסמה שהמנהל קבע היתה נחשבת לנצח כסיסמה שהמשתמש בחר.
            if (pw && window.sb) {
              try { await window.sb.rpc('pw_reset_flag', { p_user: u.id }); u.pw_changed_at = null; } catch (_) {}
            }
          } else {
            // ── חי: יצירת משתמש אמיתי דרך Supabase Auth (client זמני שלא נוגע בסשן המנהל) ──
            const C = window.CV3 || {};
            const tmp = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
            const email = phone + '@bht.co.il';
            const password = (pw && pw.length >= 6) ? pw : phone;   // Supabase דורש 6+ תווים; ברירת מחדל = הטלפון
            if (password.length < 6) { window.UI.toast('הטלפון חייב לפחות 6 ספרות (או הזן סיסמה 6+ תווים)', 'err'); return false; }
            const { data, error } = await tmp.auth.signUp({ email, password, options: { data: { name } } });
            if (error) { window.UI.toast('שגיאה ביצירת משתמש: ' + error.message, 'err'); return false; }
            uid = data && data.user && data.user.id;
            if (!uid) { window.UI.toast('המשתמש לא נוצר (אולי המספר כבר קיים)', 'err'); return false; }
            await new Promise(r => setTimeout(r, 500));   // המתנה לטריגר שיוצר את הפרופיל
            const upd = await window.store.update('profiles', uid, { name, role, tz: phone, perms, access_mode, active: true });
            if (upd && upd.ok === false) { window.UI.toast('המשתמש נוצר אך עדכון הפרופיל נכשל: ' + (upd.error || ''), 'err'); }
            users.push({ id: uid, name, phone, tz: phone, role, perms, access_mode });
          }
          const chosen = [...mel.querySelectorAll('#classGrid input:checked')].map(c => Number(c.value));
          // user_class_access הוא מפתח מורכב ללא עמודת id — remove לפי id לא מוחק כלום,
          // וכיתות ישנות נשארו מוצמדות למשתמש לנצח (זחילת הרשאות). מוחקים לפי user_id.
          await window.store.removeBy('user_class_access', { user_id: uid });
          for (let i = access.length - 1; i >= 0; i--) if (access[i].user_id == uid) access.splice(i, 1);
          for (const cid of chosen) { const r = await window.store.add('user_class_access', { user_id: uid, class_id: cid }); access.push((r.data && r.data[0]) || { user_id: uid, class_id: cid }); }
          drawUsers();
          window.UI.toast(existing ? 'המשתמש עודכן' : ('משתמש נוסף — כניסה: ' + phone + ' · סיסמה: ' + ((pw && pw.length >= 6) ? pw : phone)));
          return true;
        },
      });
      // כפתורי הכל/נקה + השבתת הרשאות למנהל (רואה הכל)
      const pg = mm.el.querySelector('#permGrid'), roleSel = mm.el.querySelector('#u_role');
      mm.el.querySelector('#permAll').addEventListener('click', () => pg.querySelectorAll('input').forEach(c => c.checked = true));
      mm.el.querySelector('#permNone').addEventListener('click', () => pg.querySelectorAll('input').forEach(c => c.checked = false));
      const cg = mm.el.querySelector('#classGrid'), clsHint = mm.el.querySelector('#clsHint');
      mm.el.querySelector('#clsAll').addEventListener('click', () => cg.querySelectorAll('input').forEach(c => c.checked = true));
      mm.el.querySelector('#clsNone').addEventListener('click', () => cg.querySelectorAll('input').forEach(c => c.checked = false));
      // הכיתות המסומנות מגבילות בפועל **מחנך ומלמד** — ב-RLS
      // (migration_staff_view_scope.sql). מנהל ומפקח רואים הכל.
      // ההבדל בין השניים: מחנך בלי סימון לא רואה אף תלמיד, ואילו מלמד בלי
      // סימון רואה את כל המכינה — הסימון עבורו הוא צמצום, לא הפעלה.
      const CLS_HINT = {
        'מחנך':  'הרב יראה — ויערוך — רק את תלמידי השיעורים המסומנים. אפשר לסמן אחד, שניים או את כולם.',
        'מנהל':  'מנהל רואה את כל השיעורים; אין מה לסמן.',
        'מלמד':  'בלי סימון — הרב רואה ומזין לכל תלמידי המכינה. סימון שיעורים מצמצם אותו אליהם בלבד.',
        'מפקח':  'מפקח צופה בכל המוסד — הסימון כאן לא מגביל אותו.',
        'מזכירה': 'מזכירה עובדת מול כספים ומנהלה — הסימון כאן לא מגביל אותה.',
      };
      const toggleAdmin = () => {
        const dis = roleSel.value === 'מנהל';
        mm.el.querySelectorAll('#permGrid input, #classGrid input, #permAll, #permNone, #clsAll, #clsNone')
          .forEach(el => { el.disabled = dis; });
        if (clsHint) clsHint.textContent = CLS_HINT[roleSel.value] || '';
      };
      // בשינוי תפקיד — עדכן את הסימונים לברירת-המחדל של התפקיד החדש (המנהל יכול אחר-כך להתאים ידנית)
      roleSel.addEventListener('change', () => {
        toggleAdmin();
        if (roleSel.value !== 'מנהל') {
          const rd = roleDefPerms(roleSel.value) || assignable.map(m => m.id);
          pg.querySelectorAll('input').forEach(c => { c.checked = rd.includes(c.value); });
        }
      });
      toggleAdmin();
      // הצג/הסתר סיסמה (המנהל רשאי לראות ולערוך את סיסמת המשתמש)
      const pwInp = mm.el.querySelector('#u_pw'), pwBtn = mm.el.querySelector('#u_pw_show');
      if (pwBtn) pwBtn.addEventListener('click', () => { const t = pwInp.type === 'password'; pwInp.type = t ? 'text' : 'password'; pwBtn.innerHTML = '<i class="bi bi-eye' + (t ? '-slash' : '') + '"></i>'; });
    }
    page.querySelector('#audList').innerHTML = (audit.length ? audit.slice().reverse() : []).map(a => '<div class="tl-item"><span class="sev-dot lo"></span><div class="tl-main">' + esc(a.detail) + '</div><div class="tl-meta">' + esc(a.created_at) + '</div></div>').join('') || '<div class="tl-note" style="padding:8px">אין פעולות</div>';
    const drawFb = () => { page.querySelector('#fbList').innerHTML = feedbacks.slice().reverse().map(f => '<div class="tl-item"><span class="sev-dot ' + (f.kind === 'bug' ? 'hi' : 'lo') + '"></span><div class="tl-main">' + (f.kind === 'bug' ? 'באג' : 'רעיון') + ' — ' + esc(f.body) + '</div></div>').join(''); };
    const ai = document.getElementById('aboutInst'); if (ai) ai.textContent = (window.CV3 || {}).INSTANCE_NAME || '';

    page.querySelector('#usrAdd').addEventListener('click', () => openUserForm(null));
    page.querySelector('#addCls').addEventListener('click', async () => {
      const n = page.querySelector('#newCls').value.trim(); if (!n) return;
      const r = await window.cv3Students.addClass(n); if (r.ok) { classes.push({ id: r.id || Date.now(), name: n }); page.querySelector('#newCls').value = ''; drawCls(); window.UI.toast('כיתה נוספה'); }
    });
    page.querySelector('#addCat').addEventListener('click', async () => {
      const n = page.querySelector('#newCat').value.trim(); if (!n) return;
      const r = await window.store.add('categories', { name: n, kind: 'behavior' });
      cats.push((r.data && r.data[0]) || { id: Date.now(), name: n, kind: 'behavior' });
      page.querySelector('#newCat').value = ''; drawCats(); window.UI.toast('קטגוריה נוספה');
    });
    page.querySelector('#fbSave').addEventListener('click', async () => {
      const body = page.querySelector('#fbBody').value.trim(); if (!body) return;
      const kind = page.querySelector('#fbKind').value;
      const r = await window.store.add('feedback', { kind, body });
      feedbacks.push((r.data && r.data[0]) || { kind, body }); page.querySelector('#fbBody').value = ''; drawFb(); window.UI.toast('נשלח, תודה');
    });
    if (window.cv3Staff) window.cv3Staff.render(page.querySelector('#staffCard'));
    drawCls(); drawCats(); drawUsers(); drawFb();
  }

  // מסך שכר הלימוד הוסר (2026-08-23): גוף חיצוני מטפל בגבייה, ולכן אין
  // למוסד מה לנהל כאן. הטבלה במסד הייתה ריקה ונמחקה יחד עם המסך.

  const R = window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  R.settings = renderSettings;
})();
