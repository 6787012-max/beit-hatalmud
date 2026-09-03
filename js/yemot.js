// yemot.js — פאנל ניהול קו ימות המשיח של המוסד (מנהל בלבד).
// מערכת ניהול קו מלאה: דפדפן שלוחות, עורך הגדרות מתקדם לכל שלוחה (ext.ini),
// יצירת/מחיקת שלוחות, השמעה מנורמלת, הקלטה ישירה, טקסט→שמע (Gemini), העלאה,
// וצינתוק (כבוי כברירת מחדל). כמו הפאנל של ימות — רק נוח, יעיל ומותאם.
//
// CORS: ימות מאפשר fetch דפדפן ישיר. token ב-sessionStorage בלבד (לא הסיסמה).
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const API = 'https://www.call2all.co.il/ym/api';
  // טקסט→שמע: דרך window.cv3call (ai-proxy.js). המפתח שמור כסוד בשרת (Supabase
  // secret GEMINI_KEY) ואינו נמצא עוד בקוד הלקוח / ב-repo הציבורי.
  const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
  const GKEY_LS = 'cv3_gemini_key';
  // מפתח אופציונלי שמנהל יכול להזין ידנית (localStorage) לעקיפת השרת — לרוב אין.
  // נחשב רק אם הוא בפורמט תקין (AIza…); אחרת מתעלמים ומשתמשים בשרת.
  const gKey = () => { try { const k = localStorage.getItem(GKEY_LS) || ''; return /^AIza[\w-]{20,}$/.test(k) ? k : ''; } catch (_) { return ''; } };
  const setGKey = k => { try { k ? localStorage.setItem(GKEY_LS, k) : localStorage.removeItem(GKEY_LS); } catch (_) {} };
  const SS_KEY = 'cv3_yemot_token';
  const DEFAULT_LINE = '0733518751';   // קו המכינה "תשע תלמוד". 033060570 הוא קו החיידר — לא כאן.

  // PCM16 (base64) → WAV Blob
  function pcmB64ToWav(b64, rate) {
    const bin = atob(b64), dataLen = bin.length;
    const buf = new ArrayBuffer(44 + dataLen), dv = new DataView(buf);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); wr(8, 'WAVE'); wr(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, dataLen, true);
    for (let i = 0; i < dataLen; i++) dv.setUint8(44 + i, bin.charCodeAt(i));
    return new Blob([buf], { type: 'audio/wav' });
  }
  async function geminiSpeak(text) {
    const body = {
      contents: [{ parts: [{ text: 'קרא בקול רגוע, ברור ומקצועי המתאים להודעה טלפונית: ' + text }] }],
      generationConfig: { responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } } }
    };
    const r = await window.cv3call(TTS_MODEL, body);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error((j && j.error && j.error.message) || 'שגיאת Gemini');
    const inline = j.candidates && j.candidates[0] && j.candidates[0].content
      && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].inlineData;
    if (!inline || !inline.data) throw new Error('לא התקבל אודיו');
    let rate = 24000; const m = (inline.mimeType || '').match(/rate=(\d+)/); if (m) rate = parseInt(m[1], 10);
    return pcmB64ToWav(inline.data, rate);
  }

  const token = () => { try { return sessionStorage.getItem(SS_KEY) || ''; } catch (_) { return ''; } };
  const setToken = t => { try { t ? sessionStorage.setItem(SS_KEY, t) : sessionStorage.removeItem(SS_KEY); } catch (_) {} };

  async function call(method, params) {
    const qs = new URLSearchParams(Object.assign({ token: token() }, params || {}));
    const res = await fetch(`${API}/${method}?${qs}`, { method: 'GET' });
    let data; try { data = await res.json(); } catch (_) { data = { responseStatus: 'EXCEPTION', message: 'תשובה לא תקינה' }; }
    if (data && /token/i.test(data.message || '') && data.responseStatus !== 'OK') setToken('');
    return data;
  }

  async function login(line, pass) {
    const res = await fetch(`${API}/Login?${new URLSearchParams({ username: line, password: pass })}`);
    const data = await res.json();
    if (data.responseStatus === 'OK' && data.token) { setToken(data.token); return { ok: true }; }
    return { ok: false, msg: data.message || 'שם משתמש או סיסמה שגויים' };
  }

  // ----- קריאה/כתיבה של קובצי טקסט (ext.ini) דרך multipart POST -----
  async function getText(path) {
    const d = await call('GetTextFile', { what: path });
    return d.responseStatus === 'OK' ? (d.contents || '') : null;
  }
  async function putText(path, contents) {
    const fd = new FormData();
    fd.append('token', token()); fd.append('what', path); fd.append('contents', contents);
    const res = await fetch(`${API}/UploadTextFile`, { method: 'POST', body: fd });
    return res.json();
  }
  // העלאת קובץ/blob לשלוחה (יוצר גם את התיקייה אם אינה קיימת).
  // ext = מספר שלוחה ("1") או נתיב מלא ("ivr2:/1/1").
  // ברירת המחדל היא autoNumbering — בלעדיו כל העלאה דורסת את 000.wav,
  // ושלוחת playfile נשארת לנצח עם הודעה אחת. overwrite:true לדריסה מכוונת.
  async function uploadBlob(ext, blob, filename, opts) {
    const folder = /^ivr2:/.test(ext) ? String(ext).replace(/\/$/, '') : 'ivr2:/' + ext;
    const fd = new FormData();
    fd.append('token', token());
    fd.append('path', folder + '/000.wav');
    fd.append('convertAudio', '1');
    if (!(opts && opts.overwrite)) fd.append('autoNumbering', 'true');
    fd.append('file', blob, filename || 'message.wav');
    const res = await fetch(`${API}/UploadFile`, { method: 'POST', body: fd });
    return res.json();
  }
  // wav שקט קצר — ליצירת תיקיית שלוחה חדשה
  function silentWav() {
    const sr = 8000, n = Math.floor(sr / 10), len = n * 2;
    const buf = new ArrayBuffer(44 + len), dv = new DataView(buf);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, 36 + len, true); wr(8, 'WAVE'); wr(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, len, true);
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ----- מטא-דאטה של סוגי שלוחות + שדות ידידותיים -----
  const TYPE_META = {
    playfile:     { icon: 'bi-play-circle',       label: 'השמעת קובץ',   fields: [] },
    menu:         { icon: 'bi-list',              label: 'תפריט',        fields: [
      { k: 'menu_voice', lbl: 'טקסט התפריט (נקרא בקול)', ph: 'לשמיעת ההודעות הקישו 1…' },
      { k: 'password', lbl: 'סיסמת כניסה לשלוחה', ph: '1234' } ] },
    go_to_folder: { icon: 'bi-signpost-split',    label: 'ניתוב',        fields: [
      { k: 'go_to_folder', lbl: 'יעד הניתוב (נתיב)', ph: '/1/messages' } ] },
    record:       { icon: 'bi-mic',               label: 'הקלטה',        fields: [
      { k: 'option_record', lbl: 'שתיקה-מינימום-מקסימום (שניות)', ph: '3-3-180' },
      { k: 'record_ok', lbl: 'מקש לסיום ההקלטה', ph: '#' },
      { k: 'folder_move', lbl: 'העבר את ההקלטה לתיקייה', ph: '/1/1' },
      { k: 'record_end_goto', lbl: 'בסיום ההקלטה עבור אל', ph: '/8' },
      { k: 'email_address', lbl: 'שליחת ההקלטה למייל', ph: 'a@b.com' } ] },
    tzintuk:      { icon: 'bi-bell',              label: 'צינתוק',       fields: [
      { k: 'list_tzintuk', lbl: 'שם רשימת התפוצה', ph: '1' } ] },
    last_play:    { icon: 'bi-star',              label: 'הודעה אחרונה', fields: [] },
    conference:   { icon: 'bi-people',            label: 'ועידה',        fields: [] },
    routing:      { icon: 'bi-telephone-forward', label: 'העברת שיחה',   fields: [
      { k: 'routing_to_phone', lbl: 'מספר/י יעד להעברה', ph: '0501234567' } ] },
    api:          { icon: 'bi-hdd-network',       label: 'קריאת API',    fields: [
      { k: 'api_link', lbl: 'כתובת ה-API', ph: 'https://…' } ] },
  };
  const TYPE_ORDER = ['playfile', 'menu', 'go_to_folder', 'record', 'routing', 'tzintuk', 'conference', 'last_play', 'api'];
  const typeInfo = t => TYPE_META[t] || { icon: 'bi-folder2', label: t || 'שלוחה' };

  // פרסום/סריאליזציה של ext.ini לשמירת שדות לא-ידועים
  function parseIni(txt) {
    const map = new Map();
    (txt || '').split(/\r?\n/).forEach(line => {
      const i = line.indexOf('=');
      if (i > 0) map.set(line.slice(0, i).trim(), line.slice(i + 1));
    });
    return map;
  }
  function serializeIni(map) {
    const out = [];
    map.forEach((v, k) => out.push(k + '=' + v));
    return out.join('\n') + '\n';
  }

  const state = { path: 'ivr2:/', rec: null, chunks: [], recBlob: null, ttsBlob: null };

  async function render(page) { return token() ? renderPanel(page) : renderLogin(page); }

  function renderLogin(page) {
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>קו ימות המשיח</h2></div>' +
      '<div class="qr-card" style="max-width:460px;margin:0 auto">' +
        '<h3><i class="bi bi-telephone-inbound"></i> התחברות לקו המוסד</h3>' +
        '<p class="login-hint" style="margin:6px 0 14px">ההתחברות מול שרת ימות. הסיסמה אינה נשמרת — רק אסימון זמני לסשן.</p>' +
        '<label class="lbl">מספר הקו</label><input class="inp" id="ymLine" value="' + DEFAULT_LINE + '" inputmode="numeric">' +
        '<label class="lbl">סיסמת הקו</label><input class="inp" id="ymPass" type="password" autocomplete="off" placeholder="סיסמת ניהול הקו">' +
        '<button class="btn-primary" id="ymLoginBtn" style="margin-top:6px"><i class="bi bi-box-arrow-in-left"></i> התחברות</button>' +
        '<div id="ymMsg" class="login-msg"></div></div>';
    const btn = page.querySelector('#ymLoginBtn');
    const go = async () => {
      const line = page.querySelector('#ymLine').value.trim(), pass = page.querySelector('#ymPass').value, msg = page.querySelector('#ymMsg');
      if (!line || !pass) { msg.textContent = 'נא להזין מספר קו וסיסמה.'; return; }
      msg.textContent = 'מתחבר…'; btn.disabled = true;
      try { const r = await login(line, pass); if (r.ok) { state.path = 'ivr2:/'; render(page); } else { msg.textContent = r.msg; btn.disabled = false; } }
      catch (e) { msg.textContent = 'שגיאת רשת — בדוק חיבור.'; btn.disabled = false; }
    };
    btn.addEventListener('click', go);
    page.querySelector('#ymPass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function renderPanel(page) {
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>קו ימות המשיח</h2>' +
        '<div class="head-actions"><span class="chip ok" style="margin-inline-end:8px"><i class="bi bi-check-circle"></i> מחובר</span>' +
        '<button class="btn-ghost sm" id="ymLogout"><i class="bi bi-box-arrow-right"></i> ניתוק</button></div></div>' +

      '<div class="qr-card"><h3><i class="bi bi-telephone-fill"></i> מצב הקו</h3><div id="ymState" class="ym-stats">טוען…</div></div>' +

      '<div id="ymLineCard"></div>' +

      // טקסט → שמע (Gemini) + הקלטה ישירה — הודעה חדשה לשלוחה
      '<div class="qr-card"><h3><i class="bi bi-megaphone"></i> הודעה חדשה לשלוחה</h3>' +
        '<div class="ym-tabs"><button class="ym-tab on" data-tab="text"><i class="bi bi-body-text"></i> טקסט לשמע</button>' +
          '<button class="ym-tab" data-tab="rec"><i class="bi bi-mic"></i> הקלטה ישירה</button>' +
          '<button class="ym-tab" data-tab="file"><i class="bi bi-file-earmark-music"></i> קובץ מוכן</button></div>' +

        '<div class="ym-pane" data-pane="text">' +
          '<textarea class="inp" id="ymText" rows="3" placeholder="כתבו את ההודעה שתוקרא בקול… (למשל: שלום, הגעתם למכינה בית התלמוד)"></textarea>' +
          '<div id="ymKeyRow" hidden style="margin-top:8px">' +
            '<label class="lbl" style="margin-bottom:4px">מפתח Gemini (נשמר במכשיר זה בלבד, פעם אחת)</label>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
              '<input class="inp mb0" id="ymGKey" type="text" dir="ltr" autocomplete="off" spellcheck="false" placeholder="AIza…" style="flex:1;min-width:180px;direction:ltr;text-align:left">' +
              '<button class="btn-ghost sm" id="ymGKeySave"><i class="bi bi-key"></i> שמור מפתח</button></div>' +
            '<p class="login-hint" style="margin-top:4px">המפתח נשמר מקומית בדפדפן שלך בלבד ואינו נשלח לאף שרת חוץ מ-Google.</p></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">' +
            '<button class="btn-ghost sm" id="ymTtsGen"><i class="bi bi-soundwave"></i> צור קול</button>' +
            '<audio id="ymTtsPrev" controls style="display:none;height:36px"></audio>' +
            '<button class="btn-ghost sm" id="ymKeyChange" style="opacity:.7"><i class="bi bi-key"></i> החלף מפתח</button>' +
            '<span id="ymTtsMsg" class="count-line"></span></div></div>' +

        '<div class="ym-pane" data-pane="rec" hidden>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
            '<button class="btn-primary sm" id="ymRecStart"><i class="bi bi-record-circle"></i> התחל הקלטה</button>' +
            '<button class="btn-ghost sm" id="ymRecStop" disabled><i class="bi bi-stop-circle"></i> עצור</button>' +
            '<span id="ymRecTime" class="count-line"></span></div>' +
          '<audio id="ymRecPrev" controls style="display:none;width:100%;margin-top:8px"></audio></div>' +

        '<div class="ym-pane" data-pane="file" hidden>' +
          '<input class="inp mb0" id="ymFile" type="file" accept="audio/*"></div>' +

        '<hr style="border:none;border-top:1px solid var(--line);margin:14px 0">' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
          '<label style="display:flex;align-items:center;gap:6px">שלוחת יעד <input class="inp mb0" id="ymExt" value="1" style="width:70px" inputmode="numeric"></label>' +
          '<button class="btn-primary sm" id="ymSend"><i class="bi bi-upload"></i> העלה לשלוחה</button>' +
          '<label class="ym-check"><input type="checkbox" id="ymTz"> הפעל צינתוק לנרשמים אחרי ההעלאה</label></div>' +
        '<div id="ymSendMsg" class="count-line" style="margin-top:8px;min-height:1.2em"></div>' +
        '<p class="login-hint" style="margin-top:6px"><i class="bi bi-exclamation-triangle"></i> צינתוק שולח שיחה לכל הנרשמים — השאירו כבוי אם לא בטוחים.</p></div>' +

      // דפדפן שלוחות + ניהול
      '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-diagram-3"></i> ניהול שלוחות הקו</h3>' +
        '<div style="display:flex;gap:6px"><button class="btn-primary sm" id="ymNewExt"><i class="bi bi-plus-lg"></i> שלוחה חדשה</button>' +
        '<button class="btn-ghost sm" id="ymRefresh"><i class="bi bi-arrow-clockwise"></i> רענון</button></div></div>' +
        '<div id="ymCrumb" class="ym-crumb"></div>' +
        '<div id="ymDir" class="ym-dir"><div class="empty-state" style="padding:14px">טוען…</div></div></div>' +

      // עורך הגדרות שלוחה (מוסתר עד לחיצה)
      '<div class="qr-card" id="ymEditCard" hidden></div>';

    page.querySelector('#ymLogout').addEventListener('click', () => { setToken(''); render(page); });
    page.querySelector('#ymRefresh').addEventListener('click', () => loadDir(page, state.path));
    page.querySelector('#ymNewExt').addEventListener('click', () => openCreate(page));
    wireTabs(page); wireTts(page); wireRec(page); wireSend(page);
    loadState(page); loadDir(page, state.path);
    if (window.YemotLine) window.YemotLine.mount(page.querySelector('#ymLineCard'));
  }

  function wireTabs(page) {
    page.querySelectorAll('.ym-tab').forEach(t => t.addEventListener('click', () => {
      page.querySelectorAll('.ym-tab').forEach(x => x.classList.toggle('on', x === t));
      page.querySelectorAll('.ym-pane').forEach(p => { p.hidden = p.dataset.pane !== t.dataset.tab; });
    }));
  }

  // ----- טקסט → שמע (Gemini ישירות מהדפדפן) -----
  function wireTts(page) {
    const keyRow = page.querySelector('#ymKeyRow');
    keyRow.hidden = true;  // המפתח בשרת — אין צורך להזין. הכפתור למטה לעקיפה ידנית בלבד.
    page.querySelector('#ymKeyChange').addEventListener('click', () => {
      keyRow.hidden = false;
      const inp = page.querySelector('#ymGKey'); inp.value = ''; inp.focus();
    });
    // ניקוי מפתח שגוי שנשמר בטעות בעבר (למשל קוד OAuth) — כדי לא לדרוס את המוטמע
    try { const st = localStorage.getItem(GKEY_LS); if (st && !/^AIza[\w-]{20,}$/.test(st)) setGKey(''); } catch (_) {}
    page.querySelector('#ymGKeySave').addEventListener('click', () => {
      // ניקוי רעשי-הדבקה: רווחים, מרכאות, תווים נסתרים
      const k = page.querySelector('#ymGKey').value.replace(/[\s"'`​-‏]/g, '');
      const msg = page.querySelector('#ymTtsMsg');
      if (!/^AIza[\w-]{20,}$/.test(k)) { msg.textContent = 'זה לא מפתח Gemini. מפתח תקין מתחיל ב-AIza. (קוד AQ… הוא לא מפתח.)'; return; }
      setGKey(k); keyRow.hidden = true;
      msg.textContent = '✓ המפתח נשמר. לחצו "צור קול" כדי לבדוק.';
    });
    page.querySelector('#ymTtsGen').addEventListener('click', async () => {
      const text = page.querySelector('#ymText').value.trim();
      const msg = page.querySelector('#ymTtsMsg'), prev = page.querySelector('#ymTtsPrev');
      if (!text) { msg.textContent = 'כתבו טקסט קודם.'; return; }
      msg.textContent = 'יוצר קול…';
      try {
        state.ttsBlob = await geminiSpeak(text);
        prev.src = URL.createObjectURL(state.ttsBlob); prev.style.display = '';
        msg.textContent = '✓ הקול מוכן — האזינו והעלו לשלוחה.';
      } catch (e) {
        const em = String(e && e.message || e);
        if (/API key|invalid|expired/i.test(em)) { keyRow.hidden = false; msg.textContent = 'מפתח ה-AI נדחה — פנו למנהל המערכת.'; }
        else msg.textContent = 'יצירת הקול נכשלה: ' + em;
      }
    });
  }

  // ----- הקלטה ישירה מהמיקרופון -----
  function wireRec(page) {
    const startB = page.querySelector('#ymRecStart'), stopB = page.querySelector('#ymRecStop');
    const timeEl = page.querySelector('#ymRecTime'), prev = page.querySelector('#ymRecPrev');
    let timer, t0;
    startB.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.chunks = [];
        const rec = new MediaRecorder(stream);
        rec.ondataavailable = e => { if (e.data.size) state.chunks.push(e.data); };
        rec.onstop = () => {
          state.recBlob = new Blob(state.chunks, { type: rec.mimeType || 'audio/webm' });
          prev.src = URL.createObjectURL(state.recBlob); prev.style.display = '';
          stream.getTracks().forEach(t => t.stop());
        };
        rec.start(); state.rec = rec; t0 = Date.now();
        timer = setInterval(() => { timeEl.textContent = '● מקליט… ' + Math.floor((Date.now() - t0) / 1000) + 'ש'; }, 300);
        startB.disabled = true; stopB.disabled = false;
      } catch (e) { timeEl.textContent = 'אין גישה למיקרופון.'; }
    });
    stopB.addEventListener('click', () => {
      if (state.rec && state.rec.state !== 'inactive') state.rec.stop();
      clearInterval(timer); timeEl.textContent = '✓ ההקלטה מוכנה'; startB.disabled = false; stopB.disabled = true;
    });
  }

  // ----- העלאה לשלוחה + צינתוק אופציונלי -----
  function wireSend(page) {
    page.querySelector('#ymSend').addEventListener('click', async () => {
      const ext = page.querySelector('#ymExt').value.trim();
      const msg = page.querySelector('#ymSendMsg');
      const activeTab = page.querySelector('.ym-tab.on').dataset.tab;
      if (!ext) { msg.textContent = 'הזינו שלוחת יעד.'; return; }
      let blob, name;
      if (activeTab === 'text') { blob = state.ttsBlob; name = 'tts.wav'; if (!blob) { msg.textContent = 'צרו קול קודם (כפתור "צור קול").'; return; } }
      else if (activeTab === 'rec') { blob = state.recBlob; name = 'rec.webm'; if (!blob) { msg.textContent = 'הקליטו קודם.'; return; } }
      else { const f = page.querySelector('#ymFile').files[0]; if (!f) { msg.textContent = 'בחרו קובץ.'; return; } blob = f; name = f.name; }

      msg.textContent = 'מעלה לשלוחה ' + esc(ext) + '…';
      try {
        const up = await uploadBlob(ext, blob, name);
        if (up.responseStatus !== 'OK') { msg.textContent = 'ההעלאה נכשלה: ' + esc(up.message || ''); return; }
        msg.textContent = '✓ ההודעה הועלתה לשלוחה ' + esc(ext);
        loadDir(page, state.path);
        if (page.querySelector('#ymTz').checked) {
          const ok = await window.UI.confirm('לשלוח צינתוק לכל הנרשמים בקו? פעולה זו מחייגת אליהם בפועל.');
          if (ok) {
            msg.textContent = 'שולח צינתוק…';
            const tz = await call('RunTzintuk', { path: 'ivr2:/' + ext });
            msg.textContent = tz.responseStatus === 'OK' ? '✓ ההודעה הועלתה והצינתוק נשלח.' :
              '✓ ההודעה הועלתה. הצינתוק לא נשלח: ' + esc(tz.message || '');
          } else { msg.textContent = '✓ ההודעה הועלתה (צינתוק בוטל).'; }
        }
      } catch (e) { msg.textContent = 'שגיאת רשת בהעלאה.'; }
    });
  }

  async function loadState(page) {
    const box = page.querySelector('#ymState');
    try {
      const s = await call('GetSession');
      if (s.responseStatus === 'OK') {
        const items = [
          ['bi-telephone', 'מספר הקו', s.username || s.ownerId || '—'],
          (s.creditRemains != null ? ['bi-coin', 'יתרת יחידות', s.creditRemains] : null),
          ['bi-shield-check', 'אבטחה', 'אסימון לסשן זה בלבד'],
        ].filter(Boolean);
        box.innerHTML = items.map(([ic, k, v]) => '<div class="ym-stat"><i class="bi ' + ic + '"></i><div><span class="ym-k">' + esc(k) + '</span><b>' + esc(v) + '</b></div></div>').join('');
      } else if (!token()) render(page);
      else box.innerHTML = '<div class="empty-state" style="padding:12px">' + esc(s.message || 'לא ניתן לטעון מצב') + '</div>';
    } catch (e) { box.innerHTML = '<div class="empty-state" style="padding:12px">שגיאה בטעינת מצב הקו.</div>'; }
  }

  async function loadDir(page, path) {
    state.path = path;
    const editCard = page.querySelector('#ymEditCard'); if (editCard) editCard.hidden = true;
    const box = page.querySelector('#ymDir'), crumb = page.querySelector('#ymCrumb');
    box.innerHTML = '<div class="empty-state" style="padding:14px">טוען…</div>';
    const rel = path.replace(/^ivr2:\/?/, '').replace(/\/$/, '');
    const parts = rel.split('/').filter(Boolean);
    let acc = 'ivr2:/', cr = '<a class="ym-bc" data-p="ivr2:/"><i class="bi bi-house"></i> ראשי</a>';
    parts.forEach(seg => { acc += seg + '/'; cr += ' <span class="ym-sep">›</span> <a class="ym-bc" data-p="' + esc(acc) + '">' + esc(seg) + '</a>'; });
    crumb.innerHTML = cr;
    crumb.querySelectorAll('.ym-bc').forEach(a => a.addEventListener('click', () => loadDir(page, a.dataset.p)));
    try {
      const d = await call('GetIVR2Dir', { path });
      if (d.responseStatus !== 'OK') { box.innerHTML = '<div class="empty-state" style="padding:14px">' + esc(d.message || 'לא ניתן לטעון') + '</div>'; return; }
      const SYS = ['Log', 'Messages', 'EnterIDRecord', 'Star', 'Trash', 'ConfBridge'];
      const dirs = (d.dirs || []).filter(x => x.name && !SYS.includes(x.name));
      const wavs = (d.files || []).filter(f => (f.name || '').endsWith('.wav'));
      let html = '';
      if (!dirs.length && !wavs.length) html = '<div class="empty-state" style="padding:14px">אין תוכן בשלוחה זו.</div>';
      dirs.forEach(dir => {
        const isExt = dir.fileType === 'EXT', ti = typeInfo(dir.extType);
        const title = dir.extTitle || (isExt ? ti.label : '');
        const navPath = 'ivr2:/' + (rel ? rel + '/' : '') + dir.name;
        html += '<div class="ym-row">' +
          '<span class="ym-ic" data-nav="' + esc(navPath) + '"><i class="bi ' + (isExt ? ti.icon : 'bi-folder2') + '"></i></span>' +
          '<div class="ym-main" data-nav="' + esc(navPath) + '"><b>שלוחה ' + esc(dir.name) + '</b>' + (title ? ' <span class="ym-note">' + esc(title) + '</span>' : '') + '</div>' +
          (isExt ? '<span class="ym-badge"><i class="bi ' + ti.icon + '"></i> ' + esc(ti.label) + '</span>' : '') +
          '<button class="mini" data-cfg="' + esc(dir.name) + '" title="הגדרות שלוחה"><i class="bi bi-gear"></i></button>' +
          '<button class="mini danger" data-del="' + esc(dir.name) + '" data-delpath="' + esc(navPath) + '" title="מחיקת שלוחה"><i class="bi bi-trash"></i></button>' +
          '<span class="ym-ic" data-nav="' + esc(navPath) + '"><i class="bi bi-chevron-left ym-arrow"></i></span></div>';
      });
      wavs.forEach(f => {
        html += '<div class="ym-row ym-file"><span class="ym-ic"><i class="bi bi-music-note-beamed"></i></span>' +
          '<div class="ym-main"><b>' + esc(f.name) + '</b></div>' +
          '<button class="mini" data-play="' + esc(f.name) + '" title="השמעה"><i class="bi bi-play-fill"></i></button></div>';
      });
      box.innerHTML = html;
      box.querySelectorAll('[data-nav]').forEach(r => r.addEventListener('click', () => loadDir(page, r.dataset.nav)));
      box.querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); playFile(page, path, b.dataset.play); }));
      box.querySelectorAll('[data-cfg]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openConfig(page, path, b.dataset.cfg); }));
      box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation();
        const ok = await window.UI.confirm('למחוק לצמיתות את שלוחה ' + b.dataset.del + ' וכל תוכנה? לא ניתן לשחזר.');
        if (!ok) return;
        const r = await call('FileAction', { action: 'delete', path: b.dataset.delpath });
        window.UI.toast(r.responseStatus === 'OK' ? 'שלוחה ' + b.dataset.del + ' נמחקה' : 'המחיקה נכשלה', r.responseStatus === 'OK' ? 'ok' : 'err');
        loadDir(page, state.path);
      }));
    } catch (e) { box.innerHTML = '<div class="empty-state" style="padding:14px">שגיאת רשת.</div>'; }
  }

  // ----- עורך הגדרות שלוחה (ext.ini) — ידידותי + מתקדם -----
  async function openConfig(page, path, extName) {
    const full = (path.endsWith('/') ? path : path + '/') + extName;
    const iniPath = full + '/ext.ini';
    const card = page.querySelector('#ymEditCard');
    card.hidden = false;
    card.innerHTML = '<div class="empty-state" style="padding:14px">טוען הגדרות שלוחה ' + esc(extName) + '…</div>';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const raw = (await getText(iniPath)) || '';
    const map = parseIni(raw);
    const curType = map.get('type') || 'playfile';
    const curTitle = map.get('title') || '';

    const typeOpts = TYPE_ORDER.map(t => '<option value="' + t + '"' + (t === curType ? ' selected' : '') + '>' + TYPE_META[t].label + '</option>').join('');
    card.innerHTML =
      '<div class="card-h-row"><h3><i class="bi bi-gear-fill"></i> הגדרות שלוחה ' + esc(extName) + '</h3>' +
        '<button class="btn-ghost sm" id="ymCfgClose"><i class="bi bi-x-lg"></i> סגור</button></div>' +
      '<label class="lbl">שם/כותרת השלוחה</label><input class="inp" id="cfgTitle" value="' + esc(curTitle) + '" placeholder="לדוגמה: הקלטה למנהל">' +
      '<label class="lbl">סוג השלוחה (מה היא עושה)</label><select class="inp" id="cfgType">' + typeOpts + '</select>' +
      '<div id="cfgFields"></div>' +
      '<div style="margin-top:10px"><button class="btn-ghost sm" id="cfgAdvToggle"><i class="bi bi-code-slash"></i> עריכה מתקדמת (ext.ini גולמי)</button></div>' +
      '<div id="cfgAdvWrap" hidden style="margin-top:8px">' +
        '<p class="login-hint" style="margin:0 0 6px"><i class="bi bi-info-circle"></i> עריכה ישירה של קובץ ההגדרות. במצב זה הטקסט כאן קובע בשמירה.</p>' +
        '<textarea class="inp" id="cfgRaw" rows="8" style="font-family:monospace;direction:ltr;text-align:left">' + esc(raw) + '</textarea></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;align-items:center">' +
        '<button class="btn-primary sm" id="cfgSave"><i class="bi bi-save"></i> שמור הגדרות</button>' +
        '<span id="cfgMsg" class="count-line"></span></div>';

    let advMode = false;
    const fieldsBox = card.querySelector('#cfgFields');
    const renderFields = () => {
      const t = card.querySelector('#cfgType').value;
      const meta = TYPE_META[t] || { fields: [] };
      fieldsBox.innerHTML = meta.fields.map(f => {
        const v = map.get(f.k) || '';
        if (f.type === 'bool') {
          const on = /^(yes|1|true)$/i.test(v);
          return '<label class="ym-check" style="margin-top:10px"><input type="checkbox" data-fk="' + f.k + '"' + (on ? ' checked' : '') + '> ' + esc(f.lbl) + '</label>';
        }
        return '<label class="lbl">' + esc(f.lbl) + '</label><input class="inp" data-fk="' + f.k + '" value="' + esc(v) + '"' +
          (f.type === 'num' ? ' inputmode="numeric"' : '') + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + '>';
      }).join('') || '<p class="login-hint" style="margin-top:8px">לסוג זה אין שדות מיוחדים. אפשר לערוך הכל ב"עריכה מתקדמת".</p>';
    };
    renderFields();
    card.querySelector('#cfgType').addEventListener('change', renderFields);
    card.querySelector('#ymCfgClose').addEventListener('click', () => { card.hidden = true; });
    card.querySelector('#cfgAdvToggle').addEventListener('click', () => {
      advMode = !advMode;
      card.querySelector('#cfgAdvWrap').hidden = !advMode;
      // סנכרון הטקסט הגולמי מהשדות בכניסה למצב מתקדם
      if (advMode) card.querySelector('#cfgRaw').value = buildIni();
    });

    function buildIni() {
      const m = new Map(map); // שמירת שדות לא-ידועים
      m.set('type', card.querySelector('#cfgType').value);
      const title = card.querySelector('#cfgTitle').value.trim();
      if (title) m.set('title', title); else m.delete('title');
      card.querySelectorAll('[data-fk]').forEach(el => {
        const k = el.dataset.fk;
        if (el.type === 'checkbox') { el.checked ? m.set(k, 'yes') : m.delete(k); }
        else { const val = el.value.trim(); val ? m.set(k, val) : m.delete(k); }
      });
      // סדר: type ו-title קודם
      const ordered = new Map();
      ['type', 'title'].forEach(k => { if (m.has(k)) { ordered.set(k, m.get(k)); m.delete(k); } });
      m.forEach((v, k) => ordered.set(k, v));
      return serializeIni(ordered);
    }

    card.querySelector('#cfgSave').addEventListener('click', async () => {
      const msg = card.querySelector('#cfgMsg');
      const contents = advMode ? card.querySelector('#cfgRaw').value : buildIni();
      if (!/type\s*=/.test(contents)) { msg.textContent = 'חובה להגדיר סוג לשלוחה.'; return; }
      msg.textContent = 'שומר…';
      try {
        const r = await putText(iniPath, contents);
        if (r.responseStatus === 'OK') {
          msg.textContent = '✓ ההגדרות נשמרו';
          window.UI.toast('הגדרות שלוחה ' + extName + ' נשמרו', 'ok');
          loadDir(page, state.path);
        } else { msg.textContent = 'השמירה נכשלה: ' + esc(r.message || ''); }
      } catch (e) { msg.textContent = 'שגיאת רשת בשמירה.'; }
    });
  }

  // ----- יצירת שלוחה חדשה -----
  async function openCreate(page) {
    const card = page.querySelector('#ymEditCard');
    card.hidden = false;
    const typeOpts = TYPE_ORDER.map(t => '<option value="' + t + '">' + TYPE_META[t].label + '</option>').join('');
    const base = state.path.replace(/^ivr2:\/?/, '').replace(/\/$/, '');
    card.innerHTML =
      '<div class="card-h-row"><h3><i class="bi bi-plus-circle-fill"></i> שלוחה חדשה' + (base ? ' תחת /' + esc(base) : '') + '</h3>' +
        '<button class="btn-ghost sm" id="ymCfgClose"><i class="bi bi-x-lg"></i> סגור</button></div>' +
      '<label class="lbl">מספר השלוחה</label><input class="inp" id="newNum" inputmode="numeric" placeholder="לדוגמה: 3">' +
      '<label class="lbl">שם/כותרת</label><input class="inp" id="newTitle" placeholder="לדוגמה: הודעות לציבור">' +
      '<label class="lbl">סוג השלוחה</label><select class="inp" id="newType">' + typeOpts + '</select>' +
      '<div style="display:flex;gap:8px;margin-top:12px;align-items:center">' +
        '<button class="btn-primary sm" id="newSave"><i class="bi bi-check-lg"></i> צור שלוחה</button>' +
        '<span id="newMsg" class="count-line"></span></div>';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card.querySelector('#ymCfgClose').addEventListener('click', () => { card.hidden = true; });
    card.querySelector('#newSave').addEventListener('click', async () => {
      const num = card.querySelector('#newNum').value.trim();
      const title = card.querySelector('#newTitle').value.trim();
      const type = card.querySelector('#newType').value;
      const msg = card.querySelector('#newMsg');
      if (!/^\d+$/.test(num)) { msg.textContent = 'הזינו מספר שלוחה תקין (ספרות בלבד).'; return; }
      const extPath = (base ? base + '/' : '') + num;
      msg.textContent = 'יוצר שלוחה…';
      try {
        // יצירת התיקייה ע"י העלאת קובץ קול שקט, ואז כתיבת ext.ini
        const up = await uploadBlob(extPath, silentWav(), '000.wav');
        if (up.responseStatus !== 'OK') { msg.textContent = 'יצירת השלוחה נכשלה: ' + esc(up.message || ''); return; }
        const ini = 'type=' + type + (title ? '\ntitle=' + title : '') + '\n';
        const w = await putText('ivr2:/' + extPath + '/ext.ini', ini);
        if (w.responseStatus !== 'OK') { msg.textContent = 'התיקייה נוצרה אך ההגדרות נכשלו: ' + esc(w.message || ''); return; }
        msg.textContent = '✓ שלוחה ' + esc(num) + ' נוצרה';
        window.UI.toast('שלוחה ' + num + ' נוצרה', 'ok');
        card.hidden = true;
        loadDir(page, state.path);
      } catch (e) { msg.textContent = 'שגיאת רשת ביצירת השלוחה.'; }
    });
  }

  // השמעה מנורמלת — מיישר את הווליום כדי שההתחלה השקטה של הקלטות ימות תישמע אחיד.
  let audioCtx = null;
  async function playFile(page, path, name) {
    const full = (path.endsWith('/') ? path : path + '/') + name;
    const url = `${API}/DownloadFile?token=${encodeURIComponent(token())}&path=${encodeURIComponent(full)}`;
    try {
      const old = document.getElementById('ymAudio'); if (old) { try { old.pause(); } catch (_) {} old.remove(); }
      const audio = document.createElement('audio');
      audio.id = 'ymAudio'; audio.controls = true; audio.crossOrigin = 'anonymous';
      audio.style.cssText = 'width:100%;margin-top:10px'; audio.src = url;
      page.querySelector('#ymDir').appendChild(audio);
      try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const src = audioCtx.createMediaElementSource(audio);
        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.value = -40; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
        const gain = audioCtx.createGain(); gain.value = 2.2;
        src.connect(comp); comp.connect(gain); gain.connect(audioCtx.destination);
      } catch (_) { /* אם Web Audio לא זמין — השמעה רגילה */ }
      audio.play().catch(() => {});
    } catch (e) { window.UI.toast('לא ניתן להשמיע', 'err'); }
  }

  // חשיפה למודולים אחרים (דיווחים קוליים): המפתח הפעיל + עזרי ימות
  window.geminiKey = gKey;
  window.geminiSpeak = geminiSpeak;   // לשימוש עמוד הבדיקה/מודולים
  window.Yemot = {
    API, token, call, getText, putText, uploadBlob, parseIni, serializeIni,
    downloadUrl: path => `${API}/DownloadFile?token=${encodeURIComponent(token())}&path=${encodeURIComponent(path)}`
  };

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.yemot = render;
})();
