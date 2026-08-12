// cashbox.js — קופה כללית (בקשת עמנואל). מרכזת: גביית שכר-לימוד (אוטומטי) + הכנסות נוספות + הוצאות.
// מחשבת יתרה חיה. נתונים דרך המאגר המרכזי (store.js). ייצוא לאקסל (CSV).
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const ILS = n => '₪' + (Number(n) || 0).toLocaleString('he-IL');
  const METHODS = ['מזומן', 'העברה', 'בית ספר', 'נדרים פלוס'];

  async function render(page) {
    const [tuition, income, expenses, studs] = await Promise.all([
      window.store.list('tuition'), window.store.list('income'), window.store.list('expenses'),
      window.cv3Students ? window.cv3Students.getStudents() : [],
    ]);
    const nameOf = id => { const s = studs.find(x => x.id == id); return s ? s.name : '—'; };
    const methodOpts = METHODS.map(m => '<option>' + m + '</option>').join('');

    // גביית שכר-לימוד ששולם → נכנסת אוטומטית לקופה
    const tuitionPaid = tuition.filter(t => t.status === 'paid');
    const tuitionSum = tuitionPaid.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const incomeSum = income.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const expenseSum = expenses.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const balance = tuitionSum + incomeSum - expenseSum;

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>קופה כללית</h2>' +
      '<div class="head-actions"><button class="btn-ghost sm" id="cbCsv"><i class="bi bi-download"></i> ייצוא לאקסל</button></div></div>' +
      '<div class="stat-row">' +
        '<div class="stat-card"><div class="stat-ic"><i class="bi bi-cash-stack"></i></div><div class="stat-num">' + ILS(tuitionSum) + '</div><div class="stat-lbl">גביית שכר לימוד</div></div>' +
        '<div class="stat-card"><div class="stat-ic"><i class="bi bi-plus-circle"></i></div><div class="stat-num">' + ILS(incomeSum) + '</div><div class="stat-lbl">הכנסות נוספות</div></div>' +
        '<div class="stat-card"><div class="stat-ic"><i class="bi bi-dash-circle"></i></div><div class="stat-num">' + ILS(expenseSum) + '</div><div class="stat-lbl">הוצאות</div></div>' +
        '<div class="stat-card" style="background:var(--primary);color:#fff"><div class="stat-ic"><i class="bi bi-wallet2"></i></div><div class="stat-num">' + ILS(balance) + '</div><div class="stat-lbl" style="color:#e8f5ee">יתרת הקופה</div></div>' +
      '</div>' +

      // הכנסות נוספות
      '<div class="qr-card"><h3><i class="bi bi-plus-circle"></i> הכנסה נוספת</h3><div class="qr-grid" style="grid-template-columns:auto 1.4fr .9fr 1fr auto">' +
        '<input class="inp mb0" id="inDate" type="date" value="' + today() + '">' +
        '<input class="inp mb0" id="inSrc" placeholder="מקור (מלגה / תרומה / העברה מגורם אחר)">' +
        '<input class="inp mb0" id="inAmt" type="number" placeholder="סכום ₪">' +
        '<select class="inp mb0" id="inMethod"><option value="">אמצעי…</option>' + methodOpts + '</select>' +
        '<button class="btn-primary sm" id="inSave"><i class="bi bi-plus-lg"></i> הוסף</button>' +
        '<input class="inp mb0 fld-wide" id="inNote" placeholder="הערה (רשות)" style="grid-column:1/-1">' +
      '</div><div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>תאריך</th><th>מקור</th><th>סכום</th><th>אמצעי</th><th>הערה</th><th></th></tr></thead><tbody id="inBody"></tbody></table></div></div>' +

      // הוצאות
      '<div class="qr-card"><h3><i class="bi bi-dash-circle"></i> הוצאה (עובד / כללית)</h3><div class="qr-grid" style="grid-template-columns:auto 1.3fr .9fr auto auto auto .9fr auto">' +
        '<input class="inp mb0" id="exDate" type="date" value="' + today() + '">' +
        '<input class="inp mb0" id="exName" placeholder="שם *">' +
        '<input class="inp mb0" id="exTz" placeholder="ת״ז (רשות)">' +
        '<select class="inp mb0" id="exKind"><option>עובד</option><option>כללית</option></select>' +
        '<select class="inp mb0" id="exMethod"><option value="">אמצעי…</option>' + methodOpts + '</select>' +
        '<select class="inp mb0" id="exSlip"><option>ללא תלוש</option><option>עם תלוש</option></select>' +
        '<input class="inp mb0" id="exAmt" type="number" placeholder="סכום ₪">' +
        '<button class="btn-primary sm" id="exSave"><i class="bi bi-plus-lg"></i> הוסף</button>' +
        '<input class="inp mb0 fld-wide" id="exNote" placeholder="הערה (רשות)" style="grid-column:1/-1">' +
      '</div><div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>תאריך</th><th>שם</th><th>ת״ז</th><th>סוג</th><th>אמצעי</th><th>תלוש</th><th>סכום</th><th>הערה</th><th></th></tr></thead><tbody id="exBody"></tbody></table></div></div>' +

      // פירוט גביית שכר לימוד (אוטומטי, לקריאה)
      '<div class="qr-card"><h3><i class="bi bi-cash-stack"></i> גביית שכר לימוד (אוטומטי) <span class="det-badge">' + tuitionPaid.length + '</span></h3><div class="table-wrap"><table class="tbl"><thead><tr><th>תלמיד</th><th>חודש</th><th>תאריך</th><th>סכום</th><th>אמצעי</th></tr></thead><tbody>' +
        (tuitionPaid.length ? tuitionPaid.map(t => '<tr><td>' + esc(nameOf(t.student_id)) + '</td><td>' + esc(t.month || '') + '</td><td>' + esc(t.pay_date || '') + '</td><td>' + ILS(t.amount) + '</td><td>' + esc(t.method || '') + '</td></tr>').join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:16px">אין תשלומים ששולמו עדיין</td></tr>') +
      '</tbody></table></div></div>';

    function drawIn() {
      page.querySelector('#inBody').innerHTML = income.slice().reverse().map(r =>
        '<tr><td>' + esc(r.date || '') + '</td><td>' + esc(r.source || '') + '</td><td>' + ILS(r.amount) + '</td><td>' + esc(r.method || '') + '</td><td>' + esc(r.note || '') + '</td>' +
        '<td class="row-act"><button class="mini danger" data-delin="' + r.id + '"><i class="bi bi-trash"></i></button></td></tr>').join('') ||
        '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:14px">אין הכנסות נוספות</td></tr>';
      page.querySelectorAll('[data-delin]').forEach(b => b.addEventListener('click', async () => { await window.store.remove('income', Number(b.dataset.delin)); const i = income.findIndex(x => x.id == b.dataset.delin); if (i >= 0) income.splice(i, 1); render(page); }));
    }
    function drawEx() {
      page.querySelector('#exBody').innerHTML = expenses.slice().reverse().map(r =>
        '<tr><td>' + esc(r.date || '') + '</td><td>' + esc(r.name || '') + '</td><td>' + esc(r.tz || '') + '</td><td>' + esc(r.kind || '') + '</td><td>' + esc(r.method || '') + '</td><td>' + esc(r.payslip || '') + '</td><td>' + ILS(r.amount) + '</td><td>' + esc(r.note || '') + '</td>' +
        '<td class="row-act"><button class="mini danger" data-delex="' + r.id + '"><i class="bi bi-trash"></i></button></td></tr>').join('') ||
        '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:14px">אין הוצאות</td></tr>';
      page.querySelectorAll('[data-delex]').forEach(b => b.addEventListener('click', async () => { await window.store.remove('expenses', Number(b.dataset.delex)); const i = expenses.findIndex(x => x.id == b.dataset.delex); if (i >= 0) expenses.splice(i, 1); render(page); }));
    }
    page.querySelector('#inSave').addEventListener('click', async () => {
      const amt = page.querySelector('#inAmt').value; const src = page.querySelector('#inSrc').value.trim();
      if (!amt) { window.UI.toast('נא להזין סכום', 'err'); return; }
      const row = { date: page.querySelector('#inDate').value, source: src, amount: amt, method: page.querySelector('#inMethod').value, note: page.querySelector('#inNote').value.trim() };
      const r = await window.store.add('income', row); income.push((r.data && r.data[0]) || row); render(page); window.UI.toast('הכנסה נוספה');
    });
    page.querySelector('#exSave').addEventListener('click', async () => {
      const name = page.querySelector('#exName').value.trim();
      if (!name) { window.UI.toast('נא להזין שם', 'err'); return; }   // רק שם חובה
      const row = { date: page.querySelector('#exDate').value, name, tz: page.querySelector('#exTz').value.trim(), kind: page.querySelector('#exKind').value, method: page.querySelector('#exMethod').value, payslip: page.querySelector('#exSlip').value, amount: page.querySelector('#exAmt').value, note: page.querySelector('#exNote').value.trim() };
      const r = await window.store.add('expenses', row); expenses.push((r.data && r.data[0]) || row); render(page); window.UI.toast('הוצאה נוספה');
    });
    page.querySelector('#cbCsv').addEventListener('click', () => {
      const lines = ['סוג,תאריך,פרטים,אמצעי,נוסף,סכום,הערה'];
      tuitionPaid.forEach(t => lines.push(['גביית שכר לימוד', t.pay_date || t.month, nameOf(t.student_id), t.method, '', t.amount, t.note || ''].map(csv).join(',')));
      income.forEach(r => lines.push(['הכנסה נוספת', r.date, r.source, r.method, '', r.amount, r.note || ''].map(csv).join(',')));
      expenses.forEach(r => lines.push(['הוצאה', r.date, r.name + (r.tz ? ' (' + r.tz + ')' : ''), r.method, r.kind + '/' + r.payslip, '-' + r.amount, r.note || ''].map(csv).join(',')));
      lines.push(csv('יתרה') + ',,,,,,' + balance);
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kupa.csv'; a.click();
    });
    function csv(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    drawIn(); drawEx();
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.cashbox = render;
})();
