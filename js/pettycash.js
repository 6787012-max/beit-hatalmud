// pettycash.js — קופה קטנה, כמה קופות נפרדות (2026-08-25, בקשת יוסף).
//
// למה מסך נפרד מ"קופה כללית": הקופה הכללית היא הכסף המוסדי — שכר, תלושים,
// העברות. קופה קטנה היא קניות יומיומיות, ושלוש השאלות עליה הן אחרות לגמרי:
// **מי קנה**, **האם מגיע לו החזר**, ו**איפה החשבונית**.
//
// **הקופות נפרדות לחלוטין.** "משמרת חיים" היא גוף אחר — הכסף, החשבוניות
// והיתרה שלה אינם של המכינה. כל מספר במסך הזה מסונן לפי הקופה הנבחרת, ואין
// שום סיכום שחוצה קופות. אם אי פעם יתווסף "סה\"כ הכל" — זו תהיה טעות.
//
// **מודל היתרה — שלושה מספרים בכוונה** (זהה לגיליונות הקופה הקטנה, ראה
// C:\projects\kupa-katana):
//   • יתרת מזומן בקופה = פתיחה + הכנסות − הוצאות ש**שולמו** בפועל.
//     קנייה בסטטוס "ממתין להחזר" עוד לא יצאה מהקופה — הכסף של הרב יצא, לא שלה.
//   • חוב לצוות       = סך ה"ממתין להחזר". זה מה שהמוסד חייב להחזיר.
//   • יתרה נטו        = פתיחה + הכנסות − כל ההוצאות, כולל הממתינות.
// אלה שלושה דברים שונים ואסור לאחד אותם.
//
// חשבוניות עולות ישירות לתיקיית הדרייב של הקופה (petty_funds.drive_folder)
// דרך ה-Edge Function `drive` עם ?fundId= — הדפדפן לא נוגע בגוגל.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const ILS = n => '₪' + (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 });
  const dmy = x => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : (x || ''); };

  const METHODS = ['מזומן', 'העברה', 'אשראי', 'צ׳ק', 'נדרים פלוס'];
  // 'כללית' ו'עובד' הגיעו מהקופה הכללית שמוזגה לכאן (25/08/2026). הן ברשימה
  // כדי שעריכת שורה שהועברה לא תאבד את הקטגוריה שלה בשקט.
  const CATEGORIES = ['מזון וכיבוד', 'ניקיון', 'ציוד משרדי', 'אירועים', 'תחזוקה',
    'נסיעות', 'ספרים', 'מתנות', 'כללית', 'עובד', 'אחר'];
  const STATUSES = ['שולם', 'ממתין להחזר'];
  const PENDING = 'ממתין להחזר';

  const state = { fund: null, funds: [], rows: [], q: '', from: '', to: '', onlyPending: false };
  const isAdmin = () => ((window.currentUser || {}).role === 'מנהל');
  const canEdit = () => !window.Auth || !window.Auth.isReadonly();

  // ── נתונים ────────────────────────────────────────────────────────────
  async function loadFunds() {
    const f = await window.store.list('petty_funds');
    return (f || []).filter(x => x.active !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.id - b.id);
  }
  async function loadRows(fundId) {
    const all = await window.store.list('petty_entries');
    return (all || []).filter(r => String(r.fund_id) === String(fundId))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
  }

  // ── חישוב היתרות ──────────────────────────────────────────────────────
  function totals(rows, fund) {
    const opening = Number((fund || {}).opening) || 0;
    let income = 0, paid = 0, pending = 0;
    rows.forEach(r => {
      const a = Number(r.amount) || 0;
      if (r.kind === 'income') income += a;
      else if (r.status === PENDING) pending += a;
      else paid += a;
    });
    return {
      opening: opening, income: income, paid: paid, pending: pending,
      cash: opening + income - paid,          // מה שבאמת יש בקופה עכשיו
      net: opening + income - paid - pending, // אחרי שכל ההחזרים ישולמו
      spend: paid + pending,
    };
  }

  // ── מסך ───────────────────────────────────────────────────────────────
  async function render(page) {
    state.funds = await loadFunds();
    if (!state.funds.length) {
      page.innerHTML = head() +
        '<div class="empty-state"><i class="bi bi-wallet2"></i><div>לא הוגדרה אף קופה קטנה</div></div>';
      wireHead(page);
      return;
    }
    if (!state.fund || !state.funds.some(f => f.id === state.fund)) state.fund = state.funds[0].id;
    await draw(page);
  }

  function head() {
    return '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
      '<h2>קופה קטנה</h2>' +
      '<div class="head-actions">' +
        (isAdmin() ? '<button class="btn-ghost sm" id="pcFunds"><i class="bi bi-gear"></i> ניהול קופות</button>' : '') +
        '<button class="btn-ghost sm" id="pcCsv"><i class="bi bi-download"></i> ייצוא לאקסל</button>' +
      '</div></div>';
  }

  async function draw(page) {
    const fund = state.funds.find(f => f.id === state.fund) || {};
    state.rows = await loadRows(state.fund);
    const t = totals(state.rows, fund);

    page.innerHTML = head() +
      // לשוניות הקופות — כל אחת עולם בפני עצמו
      '<div class="toolbar" style="gap:8px">' +
        '<div class="pc-tabs">' + state.funds.map(f =>
          '<button class="pc-tab' + (f.id === state.fund ? ' on' : '') + '" data-fund="' + f.id + '"' +
          (f.color ? ' style="--fc:' + esc(f.color) + '"' : '') + '>' +
          '<i class="bi bi-wallet2"></i> ' + esc(f.name) + '</button>').join('') +
        '</div>' +
      '</div>' +
      '<div class="demo-note" style="margin:0 2px 12px"><i class="bi bi-info-circle"></i> ' +
        'הקופות נפרדות לחלוטין — כל המספרים כאן הם של <b>' + esc(fund.name || '') + '</b> בלבד.' +
        (fund.drive_folder ? ' החשבוניות נשמרות בתיקיית הדרייב של הקופה.' : ' <b>לא הוגדרה תיקיית חשבוניות בדרייב.</b>') +
      '</div>' +

      '<div class="stat-row">' +
        statCard('bi-cash-stack', ILS(t.cash), 'יתרת מזומן בקופה', 'var(--primary)', '#fff') +
        statCard('bi-arrow-counterclockwise', ILS(t.pending), 'חוב לצוות (ממתין להחזר)', t.pending ? '#b45309' : '', t.pending ? '#fff' : '') +
        statCard('bi-calculator', ILS(t.net), 'יתרה נטו') +
        statCard('bi-plus-circle', ILS(t.income), 'הכנסות') +
        statCard('bi-dash-circle', ILS(t.spend), 'הוצאות') +
      '</div>' +

      (canEdit() ? '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-plus-lg"></i> רישום חדש</h3>' +
        '<div style="display:flex;gap:6px">' +
        '<button class="btn-primary sm" id="pcAddExp"><i class="bi bi-dash-circle"></i> הוצאה</button>' +
        '<button class="btn-ghost sm" id="pcAddInc"><i class="bi bi-plus-circle"></i> הכנסה</button>' +
        '</div></div></div>' : '') +

      '<div class="toolbar">' +
        '<input type="search" class="inp mb0" id="pcQ" placeholder="🔍 ספק / קטגוריה / מי קנה…" value="' + esc(state.q) + '">' +
        '<input type="date" class="inp mb0" id="pcFrom" value="' + esc(state.from) + '" title="מתאריך">' +
        '<input type="date" class="inp mb0" id="pcTo" value="' + esc(state.to) + '" title="עד תאריך">' +
        '<label class="cb" style="white-space:nowrap"><input type="checkbox" id="pcPend"' + (state.onlyPending ? ' checked' : '') + '> רק ממתין להחזר</label>' +
      '</div>' +
      '<div class="count-line" id="pcCount"></div>' +
      '<div class="table-wrap" id="pcWrap"></div>' +
      '<div id="pcEmpty" class="empty-state" hidden><i class="bi bi-receipt"></i><div>אין רישומים בקופה הזו</div></div>';

    wireHead(page);
    page.querySelectorAll('.pc-tab').forEach(b => b.addEventListener('click', async () => {
      state.fund = Number(b.dataset.fund); await draw(page);
    }));
    if (canEdit()) {
      page.querySelector('#pcAddExp').addEventListener('click', () => form(page, null, 'expense'));
      page.querySelector('#pcAddInc').addEventListener('click', () => form(page, null, 'income'));
    }
    ['#pcQ', '#pcFrom', '#pcTo', '#pcPend'].forEach(sel => {
      const el = page.querySelector(sel);
      const upd = () => {
        state.q = page.querySelector('#pcQ').value;
        state.from = page.querySelector('#pcFrom').value;
        state.to = page.querySelector('#pcTo').value;
        state.onlyPending = page.querySelector('#pcPend').checked;
        drawTable(page);
      };
      el.addEventListener('input', upd); el.addEventListener('change', upd);
    });
    drawTable(page);
  }

  function statCard(icon, num, lbl, bg, fg) {
    return '<div class="stat-card"' + (bg ? ' style="background:' + bg + ';color:' + (fg || '#fff') + '"' : '') + '>' +
      '<div class="stat-ic"><i class="bi ' + icon + '"></i></div>' +
      '<div class="stat-num">' + esc(num) + '</div>' +
      '<div class="stat-lbl"' + (bg ? ' style="color:rgba(255,255,255,.85)"' : '') + '>' + esc(lbl) + '</div></div>';
  }

  function wireHead(page) {
    const c = page.querySelector('#pcCsv'); if (c) c.addEventListener('click', () => exportCsv());
    const f = page.querySelector('#pcFunds'); if (f) f.addEventListener('click', () => fundsManager(page));
  }

  function visible() {
    const q = (state.q || '').trim();
    return state.rows.filter(r => {
      if (state.from && String(r.date) < state.from) return false;
      if (state.to && String(r.date) > state.to) return false;
      if (state.onlyPending && r.status !== PENDING) return false;
      if (q && ![r.party, r.category, r.buyer, r.note, r.method].join(' ').includes(q)) return false;
      return true;
    });
  }

  function drawTable(page) {
    const list = visible();
    const rowHtml = r => {
      const isExp = r.kind !== 'income';
      const pend = isExp && r.status === PENDING;
      return '<tr' + (pend ? ' class="pc-pending"' : '') + '>' +
        '<td>' + esc(dmy(r.date)) + '</td>' +
        '<td><span class="chip ' + (isExp ? 'off' : 'ok') + '">' + (isExp ? 'הוצאה' : 'הכנסה') + '</span></td>' +
        '<td><b>' + esc(r.party || '—') + '</b></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.buyer || '—') + '</td>' +
        '<td class="pc-amt' + (isExp ? ' neg' : ' pos') + '">' + (isExp ? '−' : '+') + esc(ILS(r.amount)) + '</td>' +
        '<td>' + esc(r.method || '—') + '</td>' +
        '<td>' + (isExp ? '<span class="chip ' + (pend ? 'off' : 'ok') + '">' + esc(r.status || 'שולם') + '</span>' : '—') + '</td>' +
        '<td>' + (r.receipt_id
          ? '<button class="mini" data-rc="' + r.id + '" title="' + esc(r.receipt_name || 'חשבונית') + '"><i class="bi bi-receipt"></i></button>'
          : (canEdit() ? '<button class="mini" data-up="' + r.id + '" title="העלה חשבונית"><i class="bi bi-upload"></i></button>'
                       : '<span class="au-none">—</span>')) + '</td>' +
        '<td>' + esc(r.note || '') + '</td>' +
        (canEdit() ? '<td class="row-act">' +
          '<button class="mini" data-edit="' + r.id + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
          '<button class="mini danger" data-del="' + r.id + '" title="מחיקה"><i class="bi bi-trash"></i></button></td>' : '<td></td>') +
        '</tr>';
    };
    const head = ['תאריך', 'סוג', 'ספק / מקור', 'קטגוריה', 'מי קנה', 'סכום', 'אמצעי', 'סטטוס', 'חשבונית', 'הערה', ''];
    page.querySelector('#pcWrap').innerHTML = list.length
      ? '<table class="tbl"><thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
        list.map(rowHtml).join('') + '</tbody></table>'
      : '';
    page.querySelector('#pcEmpty').hidden = list.length > 0;

    const sub = totals(list, { opening: 0 });
    const noReceipt = list.filter(r => r.kind !== 'income' && !r.receipt_id).length;
    page.querySelector('#pcCount').innerHTML =
      list.length + ' רישומים · הכנסות ' + esc(ILS(sub.income)) + ' · הוצאות ' + esc(ILS(sub.spend)) +
      (sub.pending ? ' · <b style="color:#b45309">ממתין להחזר ' + esc(ILS(sub.pending)) + '</b>' : '') +
      (noReceipt ? ' · <b style="color:#b91c1c">' + noReceipt + ' ללא חשבונית</b>' : '');

    page.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () =>
      form(page, state.rows.find(r => r.id == b.dataset.edit))));
    page.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      const r = state.rows.find(x => x.id == b.dataset.del); if (!r) return;
      if (!(await window.UI.confirm('למחוק את הרישום על ' + esc(ILS(r.amount)) + '? החשבונית בדרייב תישאר.'))) return;
      const res = await window.store.remove('petty_entries', r.id);
      if (!res || res.ok === false) { window.UI.toast('המחיקה נכשלה', 'err'); return; }
      window.UI.toast('נמחק'); await draw(page);
    }));
    page.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () =>
      uploadReceipt(page, state.rows.find(r => r.id == b.dataset.up))));
    page.querySelectorAll('[data-rc]').forEach(b => b.addEventListener('click', () =>
      openReceipt(page, state.rows.find(r => r.id == b.dataset.rc))));
  }

  // ── טופס רישום / עריכה ────────────────────────────────────────────────
  function form(page, rec, kindDefault) {
    const r = rec || {};
    const kind = r.kind || kindDefault || 'expense';
    const isExp = kind !== 'income';
    const opts = (arr, cur) => arr.map(o => '<option' + (String(cur) === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
    const mm = window.UI.modal({
      title: (rec ? 'עריכת ' : '') + (isExp ? 'הוצאה' : 'הכנסה') + ' — ' + esc((state.funds.find(f => f.id === state.fund) || {}).name || ''),
      saveLabel: 'שמירה',
      bodyHTML: '<div class="form-grid">' +
        // העברה בין קופות: הרישום נרשם בקופה הלא נכונה, וזה קורה. הבורר כאן
        // מזיז גם את השורה וגם את קובץ החשבונית שלה בדרייב — ראה onSave.
        '<label class="fld"><span>קופה *</span><select class="inp mb0" id="pf_fund">' +
          state.funds.map(f => '<option value="' + f.id + '"' +
            (String(f.id) === String(r.fund_id || state.fund) ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('') +
        '</select></label>' +
        '<label class="fld"><span>תאריך *</span><input class="inp mb0" id="pf_date" type="date" value="' + esc(r.date || today()) + '"></label>' +
        '<label class="fld"><span>סכום ₪ *</span><input class="inp mb0" id="pf_amt" type="number" step="0.01" min="0" value="' + esc(r.amount == null ? '' : r.amount) + '"></label>' +
        '<label class="fld"><span>' + (isExp ? 'ספק / חנות *' : 'מקור ההכנסה *') + '</span><input class="inp mb0" id="pf_party" value="' + esc(r.party || '') + '"></label>' +
        (isExp
          ? '<label class="fld"><span>קטגוריה</span><select class="inp mb0" id="pf_cat"><option value="">—</option>' + opts(CATEGORIES, r.category) + '</select></label>' +
            '<label class="fld"><span>מי קנה</span><input class="inp mb0" id="pf_buyer" value="' + esc(r.buyer || '') + '" placeholder="שם הרב / איש הצוות"></label>' +
            '<label class="fld"><span>סטטוס</span><select class="inp mb0" id="pf_status">' + opts(STATUSES, r.status || 'שולם') + '</select></label>'
          : '<label class="fld"><span>מי הכניס</span><input class="inp mb0" id="pf_buyer" value="' + esc(r.buyer || '') + '"></label>') +
        '<label class="fld"><span>אמצעי תשלום</span><select class="inp mb0" id="pf_method"><option value="">—</option>' + opts(METHODS, r.method) + '</select></label>' +
        '<label class="fld fld-wide"><span>הערה</span><input class="inp mb0" id="pf_note" value="' + esc(r.note || '') + '"></label>' +
        (isExp ? '<div class="fld fld-wide"><span>חשבונית</span>' +
          '<div id="pf_rcbox" class="login-hint" style="margin:0">' +
          (r.receipt_id ? '<i class="bi bi-paperclip"></i> ' + esc(r.receipt_name || 'מצורפת')
                        : 'אפשר לצרף אחרי השמירה, בכפתור ההעלאה שבשורה.') + '</div></div>' : '') +
        '</div>',
      onSave: async (mel) => {
        const amount = Number(mel.querySelector('#pf_amt').value);
        const party = mel.querySelector('#pf_party').value.trim();
        if (!(amount > 0)) { window.UI.toast('סכום חייב להיות גדול מאפס', 'err'); return false; }
        if (!party) { window.UI.toast(isExp ? 'שם הספק חובה' : 'מקור ההכנסה חובה', 'err'); return false; }
        const toFund = Number(mel.querySelector('#pf_fund').value) || state.fund;
        const from = Number(r.fund_id || state.fund);
        // אם הרישום עובר קופה ויש לו חשבונית — מעבירים קודם את הקובץ בדרייב,
        // ורק אם זה הצליח שומרים. אחרת השורה תצביע על קובץ בתיקייה של הקופה
        // השנייה, וה-RLS יחסום אותה — החשבונית תיראה כאילו נעלמה.
        let moved = null;
        if (rec && toFund !== from && r.receipt_id) {
          try {
            const res = await fetch(driveUrl({ action: 'move', fundId: from, toFundId: toFund, fileId: r.receipt_id }), {
              method: 'POST', headers: await driveAuth(),
            });
            const d = await res.json();
            if (!d.ok) { window.UI.toast('העברת החשבונית נכשלה: ' + (d.error || ''), 'err'); return false; }
            moved = d.file;
          } catch (e) { window.UI.toast('העברת החשבונית נכשלה: ' + (e.message || e), 'err'); return false; }
        }
        const row = {
          fund_id: toFund, kind: kind,
          date: mel.querySelector('#pf_date').value || today(),
          amount: amount, party: party,
          category: isExp ? (mel.querySelector('#pf_cat').value || null) : null,
          buyer: mel.querySelector('#pf_buyer').value.trim() || null,
          method: mel.querySelector('#pf_method').value || null,
          status: isExp ? mel.querySelector('#pf_status').value : 'שולם',
          note: mel.querySelector('#pf_note').value.trim() || null,
        };
        if (moved) row.receipt_link = moved.webViewLink || null;
        const res = rec ? await window.store.update('petty_entries', rec.id, row)
                        : await window.store.add('petty_entries', row);
        if (!res || res.ok === false) { window.UI.toast('השמירה נכשלה: ' + ((res && res.error) || ''), 'err'); return false; }
        const fundName = f => (state.funds.find(x => x.id === f) || {}).name || '';
        window.UI.toast(toFund !== from
          ? 'הועבר לקופת ' + fundName(toFund)
          : (rec ? 'עודכן' : 'נשמר'));
        await draw(page);
        return true;
      },
    });
    return mm;
  }

  // ── חשבוניות: העלאה לתיקיית הדרייב של הקופה ───────────────────────────
  function driveUrl(params) {
    const c = window.CV3 || {};
    return c.SUPABASE_URL + '/functions/v1/drive?' + new URLSearchParams(params).toString();
  }
  async function driveAuth() {
    const { data } = await window.sb.auth.getSession();
    const tok = data && data.session && data.session.access_token;
    if (!tok) throw new Error('אין סשן פעיל');
    return { Authorization: 'Bearer ' + tok, apikey: (window.CV3 || {}).SUPABASE_ANON_KEY };
  }

  function uploadReceipt(page, r) {
    if (!r) return;
    const fund = state.funds.find(f => f.id === state.fund) || {};
    if (!fund.drive_folder) { window.UI.toast('לא הוגדרה תיקיית חשבוניות לקופה הזו', 'err'); return; }
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*,application/pdf';
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) { window.UI.toast('הקובץ גדול מ-15MB', 'err'); return; }
      // שם אחיד וממויין: תאריך_ספק_סכום — כך התיקייה בדרייב קריאה בלי המערכת
      const ext = (file.name.match(/\.[a-zA-Z0-9]+$/) || [''])[0] || '';
      const safe = String(r.party || 'ללא ספק').replace(/[\\/:*?"<>|]/g, '-').slice(0, 40);
      const name = r.date + '_' + safe + '_' + (Number(r.amount) || 0) + ext;
      window.UI.toast('מעלה חשבונית…');
      try {
        const res = await fetch(driveUrl({ action: 'upload', fundId: state.fund, folderId: fund.drive_folder, name: name }), {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': file.type || 'application/octet-stream' }, await driveAuth()),
          body: file,
        });
        const d = await res.json();
        if (!d.ok) { window.UI.toast(d.error || 'ההעלאה נכשלה', 'err'); return; }
        const upd = await window.store.update('petty_entries', r.id, {
          receipt_id: d.file.id, receipt_name: d.file.name, receipt_link: d.file.webViewLink || null,
        });
        if (!upd || upd.ok === false) { window.UI.toast('הקובץ עלה לדרייב אך הקישור לא נשמר', 'err'); return; }
        window.UI.toast('החשבונית נשמרה');
        await draw(page);
      } catch (e) { window.UI.toast('שגיאה בהעלאה: ' + (e.message || e), 'err'); }
    });
    inp.click();
  }

  async function openReceipt(page, r) {
    if (!r || !r.receipt_id) return;
    const mm = window.UI.modal({
      title: 'חשבונית — ' + esc(r.party || ''),
      bodyHTML: '<div id="rcBody" style="min-height:180px;display:flex;align-items:center;justify-content:center">' +
        '<span class="spin"><i class="bi bi-arrow-repeat"></i></span></div>' +
        '<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px">' +
        (r.receipt_link ? '<a class="btn-ghost sm" href="' + esc(r.receipt_link) + '" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-left"></i> פתח בדרייב</a>' : '') +
        '<button class="btn-ghost sm" id="rcDl"><i class="bi bi-download"></i> הורדה</button>' +
        (canEdit() ? '<button class="btn-ghost sm danger" id="rcDel"><i class="bi bi-trash"></i> הסר חשבונית</button>' : '') +
        '</div>',
    });
    let blobUrl = null, fileName = r.receipt_name || 'receipt';
    try {
      const res = await fetch(driveUrl({ action: 'preview', fundId: state.fund, fileId: r.receipt_id }), {
        method: 'POST', headers: await driveAuth(),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || 'טעינה נכשלה');
      // ⚠️ נטפרי חוסם גוף תגובה בינארי, ולכן הפונקציה מחזירה base64 ב-JSON
      // והדפדפן מרכיב Blob. אל תחליף לקישור ישיר.
      const bin = atob(d.dataB64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: d.mimeType || 'application/octet-stream' });
      blobUrl = URL.createObjectURL(blob); fileName = d.name || fileName;
      const body = mm.el.querySelector('#rcBody');
      body.innerHTML = String(d.mimeType || '').startsWith('image/')
        ? '<img src="' + blobUrl + '" style="max-width:100%;max-height:60vh;border-radius:8px">'
        : '<iframe src="' + blobUrl + '" style="width:100%;height:60vh;border:0;border-radius:8px"></iframe>';
    } catch (e) {
      mm.el.querySelector('#rcBody').innerHTML =
        '<div class="empty-state" style="padding:10px"><i class="bi bi-exclamation-triangle"></i><div>' +
        esc(e.message || 'לא ניתן להציג') + '</div></div>';
    }
    const dl = mm.el.querySelector('#rcDl');
    if (dl) dl.addEventListener('click', () => {
      if (!blobUrl) { window.UI.toast('הקובץ לא נטען', 'err'); return; }
      const a = document.createElement('a'); a.href = blobUrl; a.download = fileName; a.click();
    });
    const del = mm.el.querySelector('#rcDel');
    if (del) del.addEventListener('click', async () => {
      if (!(await window.UI.confirm('להסיר את החשבונית? הקובץ יעבור לפח האשפה של הדרייב.'))) return;
      try {
        const res = await fetch(driveUrl({ action: 'delete', fundId: state.fund, fileId: r.receipt_id }), {
          method: 'POST', headers: await driveAuth(),
        });
        const d = await res.json();
        if (!d.ok) { window.UI.toast(d.error || 'המחיקה נכשלה', 'err'); return; }
      } catch (e) { window.UI.toast('שגיאה: ' + (e.message || e), 'err'); return; }
      await window.store.update('petty_entries', r.id, { receipt_id: null, receipt_name: null, receipt_link: null });
      window.UI.toast('החשבונית הוסרה');
      mm.close(); await draw(page);
    });
  }

  // ── ניהול הקופות (מנהל) ───────────────────────────────────────────────
  function fundsManager(page) {
    const list = () => state.funds.map(f =>
      '<div class="tl-item"><span class="sev-dot ' + (f.drive_folder ? 'lo' : 'hi') + '"></span>' +
      '<div class="tl-main"><strong>' + esc(f.name) + '</strong>' +
      (f.opening ? ' <span class="tl-note">פתיחה ' + esc(ILS(f.opening)) + '</span>' : '') +
      '<div class="tl-note" style="font-size:.78rem">' +
        (f.drive_folder ? 'תיקיית חשבוניות: ' + esc(f.drive_folder) : 'אין תיקיית חשבוניות — לא ניתן להעלות') +
      '</div></div>' +
      '<button class="mini" data-fedit="' + f.id + '" title="עריכה"><i class="bi bi-pencil"></i></button></div>').join('');
    const mm = window.UI.modal({
      title: 'ניהול קופות',
      bodyHTML: '<p class="login-hint" style="margin:0 0 10px">כל קופה היא עולם נפרד — יתרה, רישומים ותיקיית ' +
        'חשבוניות משלה. אין שום סיכום שחוצה קופות.</p>' +
        '<div id="fmList">' + list() + '</div>' +
        '<div class="qr-grid" style="grid-template-columns:1fr auto;margin-top:12px">' +
        '<input class="inp mb0" id="fmNew" placeholder="שם קופה חדשה">' +
        '<button class="btn-primary sm" id="fmAdd"><i class="bi bi-plus-lg"></i> הוסף</button></div>',
    });
    const refresh = async () => {
      state.funds = await loadFunds();
      mm.el.querySelector('#fmList').innerHTML = list();
      wireRows();
    };
    function wireRows() {
      mm.el.querySelectorAll('[data-fedit]').forEach(b => b.addEventListener('click', () => {
        const f = state.funds.find(x => x.id == b.dataset.fedit); if (!f) return;
        window.UI.modal({
          title: 'עריכת קופה — ' + esc(f.name), saveLabel: 'שמירה',
          bodyHTML: '<div class="form-grid">' +
            '<label class="fld"><span>שם *</span><input class="inp mb0" id="fe_name" value="' + esc(f.name) + '"></label>' +
            '<label class="fld"><span>יתרת פתיחה ₪</span><input class="inp mb0" id="fe_open" type="number" step="0.01" value="' + esc(f.opening || 0) + '"></label>' +
            '<label class="fld"><span>צבע</span><input class="inp mb0" id="fe_color" type="color" value="' + esc(f.color || '#003048') + '"></label>' +
            '<label class="fld"><span>פעילה</span><select class="inp mb0" id="fe_active"><option value="1"' + (f.active !== false ? ' selected' : '') + '>כן</option><option value="0"' + (f.active === false ? ' selected' : '') + '>לא</option></select></label>' +
            '<label class="fld fld-wide"><span>מזהה תיקיית החשבוניות בדרייב</span>' +
              '<input class="inp mb0" id="fe_folder" value="' + esc(f.drive_folder || '') + '" placeholder="1AbC…"></label>' +
            '<div class="fld fld-wide"><span class="login-hint" style="margin:0">התיקייה חייבת להיות בדרייב של חשבון המכינה ' +
              '(6787012) או משותפת לו כעורך — אחרת ההעלאה תיכשל.</span></div>' +
            '</div>',
          onSave: async (mel) => {
            const name = mel.querySelector('#fe_name').value.trim();
            if (!name) { window.UI.toast('שם חובה', 'err'); return false; }
            const res = await window.store.update('petty_funds', f.id, {
              name: name,
              opening: Number(mel.querySelector('#fe_open').value) || 0,
              color: mel.querySelector('#fe_color').value,
              active: mel.querySelector('#fe_active').value === '1',
              drive_folder: mel.querySelector('#fe_folder').value.trim() || null,
            });
            if (!res || res.ok === false) { window.UI.toast('העדכון נכשל', 'err'); return false; }
            window.UI.toast('נשמר');
            await refresh(); await draw(page);
            return true;
          },
        });
      }));
    }
    wireRows();
    mm.el.querySelector('#fmAdd').addEventListener('click', async () => {
      const name = mm.el.querySelector('#fmNew').value.trim();
      if (!name) return;
      const res = await window.store.add('petty_funds', { name: name, sort: state.funds.length + 1, color: '#475569' });
      if (!res || res.ok === false) { window.UI.toast('ההוספה נכשלה', 'err'); return; }
      mm.el.querySelector('#fmNew').value = '';
      window.UI.toast('נוספה קופה — הגדר לה תיקיית חשבוניות');
      await refresh(); await draw(page);
    });
  }

  // ── ייצוא ─────────────────────────────────────────────────────────────
  function exportCsv() {
    const fund = state.funds.find(f => f.id === state.fund) || {};
    const list = visible();
    const t = totals(list, { opening: 0 });
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [
      ['קופה קטנה — ' + (fund.name || '')],
      ['הופק', dmy(today())],
      [],
      ['תאריך', 'סוג', 'ספק / מקור', 'קטגוריה', 'מי קנה', 'סכום', 'אמצעי', 'סטטוס', 'חשבונית', 'הערה'],
    ];
    list.forEach(r => rows.push([dmy(r.date), r.kind === 'income' ? 'הכנסה' : 'הוצאה', r.party, r.category,
      r.buyer, r.amount, r.method, r.kind === 'income' ? '' : (r.status || 'שולם'),
      r.receipt_name || '', r.note]));
    rows.push([]);
    rows.push(['הכנסות', t.income]);
    rows.push(['הוצאות ששולמו', t.paid]);
    rows.push(['ממתין להחזר', t.pending]);
    rows.push(['יתרת פתיחה', Number(fund.opening) || 0]);
    rows.push(['יתרת מזומן בקופה', (Number(fund.opening) || 0) + t.income - t.paid]);
    rows.push(['יתרה נטו', (Number(fund.opening) || 0) + t.income - t.paid - t.pending]);
    const blob = new Blob([String.fromCharCode(0xFEFF) + rows.map(r => r.map(q).join(',')).join('\n')],
      { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'קופה קטנה — ' + (fund.name || '') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  }

  // ── עיצוב ─────────────────────────────────────────────────────────────
  function style() {
    if (document.getElementById('pcStyle')) return;
    const st = document.createElement('style');
    st.id = 'pcStyle';
    st.textContent =
      '.pc-tabs{display:flex;gap:8px;flex-wrap:wrap}' +
      '.pc-tab{--fc:var(--primary);display:inline-flex;align-items:center;gap:7px;padding:9px 18px;' +
        'border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;' +
        'font-family:inherit;font-size:.92rem;font-weight:800;cursor:pointer;transition:all .12s}' +
      '.pc-tab:hover{border-color:var(--fc)}' +
      '.pc-tab.on{background:var(--fc);color:#fff;border-color:var(--fc);box-shadow:0 3px 10px rgba(0,0,0,.14)}' +
      '.pc-amt{font-weight:800;white-space:nowrap}' +
      '.pc-amt.neg{color:#b91c1c}.pc-amt.pos{color:#15803d}' +
      'tr.pc-pending td{background:color-mix(in srgb,#f59e0b 12%,transparent)}' +
      '.mini.danger{color:#b91c1c}';
    document.head.appendChild(st);
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.pettycash = async function (page) { style(); await render(page); };
})();
