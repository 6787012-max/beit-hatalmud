// yemot-line.js — ניהול קו המכינה (0733518751) בשפה של המכינה, לא בשפה של ימות.
//
// נטען בתוך מסך "קו ימות המשיח" (עוגן #ymLineCard) ומשתמש ב-window.Yemot.
// מבנה הקו (נבנה 24/08/2026, ראה .local/build_line.py):
//   /            go_to_folder + FileGoToFolder.ini  — מזהה את המתקשר ומנתב לשיעור שלו
//   /0           תפריט ראשי (מי שלא זוהה)
//   /1../4       שיעור א / ב / ג1 / ג2   → N/1 הודעות · N/2 רישום · N/3 הודעה למכינה · N/9 כללי
//   /5           השארת הודעה (חיצוניים)   /6  עדכונים כלליים
//   /7           רישום לצינתוק            /8  הקלטות מנהל (בסיסמה)
//   /9           דיווח קולי לצוות — לא נגעים בו מכאן.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // שיעור → שלוחה. חייב להתאים ל-CLASS_EXT ב-.local/build_routing.py.
  const SHIURIM = [
    { ext: '1', name: 'שיעור א', cls: 'שיעור א' },
    { ext: '2', name: 'שיעור ב', cls: 'שיעור ב' },
    { ext: '3', name: 'שיעור ג1', cls: 'שיעור ג1 - הרב יודלוב' },
    { ext: '4', name: 'שיעור ג2', cls: 'שיעור ג2 - הרב קרשנר' }
  ];
  // יעדי הודעות: שלוחת האחסון + רשימת התפוצה שמצנתקים אליה
  const TARGETS = SHIURIM.map(s => ({ key: s.ext, label: s.name, folder: 'ivr2:/' + s.ext + '/1', list: s.ext }))
    .concat([{ key: 'all', label: 'כל השיעורים', folder: 'ivr2:/6', list: '5' }]);
  // שלוחות שהטקסט שלהן ניתן לעריכה מכאן
  const VOICES = [
    { path: 'ivr2:/0', label: 'תפריט ראשי (מי שלא זוהה)' },
    { path: 'ivr2:/1', label: 'שיעור א' }, { path: 'ivr2:/2', label: 'שיעור ב' },
    { path: 'ivr2:/3', label: 'שיעור ג1' }, { path: 'ivr2:/4', label: 'שיעור ג2' },
    { path: 'ivr2:/7', label: 'רישום לצינתוק' },
    { path: 'ivr2:/8', label: 'הקלטות מנהל', pass: true }
  ];
  const WHITELIST = 'ivr2:9/WhiteList.ini';
  const ROUTING = 'ivr2:/FileGoToFolder.ini';

  const Y = () => window.Yemot;

  const normPhone0 = v => {
    if (!v) return null;
    let d = String(v).replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.slice(3);
    if (!d.startsWith('0')) d = '0' + d;
    return (d.length >= 9 && d.length <= 10) ? d : null;
  };

  // מספרי ההורים לפי שיעור, ישירות מ-Supabase. זהו מקור האמת לשידור בתשלום —
  // הרשימה החינמית (tzl:) סגורה להזרקה ומכילה רק את מי שנרשם בעצמו.
  let rosterCache = null;
  async function roster() {
    if (rosterCache) return rosterCache;
    const [st, cl] = await Promise.all([window.db.list('students', {}), window.db.list('classes', {})]);
    if (!st.ok || !cl.ok) throw new Error('לא ניתן לקרוא את נתוני המערכת');
    const clsName = {}; cl.data.forEach(c => { clsName[c.id] = c.name; });
    const extOf = {}; SHIURIM.forEach(x => { extOf[x.cls] = x.ext; });
    const out = { '1': new Set(), '2': new Set(), '3': new Set(), '4': new Set() };
    st.data.forEach(s => {
      const ext = extOf[clsName[s.class_id]];
      if (!ext) return;
      const reg = s.reg || {};
      [s.parent_phone, s.mother_phone, reg['נייד אב'], reg['נייד אם'], reg['טלפון בבית']]
        .map(normPhone0).filter(Boolean).forEach(ph => out[ext].add(ph));
    });
    rosterCache = { '1': [...out['1']], '2': [...out['2']], '3': [...out['3']], '4': [...out['4']] };
    rosterCache.all = [...new Set([].concat(rosterCache['1'], rosterCache['2'], rosterCache['3'], rosterCache['4']))];
    return rosterCache;
  }

  const UNIT_PER_CALL = 0.1;   // אומת חי מול RunTzintuk (bilingPerCall)
  async function units() {
    try { const s = await Y().call('GetSession'); return typeof s.units === 'number' ? s.units : null; }
    catch (_) { return null; }
  }

  let host = null, blob = null;   // blob = הקול שנוצר/נבחר וממתין להעלאה

  // ---------- שלד ----------
  function mount(el) {
    if (!el) return;
    host = el;
    el.className = 'qr-card';
    el.innerHTML =
      '<div class="card-h-row"><h3><i class="bi bi-broadcast"></i> ניהול קו המכינה</h3>' +
        '<span class="count-line">קו 0733518751</span></div>' +
      '<div class="ym-tabs" id="ylTabs">' +
        '<button class="ym-tab on" data-t="msg"><i class="bi bi-megaphone"></i> הודעות לשיעורים</button>' +
        '<button class="ym-tab" data-t="lists"><i class="bi bi-people"></i> רשימות תפוצה</button>' +
        '<button class="ym-tab" data-t="route"><i class="bi bi-person-badge"></i> זיהוי מתקשרים</button>' +
        '<button class="ym-tab" data-t="voice"><i class="bi bi-chat-quote"></i> טקסטים של התפריטים</button></div>' +
      '<div class="ym-pane" data-p="msg"></div>' +
      '<div class="ym-pane" data-p="lists" hidden></div>' +
      '<div class="ym-pane" data-p="route" hidden></div>' +
      '<div class="ym-pane" data-p="voice" hidden></div>';

    el.querySelectorAll('#ylTabs .ym-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('#ylTabs .ym-tab').forEach(x => x.classList.toggle('on', x === t));
      el.querySelectorAll(':scope > .ym-pane').forEach(p => { p.hidden = p.dataset.p !== t.dataset.t; });
      const fn = { msg: renderMsg, lists: renderLists, route: renderRoute, voice: renderVoice }[t.dataset.t];
      if (fn) fn();
    }));
    renderMsg();
  }
  const pane = k => host.querySelector('.ym-pane[data-p="' + k + '"]');
  const note = (box, txt, cls) => { box.innerHTML = '<div class="empty-state" style="padding:14px">' + esc(txt) + '</div>'; };

  // ---------- 1. הודעות לשיעורים ----------
  function renderMsg() {
    const p = pane('msg');
    p.innerHTML =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
        '<label class="lbl mb0">שיעור היעד</label>' +
        '<select class="inp mb0" id="ylTarget" style="width:auto">' +
          TARGETS.map(t => '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('') +
        '</select>' +
        '<button class="btn-ghost sm" id="ylMsgRefresh"><i class="bi bi-arrow-clockwise"></i> רענון</button></div>' +

      '<div id="ylMsgList"><div class="empty-state" style="padding:14px">טוען…</div></div>' +

      '<hr style="border:none;border-top:1px solid var(--line);margin:14px 0">' +
      '<label class="lbl">הודעה חדשה</label>' +
      '<textarea class="inp" id="ylText" rows="3" placeholder="כתבו את ההודעה — היא תוקרא בקול ותעלה לשלוחה של השיעור…"></textarea>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
        '<button class="btn-ghost sm" id="ylGen"><i class="bi bi-soundwave"></i> צור קול</button>' +
        '<span class="count-line">או</span>' +
        '<input class="inp mb0" id="ylFile" type="file" accept="audio/*" style="width:auto">' +
        '<audio id="ylPrev" controls style="display:none;height:36px"></audio></div>' +
      '<label class="lbl" style="margin-top:12px">אחרי ההעלאה</label>' +
      '<div style="display:flex;flex-direction:column;gap:6px">' +
        '<label class="ym-check"><input type="radio" name="ylTzMode" value="none" checked> ' +
          'רק להעלות — בלי לצלצל לאיש</label>' +
        '<label class="ym-check"><input type="radio" name="ylTzMode" value="free"> ' +
          'צינתוק לנרשמים בלבד <span class="count-line">(חינם, רק מי שנרשם בשלוחה 7)</span></label>' +
        '<label class="ym-check"><input type="radio" name="ylTzMode" value="roster"> ' +
          'צינתוק לכל הורי השיעור מהמערכת <span class="count-line" id="ylTzCost">…</span></label></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px">' +
        '<button class="btn-primary sm" id="ylUpload" disabled><i class="bi bi-upload"></i> העלה לשלוחה</button>' +
        '<span class="count-line" id="ylBal"></span></div>' +
      '<div id="ylMsgOut" class="count-line" style="margin-top:8px;min-height:1.2em"></div>' +
      '<p class="login-hint" style="margin-top:6px"><i class="bi bi-info-circle"></i> ' +
        'הצינתוק רק מצלצל — הנמען מתקשר בחזרה ושומע. הוא לא משמיע את ההודעה בשיחה עצמה. ' +
        'שידור לרשימת המערכת עולה ' + UNIT_PER_CALL + ' יחידה לשיחה; לנרשמים — חינם.</p>';

    p.querySelector('#ylTarget').addEventListener('change', loadMsgs);
    p.querySelector('#ylMsgRefresh').addEventListener('click', loadMsgs);
    p.querySelector('#ylGen').addEventListener('click', genVoice);
    p.querySelector('#ylFile').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      blob = f; showPrev(URL.createObjectURL(f)); p.querySelector('#ylUpload').disabled = false;
    });
    p.querySelector('#ylUpload').addEventListener('click', upload);
    p.querySelector('#ylTarget').addEventListener('change', showCost);
    loadMsgs(); showCost(); showBalance();
  }

  const curTarget = () => TARGETS.find(t => t.key === pane('msg').querySelector('#ylTarget').value) || TARGETS[0];

  function showPrev(url) {
    const a = pane('msg').querySelector('#ylPrev');
    a.src = url; a.style.display = '';
  }

  async function genVoice() {
    const p = pane('msg'), txt = p.querySelector('#ylText').value.trim(), out = p.querySelector('#ylMsgOut');
    if (!txt) { out.textContent = 'כתבו קודם את ההודעה.'; return; }
    const btn = p.querySelector('#ylGen'); btn.disabled = true; out.textContent = 'יוצר קול…';
    try {
      blob = await window.geminiSpeak(txt);
      showPrev(URL.createObjectURL(blob));
      p.querySelector('#ylUpload').disabled = false;
      out.textContent = 'הקול מוכן — האזינו ואז העלו.';
    } catch (e) { out.textContent = 'שגיאה ביצירת הקול: ' + (e.message || e); }
    finally { btn.disabled = false; }
  }

  async function loadMsgs() {
    const box = pane('msg').querySelector('#ylMsgList'), t = curTarget();
    note(box, 'טוען…');
    try {
      const d = await Y().call('GetIVR2Dir', { path: t.folder });
      if (d.responseStatus !== 'OK') { note(box, d.message || 'לא ניתן לטעון'); return; }
      // קבצי ההודעות בלבד — לא הודעות מערכת (M####) ולא לוגים
      const files = (d.files || []).filter(f => /^\d{3}\.(wav|mp3)$/i.test(f.name || ''));
      if (!files.length) { note(box, 'אין הודעות בשלוחה של ' + t.label + '.'); return; }
      box.innerHTML = files.sort((a, b) => b.name.localeCompare(a.name)).map(f => {
        const full = t.folder + '/' + f.name;
        return '<div class="ym-row"><span class="ym-ic"><i class="bi bi-play-circle"></i></span>' +
          '<div class="ym-main"><b>' + esc(f.name) + '</b></div>' +
          '<audio controls preload="none" src="' + esc(Y().downloadUrl(full)) + '" style="height:34px;max-width:200px"></audio>' +
          '<button class="btn-ghost sm" data-del="' + esc(full) + '"><i class="bi bi-trash"></i></button></div>';
      }).join('');
      box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delMsg(b.dataset.del)));
    } catch (e) { note(box, 'שגיאת רשת בטעינת ההודעות.'); }
  }

  async function delMsg(path) {
    if (!confirm('למחוק את ההודעה ' + path.split('/').pop() + '? אי אפשר לשחזר.')) return;
    const r = await Y().call('FileAction', { what: path, action: 'delete' });
    if (r.responseStatus === 'OK') { window.UI.toast('ההודעה נמחקה', 'ok'); loadMsgs(); }
    else window.UI.toast(r.message || 'המחיקה נכשלה', 'err');
  }

  async function upload() {
    const p = pane('msg'), out = p.querySelector('#ylMsgOut'), t = curTarget();
    if (!blob) { out.textContent = 'אין קול להעלאה.'; return; }
    const mode = (p.querySelector('input[name="ylTzMode"]:checked') || {}).value || 'none';

    // אישור מפורש לפני כל שידור — צינתוק מצלצל לאנשים אמיתיים ואי אפשר לבטל אותו.
    if (mode === 'roster') {
      let list;
      try { list = (await roster())[t.key] || []; }
      catch (e) { out.textContent = 'לא ניתן לקרוא את רשימת ההורים: ' + (e.message || e); return; }
      if (!list.length) { out.textContent = 'אין מספרי הורים ל' + t.label + '.'; return; }
      const bal = await units(), costN = list.length * UNIT_PER_CALL, cost = costN.toFixed(1);
      if (bal !== null && bal < costN) {
        out.textContent = 'היתרה בקו היא ' + bal + ' יחידות — צריך ' + cost + '. טענו יחידות קודם.';
        return;
      }
      if (!confirm('לצלצל ל-' + list.length + ' מספרי הורים של ' + t.label + '?' +
                   String.fromCharCode(10) + 'עלות: ' + cost + ' יחידות. אי אפשר לעצור אחרי הלחיצה.')) return;
      p.__tzPhones = list;
    } else if (mode === 'free') {
      if (!confirm('לצלצל לכל מי שנרשם לצינתוק של ' + t.label + '? אי אפשר לעצור אחרי הלחיצה.')) return;
    }

    const btn = p.querySelector('#ylUpload'); btn.disabled = true; out.textContent = 'מעלה…';
    try {
      const r = await Y().uploadBlob(t.folder, blob, 'msg.wav');
      if (r.responseStatus !== 'OK') { out.textContent = 'ההעלאה נכשלה: ' + (r.message || ''); return; }
      out.textContent = 'ההודעה עלתה ל' + t.label + '.';
      if (mode !== 'none') {
        // path = שלוחת ההקלטה של המנהל, זו שמחזיקה את list_tzintuk.
        // phones: tzl:<רשימה> = המודל החינמי · רשימת מספרים = שידור בתשלום מנתוני המערכת.
        const params = { path: 'ivr2:/8/' + (t.key === 'all' ? '5' : t.key) };
        params.phones = mode === 'free' ? ('tzl:' + t.list) : p.__tzPhones.join(',');
        const tz = await Y().call('RunTzintuk', params);
        out.textContent += tz.responseStatus === 'OK'
          ? ' הצינתוק יצא ל-' + (tz.callsCount != null ? tz.callsCount : '?') + ' מספרים (חיוב: ' + (tz.biling || '0.00') + ').'
          : ' ⚠️ הצינתוק נכשל: ' + (tz.message || '');
        showBalance();
      }
      blob = null; p.querySelector('#ylText').value = '';
      p.querySelector('#ylPrev').style.display = 'none';
      loadMsgs();
    } catch (e) { out.textContent = 'שגיאת רשת בהעלאה.'; }
    finally { btn.disabled = false; }
  }

  async function showCost() {
    const el = pane('msg').querySelector('#ylTzCost'); if (!el) return;
    el.textContent = '(טוען…)';
    try {
      const n = ((await roster())[curTarget().key] || []).length;
      el.textContent = '(' + n + ' מספרים · ' + (n * UNIT_PER_CALL).toFixed(1) + ' יחידות)';
    } catch (_) { el.textContent = '(לא ניתן לקרוא את המערכת)'; }
  }

  async function showBalance() {
    const el = pane('msg').querySelector('#ylBal'); if (!el) return;
    const b = await units();
    el.innerHTML = b === null ? '' :
      (b > 0 ? 'יתרה: ' + b + ' יחידות'
             : '<span style="color:var(--danger,#b42318)">יתרה 0 — שידור בתשלום לא ירוץ</span>');
  }

  // ---------- 2. רשימות תפוצה ----------
  // שתי רשימות נפרדות לכל שיעור, וזה לא כפל:
  //   רשימת המערכת  = כל מספרי ההורים מ-Supabase. שידור אליה עולה 0.1 יחידה לשיחה.
  //   רשימת הנרשמים = רק מי שהתקשר ונרשם בעצמו. שידור אליה חינם.
  // ימות חוסמת הזרקת מספרים לרשימה החינמית (TzintukimListManagement דוחה כל action) —
  // זה התנאי שלה לצינתוק בחינם. לכן אי אפשר "להעתיק" את רשימת המערכת לתוכה.
  async function renderLists() {
    const p = pane('lists');
    p.innerHTML =
      '<p class="login-hint" style="margin-top:0">לכל שיעור שתי רשימות. ' +
      '<b>רשימת המערכת</b> — כל הורי השיעור לפי מה שמעודכן בתוכנה, תמיד מלאה, ושידור אליה בתשלום. ' +
      '<b>רשימת הנרשמים</b> — רק מי שהתקשר ונרשם בעצמו, ושידור אליה חינם. ' +
      'ימות לא מאפשרת להזין מספרים לרשימה החינמית — זה התנאי שלה לחינם.</p>' +
      '<div id="ylLists"><div class="empty-state" style="padding:14px">טוען…</div></div>';
    const box = p.querySelector('#ylLists');
    const defs = SHIURIM.map(s => ({ key: s.ext, label: s.name, path: 'ivr2:/7/' + s.ext }))
      .concat([{ key: 'all', label: 'כל השיעורים', path: 'ivr2:/7/5' }]);
    let ros = null;
    try { ros = await roster(); } catch (_) {}
    const rows = [];
    for (const d of defs) {
      let nums = [];
      try {
        const r = (await Y().getText(d.path + '/tzintuk.ini')) || '';   // getText מחזיר מחרוזת, לא אובייקט
        nums = r.split(/\r?\n/).map(x => x.trim())
          .filter(x => /^0\d{7,9}/.test(x)).map(x => x.split(/[=,\s]/)[0]);
      } catch (_) { /* אין קובץ = אין נרשמים */ }
      const sys = ros ? (ros[d.key] || []) : null;
      rows.push('<div class="ym-row" style="align-items:flex-start">' +
        '<span class="ym-ic"><i class="bi bi-people"></i></span>' +
        '<div class="ym-main"><b>' + esc(d.label) + '</b>' +
          '<div class="count-line">רשימת המערכת: <b>' + (sys === null ? '—' : sys.length) + '</b> מספרים' +
            (sys && sys.length ? ' · ' + (sys.length * UNIT_PER_CALL).toFixed(1) + ' יחידות לשידור' : '') + '</div>' +
          '<div class="count-line">רשימת הנרשמים (חינם): <b>' + nums.length + '</b>' +
            (nums.length ? ' — <span dir="ltr">' + nums.map(esc).join(' · ') + '</span>' : ' — אין נרשמים') + '</div>' +
        '</div></div>');
    }
    box.innerHTML = rows.join('');
  }

  // ---------- 3. זיהוי מתקשרים ----------
  function renderRoute() {
    const p = pane('route');
    p.innerHTML =
      '<p class="login-hint" style="margin-top:0">כל טלפון הורה שמעודכן במערכת מנותב אוטומטית לשלוחת השיעור של בנו, ' +
      'בלי לעבור בתפריט. מי שלא ברשימה — צוות, חיצוניים — שומע את התפריט הראשי.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
        '<button class="btn-ghost sm" id="ylRtBuild"><i class="bi bi-arrow-repeat"></i> בנה מחדש מנתוני המערכת</button>' +
        '<button class="btn-primary sm" id="ylRtPush" disabled><i class="bi bi-upload"></i> העלה לקו</button>' +
        '<button class="btn-ghost sm" id="ylRtShow"><i class="bi bi-eye"></i> מה יש בקו עכשיו</button></div>' +
      '<div id="ylRtOut"><div class="empty-state" style="padding:14px">לחצו "בנה מחדש" כדי לראות תצוגה מקדימה.</div></div>';
    p.querySelector('#ylRtBuild').addEventListener('click', buildRouting);
    p.querySelector('#ylRtPush').addEventListener('click', pushRouting);
    p.querySelector('#ylRtShow').addEventListener('click', showRouting);
  }

  const normPhone = v => {
    if (!v) return null;
    let d = String(v).replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.slice(3);
    if (!d.startsWith('0')) d = '0' + d;
    return (d.length >= 9 && d.length <= 10) ? d : null;
  };

  let builtIni = '';
  async function buildRouting() {
    const box = pane('route').querySelector('#ylRtOut');
    note(box, 'קורא תלמידים וכיתות…');
    try {
      const [st, cl] = await Promise.all([
        window.db.list('students', {}), window.db.list('classes', {})
      ]);
      if (!st.ok || !cl.ok) { note(box, 'לא ניתן לקרוא את נתוני המערכת.'); return; }
      const byId = {}; cl.data.forEach(c => { byId[c.id] = c.name; });
      const extOf = {}; SHIURIM.forEach(s => { extOf[s.cls] = s.ext; });

      // אנשי צוות מוחרגים — אחרת הם ננעלים בשלוחת השיעור ומאבדים את שלוחה 9
      let staff = new Set();
      try {
        const w = (await Y().getText(WHITELIST)) || '';
        w.split(/\r?\n/).forEach(l => {
          const m = l.trim().match(/^(0\d{8,9})$/); if (m) staff.add(m[1]);
        });
      } catch (_) {}

      const map = {}, who = {};
      st.data.forEach(s => {
        const ext = extOf[byId[s.class_id]];
        if (!ext) return;
        const reg = s.reg || {};
        [s.parent_phone, s.mother_phone, reg['נייד אב'], reg['נייד אם'], reg['טלפון בבית']]
          .map(normPhone).filter(Boolean).forEach(ph => {
            (map[ph] = map[ph] || new Set()).add(ext);
            (who[ph] = who[ph] || new Set()).add(s.name || '');
          });
      });
      const excluded = Object.keys(map).filter(ph => staff.has(ph));
      excluded.forEach(ph => delete map[ph]);
      const single = {}, multi = {};
      Object.keys(map).forEach(ph => {
        const a = [...map[ph]];
        if (a.length === 1) single[ph] = a[0]; else multi[ph] = a.sort();
      });

      builtIni = ['; נוצר מהמערכת — אל תערוך ידנית.',
                  '; מיפוי טלפון הורה -> שלוחת השיעור. מי שלא כאן שומע את התפריט הראשי.']
        .concat(Object.keys(single).sort().map(ph => ph + '=' + single[ph])).join('\n') + '\n';

      const per = {}; Object.values(single).forEach(e => { per[e] = (per[e] || 0) + 1; });
      box.innerHTML =
        '<div class="ym-stats">' + TARGETS.slice(0, 4).map(t =>
          '<div class="ym-stat"><i class="bi bi-people"></i><div><span class="ym-k">' + esc(t.label) +
          '</span><b>' + (per[t.key] || 0) + '</b></div></div>').join('') +
        '<div class="ym-stat"><i class="bi bi-telephone"></i><div><span class="ym-k">סה"כ מספרים</span><b>' +
          Object.keys(single).length + '</b></div></div></div>' +
        (excluded.length ? '<p class="login-hint"><i class="bi bi-shield-check"></i> הוחרגו ' + excluded.length +
          ' מספרי צוות — הם ימשיכו לשמוע את התפריט הראשי ולהגיע לשלוחה 9.</p>' : '') +
        (Object.keys(multi).length ? '<p class="login-hint"><i class="bi bi-exclamation-triangle"></i> ' +
          Object.keys(multi).length + ' מספרים עם אחים בשני שיעורים — לא מנותבים, יקבלו את התפריט הראשי ויבחרו:<br>' +
          Object.keys(multi).map(ph => esc(ph) + ' (' + esc([...(who[ph] || [])].join(', ')) + ')').join('<br>') + '</p>' : '');
      pane('route').querySelector('#ylRtPush').disabled = false;
    } catch (e) { note(box, 'שגיאה בבנייה: ' + (e.message || e)); }
  }

  async function pushRouting() {
    const box = pane('route').querySelector('#ylRtOut');
    if (!builtIni) return;
    const btn = pane('route').querySelector('#ylRtPush'); btn.disabled = true;
    try {
      const r = await Y().putText(ROUTING, builtIni);
      window.UI.toast(r.responseStatus === 'OK' ? 'הזיהוי עודכן בקו' : (r.message || 'ההעלאה נכשלה'),
                      r.responseStatus === 'OK' ? 'ok' : 'err');
    } catch (e) { window.UI.toast('שגיאת רשת בהעלאה', 'err'); }
    finally { btn.disabled = false; }
  }

  async function showRouting() {
    const box = pane('route').querySelector('#ylRtOut');
    note(box, 'קורא מהקו…');
    try {
      const r = (await Y().getText(ROUTING)) || '';
      const lines = r.split(/\r?\n/).filter(l => /^0\d/.test(l));
      box.innerHTML = '<p class="count-line">' + lines.length + ' מספרים מנותבים בקו כרגע.</p>' +
        '<pre dir="ltr" style="max-height:240px;overflow:auto;background:var(--bg2);padding:10px;border-radius:8px">' +
        esc(lines.join('\n')) + '</pre>';
    } catch (e) { note(box, 'לא ניתן לקרוא את קובץ הזיהוי מהקו.'); }
  }

  // ---------- 4. טקסטים של התפריטים ----------
  async function renderVoice() {
    const p = pane('voice');
    p.innerHTML = '<p class="login-hint" style="margin-top:0">מה שהמתקשר שומע בכל תפריט. ' +
      'ימות מקריאה את הטקסט בקול — אין צורך להקליט.</p>' +
      '<div id="ylVoices"><div class="empty-state" style="padding:14px">טוען…</div></div>';
    const box = p.querySelector('#ylVoices');
    const parts = [];
    for (const v of VOICES) {
      let map = new Map();
      try { map = Y().parseIni((await Y().getText(v.path + '/ext.ini')) || ''); } catch (_) {}
      parts.push('<div style="margin-bottom:14px" data-vp="' + esc(v.path) + '">' +
        '<label class="lbl">' + esc(v.label) + ' <span class="count-line" dir="ltr">' + esc(v.path.replace('ivr2:', '')) + '</span></label>' +
        '<textarea class="inp" rows="3" data-vtext>' + esc(map.get('menu_voice') || '') + '</textarea>' +
        (v.pass ? '<label class="lbl" style="margin-top:6px">סיסמת כניסה</label>' +
                  '<input class="inp mb0" data-vpass value="' + esc(map.get('password') || '') + '" style="width:140px" inputmode="numeric">' : '') +
        '</div>');
    }
    box.innerHTML = parts.join('') +
      '<button class="btn-primary sm" id="ylVoiceSave"><i class="bi bi-save"></i> שמור את כל הטקסטים</button>' +
      '<span id="ylVoiceOut" class="count-line" style="margin-inline-start:10px"></span>';
    box.querySelector('#ylVoiceSave').addEventListener('click', () => saveVoices(box));
  }

  async function saveVoices(box) {
    const out = box.querySelector('#ylVoiceOut'), btn = box.querySelector('#ylVoiceSave');
    btn.disabled = true; out.textContent = 'שומר…';
    let ok = 0, err = 0;
    for (const el of box.querySelectorAll('[data-vp]')) {
      const path = el.dataset.vp;
      const txt = el.querySelector('[data-vtext]').value.trim();
      const pw = el.querySelector('[data-vpass]');
      try {
        // קוראים את ה-ext.ini הקיים ומשנים רק את השדות האלה — כדי לא לאבד הגדרות אחרות
        const map = Y().parseIni((await Y().getText(path + '/ext.ini')) || '');
        if (txt) { map.set('say_menu_voice', 'yes'); map.set('menu_voice', txt); }
        else { map.delete('say_menu_voice'); map.delete('menu_voice'); }
        if (pw) { const v = pw.value.trim(); v ? map.set('password', v) : map.delete('password'); }
        const r = await Y().putText(path + '/ext.ini', Y().serializeIni(map));
        r.responseStatus === 'OK' ? ok++ : err++;
      } catch (_) { err++; }
    }
    out.textContent = err ? ('נשמרו ' + ok + ', נכשלו ' + err) : ('נשמרו ' + ok + ' תפריטים.');
    btn.disabled = false;
  }

  window.YemotLine = { mount };
})();
