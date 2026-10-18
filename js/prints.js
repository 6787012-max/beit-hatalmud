// prints.js — מעקב הדפסות לצוות (18/10/2026, בקשת יוסף).
//
// החליף את הגיליון "נתוני הדפסות" (6787012) ואת טופס הגוגל שהזין אותו. כל איש
// צוות טוען כסף מראש, וכל הדפסה מורידה מהיתרה לפי מחיר לעמוד. המסד:
// supabase/migration_prints.sql — print_jobs / print_credits / print_prices /
// print_link, והיתרות מחושבות בשרת ב-print_balances().
//
// ⚠️ למה לא לחשב יתרה מתוך הרשימות בצד-לקוח: PostgREST חותך ב-1000 שורות, וזו
// בדיוק התקלה שהרגה את הגיליון — הנוסחאות נעצרו בשורה 999, ומ-17/07/2026 אף
// הדפסה לא ירדה מהיתרה. print_balances() סוכם במסד, בלי גבול.
//
// משרד (מנהל/מזכירה; מפקח צופה בלבד) — כל הצוות, טעינות, מחירים, קישור, יבוא.
// איש צוות רגיל — היתרה וההיסטוריה שלו בלבד, ודיווח על הדפסה שלו (RLS מחליט).
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => '₪' + (Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDT = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('he-IL') + ' ' + x.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); };
  const fmtD = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('he-IL'); };
  const COLORS = ['שחור לבן', 'צבעוני'], SIZES = ['A4', 'A3'];
  const HEAD = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>הדפסות</h2></div>';

  const role = () => ((window.Auth && window.Auth.currentUser) || window.currentUser || {}).role;
  const isOffice = () => ['מנהל', 'מזכירה', 'מפקח'].includes(role());
  const canManage = () => ['מנהל', 'מזכירה'].includes(role()) && !(window.Auth && window.Auth.isReadonly && window.Auth.isReadonly());
  const balCls = b => b < 0 ? 'color:#b91c1c;font-weight:700' : (b < 10 ? 'color:#b45309;font-weight:700' : 'color:#15803d;font-weight:700');

  async function rpc(name, args) {
    const { data, error } = await window.sb.rpc(name, args || {});
    return { ok: !error, data: data || [], error: error && error.message };
  }

  async function render(page) {
    page.innerHTML = HEAD + '<div style="padding:30px;text-align:center"><i class="bi bi-hourglass-split"></i> טוען…</div>';
    if (!window.sb) { page.innerHTML = HEAD + '<div class="empty-state"><i class="bi bi-printer"></i><div>לא זמין במצב הדגמה</div></div>'; return; }
    const [bal, prices] = await Promise.all([rpc('print_balances'), window.db.list('print_prices', { order: 'size' })]);
    if (!bal.ok) {
      page.innerHTML = HEAD + '<div class="empty-state"><i class="bi bi-database-exclamation"></i><div>מסך ההדפסות עדיין לא מוגדר במסד (' +
        esc(bal.error) + '). יש להריץ את <code>supabase/migration_prints.sql</code>.</div></div>';
      return;
    }
    const st = { rows: bal.data, prices: prices.data || [] };
    if (isOffice()) return renderOffice(page, st);
    return renderMine(page, st);
  }

  const priceOf = (st, color, size) => { const p = st.prices.find(x => x.color === color && x.size === size); return p ? Number(p.price) : 0; };

  // ── איש צוות: היתרה שלי ──────────────────────────────────────────────
  function renderMine(page, st) {
    const me = st.rows[0];
    if (!me) {
      page.innerHTML = HEAD + '<div class="empty-state"><i class="bi bi-person-x"></i><div>המשתמש שלך לא מקושר לאיש צוות ברשימת הצוות, ולכן אין לך חשבון הדפסות. פנה למזכירות.</div></div>';
      return;
    }
    page.innerHTML = HEAD +
      '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-wallet2"></i> היתרה שלי — ' + esc(me.name) + '</h3>' +
        '<span style="display:flex;gap:6px;flex-wrap:wrap"><a class="btn-ghost sm" id="prPay" target="_blank" rel="noopener" style="display:none"><i class="bi bi-credit-card"></i> טעינה בנדרים פלוס</a>' +
        '<button class="btn-primary sm" id="prNew"><i class="bi bi-plus-lg"></i> דיווח הדפסה</button></span></div>' +
        '<div style="font-size:2rem;' + balCls(Number(me.balance)) + '">' + money(me.balance) + '</div>' +
        (Number(me.balance) < 0 ? '<p class="login-hint" style="color:#b91c1c;margin:4px 0 0">אין יתרה — יש לטעון במזכירות.</p>' : '') +
        '<p class="login-hint" style="margin:6px 0 0">נטען: ' + money(me.credits) + ' · הודפס: ' + money(me.used) + ' (' + Number(me.pages || 0).toLocaleString('he-IL') + ' עמודים)</p>' +
        pricesLine(st) + '</div>' +
      '<div class="qr-card"><h3><i class="bi bi-clock-history"></i> היסטוריה</h3><div id="prHist">טוען…</div></div>';
    page.querySelector('#prNew').addEventListener('click', () => jobForm(st, me, () => render(page)));
    payLink().then(u => { const a = page.querySelector('#prPay'); if (u && a) { a.href = u; a.style.display = ''; } });
    drawHistory(page.querySelector('#prHist'), me, st, false, () => render(page));
  }

  function pricesLine(st) {
    return '<p class="login-hint" style="margin:6px 0 0">מחיר לעמוד: ' + SIZES.map(s => COLORS.map(c => s + ' ' + c + ' ' + money(priceOf(st, c, s))).join(' · ')).join(' · ') + '</p>';
  }

  // ── משרד: כל הצוות ───────────────────────────────────────────────────
  function renderOffice(page, st) {
    // הפעילים למעלה (בקשת יוסף): צוות פעיל שיש לו תנועות, לפי ההדפסה האחרונה; אחריו
    // צוות פעיל בלי תנועות; ובסוף מי שהושבת ונשארה לו יתרה.
    const act = r => (Number(r.jobs) > 0 || Number(r.credits) !== 0) ? 1 : 0;
    const rows = st.rows.slice().sort((a, b) => ((b.active ? 1 : 0) - (a.active ? 1 : 0)) || (act(b) - act(a)) ||
      String(b.last_print || '').localeCompare(String(a.last_print || '')) || String(a.name).localeCompare(String(b.name), 'he'));
    const neg = rows.filter(r => Number(r.balance) < 0);
    const tot = k => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
    page.innerHTML = HEAD +
      '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-printer"></i> יתרות הצוות</h3>' +
        (canManage() ? '<span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn-ghost sm" id="prImport"><i class="bi bi-upload"></i> יבוא מטופס גוגל</button>' +
          '<button class="btn-primary sm" id="prNewJob"><i class="bi bi-plus-lg"></i> הדפסה</button>' +
          '<button class="btn-primary sm" id="prNewCredit"><i class="bi bi-cash-coin"></i> טעינה</button></span>' : '') + '</div>' +
        '<p class="login-hint" style="margin:0 0 8px">נטען בסך הכל ' + money(tot('credits')) + ' · הודפס ' + money(tot('used')) +
          (neg.length ? ' · <b style="color:#b91c1c">' + neg.length + ' בלי יתרה</b>' : '') + '</p>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>שם</th><th>נטען</th><th>הודפס</th><th>יתרה</th><th>עמודים</th><th>הדפסה אחרונה</th><th></th></tr></thead><tbody>' +
        rows.map(r => '<tr' + (r.active ? '' : ' style="opacity:.6"') + '><td>' + esc(r.name) + (r.active ? '' : ' <span class="chip off">לא פעיל</span>') +
          (r.role_label ? '<div class="tl-note">' + esc(r.role_label) + '</div>' : '') + '</td>' +
          '<td>' + money(r.credits) + '</td><td>' + money(r.used) + '</td>' +
          '<td style="' + balCls(Number(r.balance)) + '">' + money(r.balance) + '</td>' +
          '<td>' + Number(r.pages || 0).toLocaleString('he-IL') + '</td><td>' + fmtD(r.last_print) + '</td>' +
          '<td class="row-act"><button class="mini" data-hist="' + r.staff_id + '" title="היסטוריה"><i class="bi bi-list-ul"></i></button>' +
            (canManage() ? '<button class="mini" data-credit="' + r.staff_id + '" title="טעינה"><i class="bi bi-cash-coin"></i></button>' +
              '<button class="mini" data-job="' + r.staff_id + '" title="הדפסה"><i class="bi bi-printer"></i></button>' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' +
        '<p class="login-hint" style="margin:8px 2px 0">הרשימה = הצוות הפעיל במסך "ניהול צוות". איש צוות שהושבת ויש לו תנועות נשאר מוצג באפור.</p></div>' +
      '<div class="qr-card" id="prHistCard" style="display:none"><div class="card-h-row"><h3 id="prHistTitle"></h3><button class="btn-ghost sm" id="prHistClose"><i class="bi bi-x-lg"></i></button></div><div id="prHist"></div></div>' +
      (canManage() ? '<div class="qr-card"><h3><i class="bi bi-tags"></i> מחירים לעמוד</h3><div id="prPrices"></div></div>' +
        '<div class="qr-card"><h3><i class="bi bi-qr-code"></i> קישור לדיווח ליד המדפסת</h3><div id="prLink">טוען…</div></div>' +
        '<div class="qr-card"><h3><i class="bi bi-credit-card-2-front"></i> טעינות מנדרים פלוס</h3><div id="prNedarim">טוען…</div></div>' : pricesLine(st));

    const reload = () => render(page);
    const byId = id => rows.find(r => String(r.staff_id) === String(id));
    page.querySelectorAll('[data-hist]').forEach(b => b.addEventListener('click', () => {
      const r = byId(b.dataset.hist); const card = page.querySelector('#prHistCard');
      card.style.display = ''; page.querySelector('#prHistTitle').textContent = 'היסטוריה — ' + r.name;
      drawHistory(page.querySelector('#prHist'), r, st, canManage(), reload);
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    const hc = page.querySelector('#prHistClose'); if (hc) hc.addEventListener('click', () => { page.querySelector('#prHistCard').style.display = 'none'; });
    page.querySelectorAll('[data-credit]').forEach(b => b.addEventListener('click', () => creditForm(rows, byId(b.dataset.credit), reload)));
    page.querySelectorAll('[data-job]').forEach(b => b.addEventListener('click', () => jobForm(st, byId(b.dataset.job), reload, rows)));
    const nj = page.querySelector('#prNewJob'); if (nj) nj.addEventListener('click', () => jobForm(st, null, reload, rows));
    const nc = page.querySelector('#prNewCredit'); if (nc) nc.addEventListener('click', () => creditForm(rows, null, reload));
    const im = page.querySelector('#prImport'); if (im) im.addEventListener('click', () => importForm(rows, reload));
    if (canManage()) { drawPrices(page.querySelector('#prPrices'), st, reload); drawLink(page.querySelector('#prLink')); drawNedarim(page.querySelector('#prNedarim'), rows, reload); }
  }

  // היסטוריה: טעינות והדפסות בציר אחד, עם יתרה מתגלגלת (מהישן לחדש, מוצג מהחדש).
  async function drawHistory(host, r, st, manage, reload) {
    host.innerHTML = 'טוען…';
    const [jobs, credits] = await Promise.all([
      window.db.list('print_jobs', { eq: { staff_id: r.staff_id }, order: 'printed_at' }),
      window.db.list('print_credits', { eq: { staff_id: r.staff_id }, order: 'credited_at' }),
    ]);
    if (!jobs.ok || !credits.ok) { host.innerHTML = '<div class="tl-note">שגיאה בטעינה: ' + esc(jobs.error || credits.error) + '</div>'; return; }
    const ev = [].concat(
      (credits.data || []).map(c => ({ kind: 'c', id: c.id, at: c.credited_at, amt: Number(c.amount), txt: 'טעינה' + (c.note ? ' — ' + c.note : '') })),
      (jobs.data || []).map(j => ({ kind: 'j', id: j.id, at: j.printed_at, amt: -Number(j.cost), txt: j.qty + ' × ' + j.size + ' ' + j.color + ' (' + money(j.unit_price) + ')' + (j.source === 'גיליון' ? ' <span class="tl-note">מהגיליון</span>' : j.source === 'קישור' ? ' <span class="tl-note">מהקישור</span>' : '') + (j.note ? ' — ' + esc(j.note) : '') }))
    ).sort((a, b) => String(a.at).localeCompare(String(b.at)) || (a.kind === 'c' ? -1 : 1));
    let run = 0; ev.forEach(e => { run += e.amt; e.run = run; });
    ev.reverse();
    const months = {};
    (jobs.data || []).forEach(j => { const k = String(j.printed_at).slice(0, 7); months[k] = (months[k] || 0) + Number(j.cost); });
    const mk = Object.keys(months).sort().slice(-6);
    host.innerHTML = (mk.length ? '<p class="login-hint" style="margin:0 0 8px">חצי השנה האחרונה: ' + mk.map(k => k.slice(5) + '/' + k.slice(2, 4) + ' ' + money(months[k])).join(' · ') + '</p>' : '') +
      (ev.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>תאריך</th><th>פירוט</th><th>סכום</th><th>יתרה</th>' + (manage ? '<th></th>' : '') + '</tr></thead><tbody>' +
        ev.map(e => '<tr><td>' + (e.kind === 'c' ? fmtD(e.at) : fmtDT(e.at)) + '</td><td>' + (e.kind === 'c' ? '<b>' + esc(e.txt) + '</b>' : e.txt) + '</td>' +
          '<td style="color:' + (e.amt >= 0 ? '#15803d' : 'inherit') + '">' + (e.amt >= 0 ? '+' : '') + money(e.amt) + '</td>' +
          '<td style="' + balCls(e.run) + '">' + money(e.run) + '</td>' +
          (manage ? '<td class="row-act"><button class="mini danger" data-del="' + e.kind + ':' + e.id + '" title="מחיקה"><i class="bi bi-trash"></i></button></td>' : '') + '</tr>').join('') +
        '</tbody></table></div>' : '<div class="tl-note">אין תנועות עדיין</div>');
    host.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      const [k, id] = b.dataset.del.split(':');
      if (!(await window.UI.confirm(k === 'c' ? 'למחוק את הטעינה?' : 'למחוק את ההדפסה?'))) return;
      const res = await window.db.remove(k === 'c' ? 'print_credits' : 'print_jobs', id);
      if (!res.ok) { window.UI.toast('המחיקה נכשלה: ' + res.error, 'err'); return; }
      window.UI.toast('נמחק'); reload();
    }));
  }

  const staffSelect = (rows, sel) => '<select class="inp mb0" id="pr_staff">' + (sel ? '' : '<option value="">— בחר —</option>') +
    rows.filter(r => r.active || (sel && r.staff_id === sel.staff_id)).map(r => '<option value="' + r.staff_id + '"' + (sel && r.staff_id === sel.staff_id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select>';

  function jobForm(st, who, reload, rows) {
    const office = !!rows;
    const jm = window.UI.modal({
      title: 'דיווח הדפסה', saveLabel: 'שמירה',
      bodyHTML: '<div class="form-grid">' +
        (office ? '<label class="fld"><span>איש צוות *</span>' + staffSelect(rows, who) + '</label>' : '') +
        '<label class="fld"><span>סוג</span><select class="inp mb0" id="pr_color">' + COLORS.map(c => '<option>' + c + '</option>').join('') + '</select></label>' +
        '<label class="fld"><span>גודל דף</span><select class="inp mb0" id="pr_size">' + SIZES.map(s => '<option>' + s + '</option>').join('') + '</select></label>' +
        '<label class="fld"><span>כמות עמודים *</span><input class="inp mb0" id="pr_qty" type="number" min="1" max="5000" inputmode="numeric"></label>' +
        (office ? '<label class="fld"><span>תאריך ושעה</span><input class="inp mb0" id="pr_at" type="datetime-local"></label>' : '') +
        '<label class="fld fld-wide"><span>הערה</span><input class="inp mb0" id="pr_note"></label>' +
        '<div class="fld-wide tl-note" id="pr_cost"></div></div>',
      onSave: async (m) => {
        const sid = office ? Number(m.querySelector('#pr_staff').value) : who.staff_id;
        const qty = parseInt(m.querySelector('#pr_qty').value, 10);
        if (!sid) { window.UI.toast('יש לבחור איש צוות', 'err'); return false; }
        if (!(qty > 0 && qty <= 5000)) { window.UI.toast('כמות לא תקינה', 'err'); return false; }
        const row = { staff_id: sid, color: m.querySelector('#pr_color').value, size: m.querySelector('#pr_size').value, qty, source: 'תוכנה' };
        const note = m.querySelector('#pr_note').value.trim(); if (note) row.note = note;
        const at = office && m.querySelector('#pr_at').value; if (at) row.printed_at = new Date(at).toISOString();
        const res = await window.db.insert('print_jobs', row);
        if (!res.ok) { window.UI.toast('השמירה נכשלה: ' + res.error, 'err'); return false; }
        window.UI.toast('נרשם: ' + money(res.data && res.data[0] ? res.data[0].cost : 0)); reload(); return true;
      },
    });
    const box = jm.el;
    const upd = () => {
      const q = parseInt((box.querySelector('#pr_qty') || {}).value, 10) || 0;
      const p = priceOf(st, box.querySelector('#pr_color').value, box.querySelector('#pr_size').value);
      box.querySelector('#pr_cost').textContent = q ? ('עלות: ' + q + ' × ' + money(p) + ' = ' + money(q * p)) : ('מחיר לעמוד: ' + money(p));
    };
    ['#pr_qty', '#pr_color', '#pr_size'].forEach(s => { const e = box.querySelector(s); if (e) e.addEventListener('input', upd); });
    upd();
  }

  function creditForm(rows, who, reload) {
    window.UI.modal({
      title: 'טעינת כסף להדפסות', saveLabel: 'שמירה',
      bodyHTML: '<div class="form-grid">' +
        '<label class="fld"><span>איש צוות *</span>' + staffSelect(rows, who) + '</label>' +
        '<label class="fld"><span>סכום ₪ * <small style="font-weight:400;color:var(--muted)">(שלילי = תיקון)</small></span><input class="inp mb0" id="pr_amt" type="number" step="0.01"></label>' +
        '<label class="fld"><span>תאריך</span><input class="inp mb0" id="pr_date" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></label>' +
        '<label class="fld fld-wide"><span>הערה</span><input class="inp mb0" id="pr_cnote" placeholder="למשל: מזומן במזכירות"></label></div>',
      onSave: async (m) => {
        const sid = Number(m.querySelector('#pr_staff').value), amount = Number(m.querySelector('#pr_amt').value);
        if (!sid) { window.UI.toast('יש לבחור איש צוות', 'err'); return false; }
        if (!amount) { window.UI.toast('יש להזין סכום', 'err'); return false; }
        const row = { staff_id: sid, amount, credited_at: m.querySelector('#pr_date').value || undefined };
        const note = m.querySelector('#pr_cnote').value.trim(); if (note) row.note = note;
        const res = await window.db.insert('print_credits', row);
        if (!res.ok) { window.UI.toast('השמירה נכשלה: ' + res.error, 'err'); return false; }
        window.UI.toast('הטעינה נרשמה'); reload(); return true;
      },
    });
  }

  function drawPrices(host, st, reload) {
    host.innerHTML = '<p class="login-hint" style="margin:0 0 8px">מחיר לעמוד כולל נייר. שינוי מחיר חל רק על הדפסות מכאן והלאה — כל הדפסה שומרת את המחיר שהיה בתוקף כשנרשמה.</p>' +
      '<div class="form-grid">' + SIZES.map(s => COLORS.map(c => '<label class="fld"><span>' + s + ' ' + c + '</span><input class="inp mb0" type="number" step="0.001" min="0" data-c="' + c + '" data-s="' + s + '" value="' + priceOf(st, c, s) + '"></label>').join('')).join('') + '</div>' +
      '<button class="btn-primary sm" id="prPriceSave" style="margin-top:8px"><i class="bi bi-check-lg"></i> שמירת מחירים</button>';
    host.querySelector('#prPriceSave').addEventListener('click', async () => {
      for (const inp of host.querySelectorAll('input[data-c]')) {
        const price = Number(inp.value);
        if (!(price >= 0) || inp.value === '') { window.UI.toast('מחיר לא תקין', 'err'); return; }
        if (price === priceOf(st, inp.dataset.c, inp.dataset.s)) continue;
        const { error } = await window.sb.from('print_prices').update({ price, updated_at: new Date().toISOString() }).eq('color', inp.dataset.c).eq('size', inp.dataset.s);
        if (error) { window.UI.toast('השמירה נכשלה: ' + error.message, 'err'); return; }
      }
      window.UI.toast('המחירים נשמרו'); reload();
    });
  }

  async function drawLink(host) {
    const { data, error } = await window.sb.from('print_link').select('*').eq('id', 1).maybeSingle();
    if (error || !data) { host.innerHTML = '<div class="tl-note">לא נמצא קישור (' + esc(error && error.message) + ')</div>'; return; }
    const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'print.html?k=' + data.token;
    host.innerHTML = '<p class="login-hint" style="margin:0 0 8px">דף קצר בלי כניסה למערכת: בוחרים שם, סוג, גודל וכמות. מחליף את טופס הגוגל — אפשר לתלות ליד המדפסת כקוד QR.</p>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><input class="inp mb0" readonly value="' + esc(url) + '" style="flex:1;min-width:220px;direction:ltr">' +
      '<button class="btn-ghost sm" id="lkCopy"><i class="bi bi-clipboard"></i> העתקה</button>' +
      '<a class="btn-ghost sm" href="' + esc(url) + '" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-left"></i> פתיחה</a>' +
      '<button class="btn-ghost sm" id="lkToggle">' + (data.enabled ? '<i class="bi bi-pause"></i> השבתה' : '<i class="bi bi-play"></i> הפעלה') + '</button>' +
      '<button class="btn-ghost sm" id="lkNew" title="הקישור הישן יפסיק לעבוד"><i class="bi bi-arrow-repeat"></i> קישור חדש</button></div>' +
      (data.enabled ? '' : '<p class="login-hint" style="color:#b91c1c;margin:6px 0 0">הקישור מושבת כרגע.</p>');
    host.querySelector('#lkCopy').addEventListener('click', () => { navigator.clipboard.writeText(url).then(() => window.UI.toast('הקישור הועתק')); });
    host.querySelector('#lkToggle').addEventListener('click', async () => {
      await window.sb.from('print_link').update({ enabled: !data.enabled, updated_at: new Date().toISOString() }).eq('id', 1); drawLink(host);
    });
    host.querySelector('#lkNew').addEventListener('click', async () => {
      if (!(await window.UI.confirm('ליצור קישור חדש? הקישור הקיים (וכל QR שהודפס) יפסיק לעבוד.'))) return;
      const b = new Uint8Array(12); crypto.getRandomValues(b);
      await window.sb.from('print_link').update({ token: Array.from(b, x => x.toString(16).padStart(2, '0')).join(''), updated_at: new Date().toISOString() }).eq('id', 1);
      drawLink(host);
    });
  }

  // ── נדרים פלוס ──────────────────────────────────────────────────────
  // דף התשלום של המכינה עם קטגוריה "הדפסות" נעולה והערה "הדפסות #<staff_id>" — לפיה
  // ה-Webhook (Edge Function nedarim-print) יודע למי לטעון. בלי staff → קישור כללי,
  // והזיהוי נעשה לפי ת"ז / טלפון / שם.
  function nedarimUrl(mosad, groupe, staffId, name) {
    // encodeURIComponent ולא URLSearchParams: האחרון מקודד רווח כ-'+', ונדרים שומרים את
    // ה-'+' כמו שהוא בהערה ("הדפסות+#1", נראה בתשלום האמיתי הראשון, 18/10/2026).
    const q = { mosad, Groupe: groupe, GroupeLock: '1', OnlyNormal: '1' };
    if (staffId) q.Avour = groupe + ' #' + staffId;
    if (name) q.ClientName = name;
    return 'https://www.matara.pro/nedarimplus/online/?' + Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&');
  }
  async function payLink() {
    const r = await rpc('print_nedarim_link'); const x = r.data[0];
    return x && x.staff_id ? nedarimUrl(x.mosad, x.groupe, x.staff_id, x.name) : null;
  }
  async function drawNedarim(host, rows, reload) {
    const [cfgRes, pays] = await Promise.all([
      window.sb.from('print_nedarim').select('*').eq('id', 1).maybeSingle(),
      window.db.list('print_nedarim_payments', { order: 'received_at', asc: false }),
    ]);
    const cfg = cfgRes.data;
    if (!cfg) { host.innerHTML = '<div class="tl-note">לא מוגדר (' + esc(cfgRes.error && cfgRes.error.message) + ')</div>'; return; }
    // בלי הסוד: הפונקציה מקבלת בלעדיו רק פניות מכתובות ה-IP של נדרים.
    const hook = ((window.CV3 || {}).SUPABASE_URL || '') + '/functions/v1/nedarim-print';
    const generic = nedarimUrl(cfg.mosad, cfg.groupe);
    const list = (pays.data || []).slice(0, 40);
    const waiting = list.filter(p => p.status !== 'נטען');
    const nameOf = id => { const r = rows.find(x => String(x.staff_id) === String(id)); return r ? r.name : '—'; };
    const opts = rows.filter(r => r.active).map(r => '<option value="' + r.staff_id + '">' + esc(r.name) + '</option>').join('');
    host.innerHTML =
      '<p class="login-hint" style="margin:0 0 8px">כל תשלום בנדרים פלוס בקטגוריה "' + esc(cfg.groupe) + '" (מוסד ' + esc(cfg.mosad) + ') נטען לבד ליתרה של איש הצוות. ' +
        'תשלום שלא זוהה למי הוא שייך מחכה כאן לשיוך ידני. טעינה במזומן — בכפתור "טעינה" למעלה, כרגיל.</p>' +
      '<div class="fld"><span>קישור תשלום כללי להדפסות (לשליחה לרב בלי כניסה למערכת)</span>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><input class="inp mb0" readonly value="' + esc(generic) + '" style="flex:1;min-width:220px;direction:ltr">' +
        '<button class="btn-ghost sm" data-copy="g"><i class="bi bi-clipboard"></i> העתקה</button></div></div>' +
      '<details style="margin-top:8px"><summary>הגדרה חד-פעמית בנדרים פלוס (כתובת Webhook)</summary>' +
        '<p class="login-hint" style="margin:6px 0">בנדרים פלוס של המכינה: עוד ← Webhook ← בשדה "עדכוני עסקאות" מדביקים את הכתובת ושומרים. ' +
        '<b>אם כבר רשומה שם כתובת אחרת — לא לדרוס בלי לבדוק למה היא משמשת.</b></p>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><input class="inp mb0" readonly value="' + esc(hook) + '" style="flex:1;min-width:220px;direction:ltr">' +
        '<button class="btn-ghost sm" data-copy="h"><i class="bi bi-clipboard"></i> העתקה</button></div></details>' +
      '<h4 style="margin:12px 0 6px">תשלומים אחרונים' + (waiting.length ? ' · <span style="color:#b45309">' + waiting.length + ' ממתינים לשיוך</span>' : '') + '</h4>' +
      (list.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>תאריך</th><th>שם המשלם</th><th>סכום</th><th>מצב</th><th>איש צוות</th></tr></thead><tbody>' +
        list.map(p => '<tr><td>' + fmtDT(p.paid_at || p.received_at) + '</td><td>' + esc(p.client_name || '—') + (p.comments ? '<div class="tl-note">' + esc(p.comments) + '</div>' : '') + '</td>' +
          '<td>' + money(p.amount) + '</td>' +
          '<td>' + (p.status === 'נטען' ? '<span class="chip ok">נטען</span>' : '<span class="chip off" style="color:#b45309;border-color:#b45309">ממתין</span>') +
            (p.note ? '<div class="tl-note">' + esc(p.note) + '</div>' : '') + '</td>' +
          '<td>' + (p.status === 'נטען' ? esc(nameOf(p.staff_id)) :
            '<span style="display:flex;gap:4px"><select class="inp mb0" data-assel="' + p.id + '"><option value="">— בחר —</option>' + opts + '</select>' +
            '<button class="btn-primary sm" data-assign="' + p.id + '">שיוך</button></span>') + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="tl-note">עדיין לא התקבלו תשלומים מנדרים פלוס.</div>');
    host.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
      navigator.clipboard.writeText(b.dataset.copy === 'h' ? hook : generic).then(() => window.UI.toast('הועתק'));
    }));
    host.querySelectorAll('[data-assel]').forEach(sel => {
      const p = list.find(x => String(x.id) === sel.dataset.assel); if (p && p.staff_id) sel.value = String(p.staff_id);
    });
    host.querySelectorAll('[data-assign]').forEach(b => b.addEventListener('click', async () => {
      const sid = Number(host.querySelector('[data-assel="' + b.dataset.assign + '"]').value);
      if (!sid) { window.UI.toast('יש לבחור איש צוות', 'err'); return; }
      const { error } = await window.sb.rpc('print_assign_nedarim', { p_id: Number(b.dataset.assign), p_staff: sid });
      if (error) { window.UI.toast('השיוך נכשל: ' + error.message, 'err'); return; }
      window.UI.toast('התשלום שויך ונטען'); reload();
    }));
  }

  // ── כרטיס במסך הבית: היתרה שלי + שלוש התנועות האחרונות (לכל מי שמקושר לאיש צוות) ──
  async function homeCard(host) {
    if (!host) return;
    host.innerHTML = '';
    if (!window.sb || !(window.Auth && window.Auth.currentUser)) return;
    const link = await rpc('print_nedarim_link'); const me = link.data[0];
    if (!me || !me.staff_id) return;
    const [bal, jobs, credits] = await Promise.all([
      rpc('print_balances'),
      window.sb.from('print_jobs').select('printed_at,qty,size,color,cost').eq('staff_id', me.staff_id).order('printed_at', { ascending: false }).limit(3),
      window.sb.from('print_credits').select('credited_at,amount,source').eq('staff_id', me.staff_id).order('credited_at', { ascending: false }).limit(3),
    ]);
    const row = (bal.data || []).find(r => String(r.staff_id) === String(me.staff_id));
    if (!row) return;
    const ev = [].concat(
      (jobs.data || []).map(j => ({ at: j.printed_at, t: j.qty + ' × ' + j.size + ' ' + j.color, a: -Number(j.cost) })),
      (credits.data || []).map(c => ({ at: c.credited_at, t: 'טעינה' + (c.source === 'נדרים פלוס' ? ' בנדרים פלוס' : ''), a: Number(c.amount) }))
    ).sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 3);
    const b = Number(row.balance);
    host.innerHTML = '<div class="qr-card" style="margin:0 0 14px"><div class="card-h-row"><h3><i class="bi bi-printer"></i> יתרת ההדפסות שלי</h3>' +
      '<span style="display:flex;gap:6px;flex-wrap:wrap"><a class="btn-ghost sm" target="_blank" rel="noopener" href="' + esc(nedarimUrl(me.mosad, me.groupe, me.staff_id, me.name)) + '"><i class="bi bi-credit-card"></i> טעינה בנדרים פלוס</a>' +
      '<button class="btn-primary sm" onclick="showPage(\'prints\')"><i class="bi bi-list-ul"></i> כל ההיסטוריה</button></span></div>' +
      '<div style="font-size:1.6rem;' + balCls(b) + '">' + money(b) + (b < 0 ? ' <span style="font-size:.9rem">— אין יתרה, יש לטעון</span>' : '') + '</div>' +
      (ev.length ? '<div class="tl-note" style="margin-top:4px">' + ev.map(e => fmtD(e.at) + ' · ' + esc(e.t) + ' · ' + (e.a >= 0 ? '+' : '') + money(e.a)).join('<br>') + '</div>' : '') +
      '</div>';
  }
  window.cv3Prints = { homeCard };

  // ── יבוא מטופס הגוגל הישן (לתקופת המעבר, עד שהקישור החדש מחליף אותו) ──
  // מורידים מהגיליון את לשונית התשובות (הלשונית ששמה רווח, עם "חותמת זמן") כ-CSV.
  // שם בגיליון = שם משפחה; מותאם לאיש צוות פעיל אחד בלבד. כפילות = אותו איש צוות,
  // אותה שנייה, אותו סוג/גודל/כמות. כל שורה שלא נכנסה מדווחת — לא נבלעת.
  function parseTs(v) {
    if (v == null || v === '') return null;
    if (/^\d+(\.\d+)?$/.test(String(v))) { const d = new Date(Math.round((Number(v) - 25569) * 86400000)); return new Date(d.getTime() + d.getTimezoneOffset() * 60000); }
    const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  }
  function importForm(rows, reload) {
    const mm = window.UI.modal({
      title: 'יבוא מטופס הגוגל "נתוני הדפסות"',
      bodyHTML: '<p class="login-hint" style="margin:0 0 8px">בגיליון: לעמוד על לשונית התשובות (זו עם "חותמת זמן") → קובץ → הורדה → CSV. ' +
        'הדפסות שכבר קיימות לא ייכנסו פעמיים.</p><input type="file" id="prFile" accept=".csv,.xlsx" class="inp mb0"><div id="prImpOut" style="margin-top:10px"></div>',
    });
    mm.el.querySelector('#prFile').addEventListener('change', async (e) => {
      const out = mm.el.querySelector('#prImpOut'); out.textContent = 'קורא…';
      let data;
      try { data = await window.XlsxLite.readFile(e.target.files[0]); } catch (err) { out.textContent = 'לא ניתן לקרוא: ' + err.message; return; }
      const hi = data.findIndex(r => r.some(c => String(c).trim() === 'חותמת זמן'));
      if (hi < 0) { out.innerHTML = '<b style="color:#b91c1c">לא נמצאה עמודת "חותמת זמן".</b> כנראה הורדה לשונית אחרת — צריך את לשונית התשובות.'; return; }
      const h = data[hi].map(c => String(c).trim());
      const ix = { ts: h.indexOf('חותמת זמן'), name: h.indexOf('שם הרב'), color: h.indexOf('בחירת ההדפסה'), size: h.indexOf('גודל דף'), qty: h.indexOf('כמות') };
      if (Object.values(ix).some(i => i < 0)) { out.textContent = 'חסרות עמודות (שם הרב / בחירת ההדפסה / גודל דף / כמות).'; return; }
      const active = rows.filter(r => r.active);
      const findStaff = nm => { const hits = active.filter(r => String(r.name).split(/\s+/).pop() === nm || r.name === nm); return hits.length === 1 ? hits[0] : null; };
      const ex = await window.db.list('print_jobs', { select: 'staff_id,printed_at,color,size,qty' });
      const key = (sid, d, c, s, q) => sid + '|' + Math.round(new Date(d).getTime() / 1000) + '|' + c + '|' + s + '|' + q;
      const have = new Set((ex.data || []).map(j => key(j.staff_id, j.printed_at, j.color, j.size, j.qty)));
      const add = [], skipName = {}, bad = []; let dup = 0;
      data.slice(hi + 1).forEach((r, i) => {
        if (!r.some(c => String(c).trim())) return;
        const nm = String(r[ix.name] || '').trim(), st = findStaff(nm), d = parseTs(r[ix.ts]);
        const c = String(r[ix.color] || '').trim(), s = String(r[ix.size] || '').trim().toUpperCase(), q = parseInt(r[ix.qty], 10);
        if (!st) { skipName[nm || '(ריק)'] = (skipName[nm || '(ריק)'] || 0) + 1; return; }
        if (!d || !COLORS.includes(c) || !SIZES.includes(s) || !(q > 0 && q <= 5000)) { bad.push(hi + i + 2); return; }
        if (have.has(key(st.staff_id, d, c, s, q))) { dup++; return; }
        have.add(key(st.staff_id, d, c, s, q));
        add.push({ staff_id: st.staff_id, printed_at: d.toISOString(), color: c, size: s, qty: q, source: 'גיליון' });
      });
      const names = Object.keys(skipName);
      out.innerHTML = '<div>חדשות לייבוא: <b>' + add.length + '</b> · כבר קיימות: ' + dup + '</div>' +
        (names.length ? '<div style="color:#b45309">לא ייובאו — שם שאינו בצוות הפעיל: ' + names.map(n => esc(n) + ' (' + skipName[n] + ')').join(', ') + '</div>' : '') +
        (bad.length ? '<div style="color:#b91c1c">שורות פגומות שלא ייובאו: ' + bad.slice(0, 20).join(', ') + (bad.length > 20 ? '…' : '') + '</div>' : '') +
        (add.length ? '<button class="btn-primary sm" id="prImpGo" style="margin-top:8px">ייבוא ' + add.length + ' הדפסות</button>' : '');
      const go = out.querySelector('#prImpGo');
      if (go) go.addEventListener('click', async () => {
        go.disabled = true;
        for (let i = 0; i < add.length; i += 200) {
          const { error } = await window.sb.from('print_jobs').insert(add.slice(i, i + 200));
          if (error) { window.UI.toast('היבוא נעצר: ' + error.message, 'err'); go.disabled = false; return; }
        }
        window.UI.toast('יובאו ' + add.length + ' הדפסות'); mm.close(); reload();
      });
    });
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.prints = render;
})();
