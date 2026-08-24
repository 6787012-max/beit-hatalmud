// lobby.js — פאנל ניהול "מסך הלובי".
// כל מה שמוצג על המסך התלוי בלובי נשלט מכאן: סדר יום, תפריט המטבח, הודעות,
// והגדרות התצוגה והסרטונים. הנתונים יושבים בטבלה אחת (lobby_config, מפתח→JSON)
// שמסך הלובי קורא ממנה כאורח (anon) — ולכן אין לשמור כאן מידע אישי.
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const KINDS = [
    { v: 'lesson', t: 'שיעור' }, { v: 'break', t: 'הפסקה' },
    { v: 'meal', t: 'ארוחה' }, { v: 'tefila', t: 'תפילה' }, { v: 'other', t: 'אחר' },
  ];
  const DEF_DISPLAY = {
    headline: 'מכינה בית התלמוד', city: 'בית שמש', lat: 31.747, lon: 34.988, geonameid: 295432,
    showWeather: true, showParasha: true, showZmanim: true, showMenu: true,
    showMessages: true, showAgenda: true, videosEnabled: true, videosOnlyOnBreaks: true,
    crossfadeSec: 3, refreshSec: 60, lessonScreen: 'clock', videoRoot: '', videoFolders: [],
  };

  let cfg = { schedule: { default: [], byDay: {}, offDays: [5, 6] }, menu: { days: {} }, messages: { items: [] }, display: {}, runtime: {} };
  let tab = 'sched', schedDay = 'all', weekStart = null;

  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  function sunOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  const heb = (isoDate, o) => (window.UI && window.UI.hebDate ? window.UI.hebDate(isoDate, o) : isoDate);

  async function loadAll() {
    if (!window.sb) return;
    const { data, error } = await window.sb.from('lobby_config').select('key,value,updated_at');
    if (error) { window.UI.toast('טעינת הגדרות הלובי נכשלה: ' + error.message, 'err'); return; }
    (data || []).forEach(r => { cfg[r.key] = r.value || {}; cfg[r.key]._at = r.updated_at; });
    cfg.schedule = Object.assign({ default: [], byDay: {}, offDays: [5, 6] }, cfg.schedule || {});
    cfg.menu = Object.assign({ title: 'תפריט ארוחת צהריים', subtitle: '', days: {} }, cfg.menu || {});
    cfg.messages = Object.assign({ items: [] }, cfg.messages || {});
    cfg.display = Object.assign({}, DEF_DISPLAY, cfg.display || {});
  }

  async function save(key) {
    if (!window.sb) { window.UI.toast('מצב הדגמה — לא נשמר', 'err'); return false; }
    const value = JSON.parse(JSON.stringify(cfg[key] || {}));
    delete value._at;
    const { error } = await window.sb.from('lobby_config')
      .upsert({ key: key, value: value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { window.UI.toast('שמירה נכשלה: ' + error.message, 'err'); return false; }
    window.UI.toast('נשמר — המסך יתעדכן תוך פחות מדקה');
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  async function render(page) {
    page.innerHTML = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
      '<h2>מסך הלובי</h2><div class="head-actions">' +
      '<a class="btn-primary sm" href="http://localhost:8484/?fs=1" target="_blank" rel="noopener" title="נפתח במחשב שבלובי — עם הסרטונים"><i class="bi bi-tv"></i> פתח את מסך הלובי</a> ' +
      '<a class="btn-ghost sm" href="lobby/screen.html?fs=1" target="_blank" rel="noopener" title="תצוגה מכל מחשב — בלי סרטונים"><i class="bi bi-eye"></i> תצוגה מקדימה</a> ' +
      '<span class="ym-note" id="lbState">טוען…</span></div></div>' +
      '<div id="lbBody"></div>';
    await loadAll();
    draw(page);
  }

  function draw(page) {
    const st = page.querySelector('#lbState');
    const rt = cfg.runtime || {};
    if (st) {
      const seen = rt.seenAt ? new Date(rt.seenAt) : null;
      const mins = seen ? Math.round((Date.now() - seen.getTime()) / 60000) : null;
      const live = mins != null && mins < 3;
      st.innerHTML = seen
        ? '<span class="ym-badge" style="background:' + (live ? '#d7f5e4' : '#f5e0e0') + ';color:' + (live ? '#166b42' : '#8c2f2f') + '">' +
          (live ? '● המסך פעיל' : '○ המסך לא מדווח') + '</span> ' +
          (live ? (rt.videoCount || 0) + ' סרטונים' : 'נראה לאחרונה לפני ' + mins + ' דק׳')
        : '<span class="ym-note">המסך עוד לא דיווח על עצמו</span>';
    }
    page.querySelector('#lbBody').innerHTML =
      '<div class="ym-tabs">' +
        btn('sched', 'bi-clock-history', 'סדר יום') +
        btn('menu', 'bi-egg-fried', 'תפריט המטבח') +
        btn('msg', 'bi-megaphone', 'הודעות') +
        btn('disp', 'bi-display', 'תצוגה וסרטונים') +
      '</div><div class="ym-pane" id="lbPane"></div>';
    page.querySelectorAll('.ym-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; draw(page); }));
    const pane = page.querySelector('#lbPane');
    if (tab === 'sched') drawSched(pane, page);
    else if (tab === 'menu') drawMenu(pane, page);
    else if (tab === 'msg') drawMsg(pane, page);
    else drawDisp(pane, page);
  }
  const btn = (id, ic, label) => '<button class="ym-tab' + (tab === id ? ' on' : '') + '" data-tab="' + id + '"><i class="bi ' + ic + '"></i> ' + label + '</button>';

  // ── סדר יום ───────────────────────────────────────────────────────────
  function activeRows() {
    if (schedDay === 'all') return cfg.schedule.default;
    return cfg.schedule.byDay[schedDay] || null;   // null = היום הזה יורש מהברירת מחדל
  }

  function drawSched(pane, page) {
    const rows = activeRows();
    const custom = schedDay !== 'all' && rows;
    pane.innerHTML =
      '<div class="qr-card"><h3><i class="bi bi-clock-history"></i> סדר היום שמוצג במסך</h3>' +
      '<p class="ym-note" style="margin:0 0 10px">השורה שמתאימה לשעה הנוכחית מודגשת במסך. שורה מסוג <b>שיעור</b> מפעילה את מצב־השיעור (שעון גדול, בלי סרטונים).</p>' +
      '<div class="tla-bar" style="margin-bottom:12px">' +
        '<button class="ym-tab' + (schedDay === 'all' ? ' on' : '') + '" data-day="all">כל הימים</button>' +
        [0, 1, 2, 3, 4, 5].map(d => '<button class="ym-tab' + (String(schedDay) === String(d) ? ' on' : '') + '" data-day="' + d + '">' +
          DAYS[d] + (cfg.schedule.byDay[d] ? ' •' : '') + '</button>').join('') +
        '<label class="ym-check" style="margin-inline-start:auto"><input type="checkbox" id="lbOff"' +
          (schedDay !== 'all' && (cfg.schedule.offDays || []).map(String).indexOf(String(schedDay)) > -1 ? ' checked' : '') +
          (schedDay === 'all' ? ' disabled' : '') + '> אין לימודים ביום זה</label>' +
      '</div>' +
      (schedDay !== 'all' && !custom
        ? '<div class="table-wrap" style="padding:16px;text-align:center;color:var(--muted)">יום ' + DAYS[schedDay] + ' משתמש בסדר היום הכללי.' +
          '<div style="margin-top:10px"><button class="btn-primary sm" id="lbMakeDay"><i class="bi bi-pencil"></i> קבע סדר יום מיוחד ליום ' + DAYS[schedDay] + '</button></div></div>'
        : '<div class="table-wrap"><table class="tbl"><thead><tr><th style="width:110px">שעה</th><th>מה קורה</th><th style="width:130px">סוג</th><th style="width:44px"></th></tr></thead><tbody id="lbSchedBody"></tbody></table></div>' +
          '<div class="tla-bar" style="margin-top:10px"><button class="btn-ghost sm" id="lbAddRow"><i class="bi bi-plus-lg"></i> הוסף שורה</button>' +
          (custom ? '<button class="btn-ghost sm" id="lbDropDay"><i class="bi bi-trash"></i> בטל את המיוחד ליום ' + DAYS[schedDay] + '</button>' : '') +
          '<button class="btn-primary sm" id="lbSaveSched" style="margin-inline-start:auto"><i class="bi bi-check-lg"></i> שמירה</button></div>') +
      '</div>';

    pane.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
      schedDay = b.dataset.day === 'all' ? 'all' : Number(b.dataset.day); drawSched(pane, page);
    }));
    const offBox = pane.querySelector('#lbOff');
    if (offBox) offBox.addEventListener('change', async () => {
      const list = (cfg.schedule.offDays || []).map(Number).filter(d => d !== Number(schedDay));
      if (offBox.checked) list.push(Number(schedDay));
      cfg.schedule.offDays = list.sort();
      await save('schedule');
    });
    const mk = pane.querySelector('#lbMakeDay');
    if (mk) mk.addEventListener('click', () => {
      cfg.schedule.byDay[schedDay] = JSON.parse(JSON.stringify(cfg.schedule.default || []));
      drawSched(pane, page);
    });
    const dropDay = pane.querySelector('#lbDropDay');
    if (dropDay) dropDay.addEventListener('click', async () => {
      if (!await window.UI.confirm('לבטל את סדר היום המיוחד ליום ' + DAYS[schedDay] + '?')) return;
      delete cfg.schedule.byDay[schedDay];
      await save('schedule'); drawSched(pane, page);
    });
    if (!pane.querySelector('#lbSchedBody')) return;

    function paint() {
      const list = activeRows() || [];
      pane.querySelector('#lbSchedBody').innerHTML = list.map((r, i) =>
        '<tr><td><input class="inp mb0" type="time" value="' + esc(r.t || '') + '" data-f="t" data-i="' + i + '"></td>' +
        '<td><input class="inp mb0" value="' + esc(r.title || '') + '" data-f="title" data-i="' + i + '" placeholder="שם המשבצת"></td>' +
        '<td><select class="inp mb0" data-f="kind" data-i="' + i + '">' +
          KINDS.map(k => '<option value="' + k.v + '"' + ((r.kind || 'lesson') === k.v ? ' selected' : '') + '>' + k.t + '</option>').join('') +
        '</select></td>' +
        '<td class="row-act"><button class="mini danger" data-del="' + i + '"><i class="bi bi-trash"></i></button></td></tr>').join('') ||
        '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:14px">אין משבצות — הוסף שורה</td></tr>';
      pane.querySelectorAll('#lbSchedBody [data-f]').forEach(el => el.addEventListener('input', () => {
        const l = activeRows(); l[Number(el.dataset.i)][el.dataset.f] = el.value;
      }));
      pane.querySelectorAll('#lbSchedBody [data-del]').forEach(b => b.addEventListener('click', () => {
        activeRows().splice(Number(b.dataset.del), 1); paint();
      }));
    }
    paint();
    pane.querySelector('#lbAddRow').addEventListener('click', () => {
      const l = activeRows(); const last = l[l.length - 1];
      l.push({ t: last ? bump(last.t) : '08:15', title: '', kind: 'lesson' }); paint();
    });
    pane.querySelector('#lbSaveSched').addEventListener('click', async () => {
      const l = activeRows();
      l.sort((a, b) => String(a.t).localeCompare(String(b.t)));
      if (await save('schedule')) drawSched(pane, page);
    });
  }
  function bump(t) {
    const [h, m] = String(t || '08:00').split(':').map(Number);
    const n = (h * 60 + m + 45) % (24 * 60);
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  }

  // ── תפריט המטבח ───────────────────────────────────────────────────────
  function drawMenu(pane, page) {
    if (!weekStart) weekStart = sunOf(new Date());
    const days = [0, 1, 2, 3, 4].map(i => addDays(weekStart, i));
    const d0 = cfg.menu.days || (cfg.menu.days = {});
    pane.innerHTML =
      '<div class="qr-card"><h3><i class="bi bi-egg-fried"></i> ' + esc(cfg.menu.title || 'תפריט ארוחת צהריים') + '</h3>' +
      '<div class="tla-bar">' +
        '<button class="btn-ghost sm" id="lbWkPrev"><i class="bi bi-chevron-right"></i> שבוע קודם</button>' +
        '<button class="btn-ghost sm" id="lbWkToday">השבוע</button>' +
        '<button class="btn-ghost sm" id="lbWkNext">שבוע הבא <i class="bi bi-chevron-left"></i></button>' +
        '<span class="ym-badge">' + heb(iso(days[0]), { year: false }) + ' – ' + heb(iso(days[4])) + '</span>' +
        '<button class="btn-ghost sm" id="lbWkCopy" style="margin-inline-start:auto"><i class="bi bi-clipboard"></i> העתק מהשבוע הקודם</button>' +
        '<button class="btn-primary sm" id="lbSaveMenu"><i class="bi bi-check-lg"></i> שמירה</button>' +
      '</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th style="width:150px">יום</th><th>מנה עיקרית</th><th>תוספת</th><th>ירקות / סלט</th><th style="width:150px">הערה</th><th style="width:110px">אין לימודים</th></tr></thead><tbody>' +
      days.map((d, i) => {
        const k = iso(d), r = d0[k] || {};
        return '<tr data-k="' + k + '"><td><b>יום ' + DAYS[i] + '</b><div class="ym-note">' + heb(k, { year: false }) +
          ' · ' + (d.getDate() + '.' + (d.getMonth() + 1)) + '</div></td>' +
          ['main', 'side', 'veg', 'note'].map(f =>
            '<td><input class="inp mb0" data-k="' + k + '" data-f="' + f + '" value="' + esc(r[f] || '') + '"' + (r.off ? ' disabled' : '') + '></td>').join('') +
          '<td><label class="ym-check"><input type="checkbox" data-k="' + k + '" data-f="off"' + (r.off ? ' checked' : '') + '> אין</label></td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<p class="ym-note" style="margin-top:8px">יום מסומן כ״אין לימודים״ מוצג במסך כחג/חופש; אפשר לכתוב את הסיבה בעמודת ההערה.</p>' +
      '</div>';

    pane.querySelector('#lbWkPrev').addEventListener('click', () => { weekStart = addDays(weekStart, -7); drawMenu(pane, page); });
    pane.querySelector('#lbWkNext').addEventListener('click', () => { weekStart = addDays(weekStart, 7); drawMenu(pane, page); });
    pane.querySelector('#lbWkToday').addEventListener('click', () => { weekStart = sunOf(new Date()); drawMenu(pane, page); });
    pane.querySelectorAll('[data-f]').forEach(el => {
      const ev = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const k = el.dataset.k, f = el.dataset.f;
        const row = d0[k] || (d0[k] = { main: '', side: '', veg: '', note: '', off: false });
        row[f] = el.type === 'checkbox' ? el.checked : el.value;
        if (f === 'off') drawMenu(pane, page);
      });
    });
    pane.querySelector('#lbWkCopy').addEventListener('click', async () => {
      if (!await window.UI.confirm('להעתיק את חמשת ימי השבוע הקודם לשבוע המוצג? התוכן הקיים יידרס.')) return;
      days.forEach((d, i) => {
        const src = d0[iso(addDays(d, -7))];
        if (src) d0[iso(d)] = JSON.parse(JSON.stringify(src));
      });
      drawMenu(pane, page);
    });
    pane.querySelector('#lbSaveMenu').addEventListener('click', () => save('menu'));
  }

  // ── הודעות ────────────────────────────────────────────────────────────
  function drawMsg(pane, page) {
    const items = cfg.messages.items || (cfg.messages.items = []);
    pane.innerHTML =
      '<div class="qr-card"><h3><i class="bi bi-megaphone"></i> הודעות שרצות בתחתית המסך</h3>' +
      '<p class="ym-note" style="margin:0 0 10px">הודעה מחוץ לטווח התאריכים לא מוצגת. תאריכים ריקים = מוצג תמיד.</p>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>הודעה</th><th style="width:150px">מתאריך</th><th style="width:150px">עד תאריך</th><th style="width:130px">בולטות</th><th style="width:44px"></th></tr></thead><tbody id="lbMsgBody"></tbody></table></div>' +
      '<div class="tla-bar" style="margin-top:10px"><button class="btn-ghost sm" id="lbAddMsg"><i class="bi bi-plus-lg"></i> הודעה חדשה</button>' +
      '<button class="btn-primary sm" id="lbSaveMsg" style="margin-inline-start:auto"><i class="bi bi-check-lg"></i> שמירה</button></div></div>';

    function paint() {
      pane.querySelector('#lbMsgBody').innerHTML = items.map((m, i) =>
        '<tr><td><input class="inp mb0" data-i="' + i + '" data-f="text" value="' + esc(m.text || '') + '" placeholder="תוכן ההודעה"></td>' +
        '<td><input class="inp mb0" type="date" data-i="' + i + '" data-f="from" value="' + esc(m.from || '') + '"></td>' +
        '<td><input class="inp mb0" type="date" data-i="' + i + '" data-f="to" value="' + esc(m.to || '') + '"></td>' +
        '<td><select class="inp mb0" data-i="' + i + '" data-f="level">' +
          ['רגילה', 'חשובה'].map(l => '<option value="' + (l === 'חשובה' ? 'high' : '') + '"' + ((m.level === 'high') === (l === 'חשובה') ? ' selected' : '') + '>' + l + '</option>').join('') +
        '</select></td>' +
        '<td class="row-act"><button class="mini danger" data-del="' + i + '"><i class="bi bi-trash"></i></button></td></tr>').join('') ||
        '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:14px">אין הודעות</td></tr>';
      pane.querySelectorAll('#lbMsgBody [data-f]').forEach(el => el.addEventListener('input', () => {
        items[Number(el.dataset.i)][el.dataset.f] = el.value;
      }));
      pane.querySelectorAll('#lbMsgBody [data-del]').forEach(b => b.addEventListener('click', () => { items.splice(Number(b.dataset.del), 1); paint(); }));
    }
    paint();
    pane.querySelector('#lbAddMsg').addEventListener('click', () => { items.push({ text: '', from: '', to: '', level: '' }); paint(); });
    pane.querySelector('#lbSaveMsg').addEventListener('click', () => save('messages'));
  }

  // ── תצוגה וסרטונים ────────────────────────────────────────────────────
  function drawDisp(pane, page) {
    const d = cfg.display, rt = cfg.runtime || {};
    const chk = (f, label, note) => '<label class="ym-check" style="margin:0 8px 8px 0"><input type="checkbox" data-d="' + f + '"' + (d[f] ? ' checked' : '') + '> ' + label + '</label>' + (note ? '<span class="ym-note"> ' + note + '</span>' : '');
    const folders = rt.folders || [];
    const sel = d.videoFolders || [];
    pane.innerHTML =
      '<div class="qr-card"><h3><i class="bi bi-display"></i> מה מוצג במסך</h3>' +
      '<div class="qr-grid" style="grid-template-columns:1fr 1fr 1fr">' +
        '<label class="fld"><span>כותרת המסך</span><input class="inp mb0" data-d="headline" value="' + esc(d.headline || '') + '"></label>' +
        '<label class="fld"><span>עיר (למזג אוויר)</span><input class="inp mb0" data-d="city" value="' + esc(d.city || '') + '"></label>' +
        '<label class="fld"><span>מה מוצג בזמן שיעור</span><select class="inp mb0" data-d="lessonScreen">' +
          [['clock', 'שעון גדול + שם השיעור'], ['menu', 'תפריט הצהריים של היום'], ['agenda', 'סדר היום המלא']]
            .map(o => '<option value="' + o[0] + '"' + (d.lessonScreen === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
        '</select></label>' +
      '</div>' +
      '<div style="margin-top:10px">' +
        chk('showAgenda', 'סדר היום') + chk('showMenu', 'תפריט הצהריים') + chk('showMessages', 'הודעות רצות') +
        chk('showWeather', 'מזג אוויר') + chk('showParasha', 'פרשת השבוע') + chk('showZmanim', 'זמני היום') +
      '</div></div>' +

      '<div class="qr-card"><h3><i class="bi bi-play-btn"></i> סרטונים</h3>' +
      '<div style="margin-bottom:10px">' + chk('videosEnabled', 'נגן סרטונים') +
        chk('videosOnlyOnBreaks', 'רק בהפסקות ובארוחות', '(בזמן שיעור המסך עובר לשעון — בלי סרטונים באמצע)') + '</div>' +
      '<div class="qr-grid" style="grid-template-columns:2fr 1fr 1fr">' +
        '<label class="fld"><span>תיקיית הסרטונים במחשב הלובי</span><input class="inp mb0" data-d="videoRoot" value="' + esc(d.videoRoot || '') + '" placeholder="Z:\\סרטונים"></label>' +
        '<label class="fld"><span>מעבר רך (שניות)</span><input class="inp mb0" type="number" min="0" max="10" data-d="crossfadeSec" value="' + esc(d.crossfadeSec) + '"></label>' +
        '<label class="fld"><span>רענון הגדרות (שניות)</span><input class="inp mb0" type="number" min="15" max="600" data-d="refreshSec" value="' + esc(d.refreshSec) + '"></label>' +
      '</div>' +
      '<h4 style="margin:14px 0 6px">תת־תיקיות לניגון</h4>' +
      (folders.length
        ? '<div class="tla-bar" style="flex-wrap:wrap">' + folders.map(f =>
            '<label class="ym-check"><input type="checkbox" data-folder="' + esc(f) + '"' + (sel.indexOf(f) > -1 ? ' checked' : '') + '> ' + esc(f) + '</label>').join('') +
          '</div><p class="ym-note"><b>חובה לסמן לפחות תיקייה אחת</b> — בלי סימון המסך לא מנגן כלום. ' +
          'זאת בכוונה: בתיקייה הראשית יושב גם חומר שלא נועד למסך שבלובי.</p>'
        : '<p class="ym-note">רשימת התת־תיקיות מגיעה ממחשב הלובי. הפעל שם את "מסך לובי" פעם אחת, ורענן כאן.' +
          (d.videoRoot ? '' : ' קודם כל מלא את נתיב תיקיית הסרטונים ושמור.') + '</p>') +
      '</div>' +

      '<div class="qr-card"><h3><i class="bi bi-hdd-network"></i> מחשב הלובי</h3>' +
      '<div class="ym-note">' +
        (rt.seenAt ? 'דיווח אחרון: ' + new Date(rt.seenAt).toLocaleString('he-IL') +
          ' · תיקייה: ' + esc(rt.root || '—') + ' · ' + (rt.videoCount || 0) + ' סרטונים' +
          (rt.exists === false ? ' <b style="color:#8c2f2f">— הנתיב לא נמצא במחשב</b>' : '')
          : 'המסך עוד לא דיווח. הפעל את הקיצור "מסך לובי" במחשב שבלובי.') +
      '</div>' +
      '<div class="tla-bar" style="margin-top:10px">' +
        '<button class="btn-ghost sm" id="lbReload"><i class="bi bi-arrow-clockwise"></i> רענן מצב</button>' +
        '<span class="ym-note">הכתובת במחשב הלובי: <b>http://localhost:8484</b> · מסך מלא: מקש F או לחיצה כפולה</span>' +
        '<button class="btn-primary sm" id="lbSaveDisp" style="margin-inline-start:auto"><i class="bi bi-check-lg"></i> שמירת ההגדרות</button>' +
      '</div></div>';

    pane.querySelectorAll('[data-d]').forEach(el => {
      const ev = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const f = el.dataset.d;
        d[f] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
      });
    });
    pane.querySelectorAll('[data-folder]').forEach(el => el.addEventListener('change', () => {
      const f = el.dataset.folder;
      const list = (d.videoFolders || []).filter(x => x !== f);
      if (el.checked) list.push(f);
      d.videoFolders = list;
    }));
    pane.querySelector('#lbReload').addEventListener('click', async () => { await loadAll(); draw(page); });
    pane.querySelector('#lbSaveDisp').addEventListener('click', () => save('display'));
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.lobby = render;
})();
