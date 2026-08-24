// books.js — הזמנת ספרים (תשפ"ז).
//
// למה מסך נפרד ולא עוד לשונית ב"תלמידים": ההזמנה היא מטריצה של תלמיד × ספר,
// והשאלה המעשית ("כמה גמרות בבא מציעא להזמין ממעוז והדר?") היא סכום לפי ספר,
// לא לפי תלמיד. לכן טבלה אחת לכל שיעור, וסיכום הזמנה לספק בראש המסך.
//
// מקור הנתונים: מיילי "רשימת ספרים" שנשלחו להורים ב-10/07/2026.
// שם נכתב שהמכינה מזמינה הזמנה מרוכזת לכולם והגבייה בתחילת השנה — ולכן
// ברירת המחדל של כל תלמיד היא "מזמין דרך המכינה". השדה `source` מבדיל בין
// אישור אמיתי שהתקבל במייל לבין ברירת המחדל המוסדית; אל תמחק את ההבחנה הזאת,
// היא כל ההבדל בין "ההורים אישרו" לבין "הנחנו".
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s && s.name) || '';

  const ST = [
    { k: 'order',    t: 'מזמין דרך המכינה', short: 'מזמין',   cls: 'bk-order' },
    { k: 'home',     t: 'מביא מהבית',       short: 'מהבית',   cls: 'bk-home' },
    { k: 'lastyear', t: 'יש משנה שעברה',    short: 'משנה שעברה', cls: 'bk-last' },
    { k: 'na',       t: 'לא רלוונטי',       short: 'לא רלוונטי', cls: 'bk-na' },
    { k: 'unknown',  t: 'טרם נקבע',         short: 'טרם נקבע', cls: 'bk-unk' },
  ];
  const stOf = k => ST.find(s => s.k === k) || ST[4];

  function style() {
    if (document.getElementById('bkStyle')) return;
    const s = document.createElement('style'); s.id = 'bkStyle';
    s.textContent =
      '.bk-sec{margin:0 0 26px}' +
      '.bk-sec h3{display:flex;align-items:center;gap:10px;margin:0 0 8px;font-size:1.05rem}' +
      '.bk-price{font-weight:400;font-size:.85rem;color:var(--muted,#6b7280)}' +
      '.bk-tbl{width:100%;border-collapse:collapse;font-size:.9rem}' +
      '.bk-tbl th,.bk-tbl td{border:1px solid var(--line,#e5e7eb);padding:5px 7px;text-align:right;vertical-align:middle}' +
      '.bk-tbl thead th{background:var(--primary,#003048);color:#fff;font-weight:600;font-size:.82rem;line-height:1.25}' +
      '.bk-tbl thead th small{display:block;font-weight:400;opacity:.75;font-size:.72rem}' +
      '.bk-tbl tbody tr:nth-child(even){background:rgba(0,0,0,.02)}' +
      '.bk-tbl td.bk-nm{white-space:nowrap;font-weight:600}' +
      '.bk-tbl select{font:inherit;font-size:.82rem;padding:2px 4px;border:1px solid var(--line,#d1d5db);' +
      'border-radius:6px;background:var(--card,#fff);color:inherit;width:100%}' +
      '.bk-order{background:#e8f5ee}.bk-home{background:#fff7e6}.bk-last{background:#eef2ff}' +
      '.bk-na{background:#f3f4f6}.bk-unk{background:#fdeaea}' +
      '.bk-src{font-size:.7rem;color:var(--muted,#6b7280);white-space:nowrap}' +
      '.bk-src.mail{color:#1f8a5b;font-weight:600}' +
      '.bk-sum{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}' +
      '.bk-card{flex:1 1 190px;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px 12px;background:var(--card,#fff)}' +
      '.bk-card b{display:block;font-size:1.35rem;line-height:1.1}' +
      '.bk-card span{font-size:.8rem;color:var(--muted,#6b7280)}' +
      '.bk-foot td{background:#f8fafc;font-weight:600}' +
      '@media print{.page-head,.toolbar,.bk-noprint{display:none!important}.bk-tbl{font-size:.72rem}}';
    document.head.appendChild(s);
  }

  async function render(page) {
    style();
    const [studs, classes, books, orders, packs] = await Promise.all([
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
      window.store.list('classes'),
      window.store.list('books'),
      window.store.list('book_orders'),
      window.store.list('book_packages'),
    ]);

    const YEAR = 'תשפ"ז';
    const bookList = (books || []).filter(b => b.year === YEAR && b.active !== false)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const ordMap = {};
    (orders || []).forEach(o => { ordMap[o.student_id + ':' + o.book_id] = o; });

    const classesWithBooks = (classes || [])
      .filter(c => bookList.some(b => b.class_id == c.id))
      .sort((a, b) => a.id - b.id);

    const priceOf = cid => {
      const p = (packs || []).find(x => x.class_id == cid && x.year === YEAR);
      return p ? Number(p.price) || 0 : 0;
    };

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
      '<h2>הזמנת ספרים — ' + esc(YEAR) + '</h2>' +
      '<div class="head-actions">' +
        '<button class="btn-primary sm" id="bkSupplier"><i class="bi bi-box-seam"></i> סיכום הזמנה לספק</button>' +
        '<button class="btn-ghost sm" id="bkCsv"><i class="bi bi-download"></i> ייצוא CSV</button>' +
        '<button class="btn-ghost sm" id="bkPrint"><i class="bi bi-printer"></i> הדפסה</button>' +
      '</div></div>' +
      '<div class="demo-note bk-noprint" style="margin:0 2px 12px"><i class="bi bi-info-circle"></i> ' +
        'הרשימות נלקחו מהמיילים שנשלחו להורים ב-10/07/2026. ברירת המחדל היא הזמנה מרוכזת דרך המכינה; ' +
        'שורה שמסומנת <b>אישור במייל</b> היא תשובה מפורשת של ההורים.</div>' +
      '<div class="bk-sum" id="bkSum"></div>' +
      '<div class="toolbar bk-noprint">' +
        '<input type="search" class="inp mb0" id="bkQ" placeholder="חיפוש תלמיד…">' +
        '<select class="inp mb0" id="bkCls"><option value="">כל השיעורים</option>' +
          classesWithBooks.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') +
        '</select>' +
        '<select class="inp mb0" id="bkSt"><option value="">כל הסטטוסים</option>' +
          ST.map(s => '<option value="' + s.k + '">' + esc(s.t) + '</option>').join('') +
        '</select>' +
      '</div>' +
      '<div id="bkBody"></div>';

    const q = () => (page.querySelector('#bkQ').value || '').trim();
    const fCls = () => page.querySelector('#bkCls').value;
    const fSt = () => page.querySelector('#bkSt').value;

    function studentsOf(cid) {
      return (studs || [])
        .filter(s => s.class_id == cid)
        .filter(s => !q() || nm(s).includes(q()) || (s.family || '').includes(q()))
        .filter(s => {
          if (!fSt()) return true;
          return bookList.filter(b => b.class_id == cid)
            .some(b => (ordMap[s.id + ':' + b.id] || {}).status === fSt() ||
                       (!ordMap[s.id + ':' + b.id] && fSt() === 'unknown'));
        })
        .sort((a, b) => nm(a).localeCompare(nm(b), 'he'));
    }

    function drawSummary() {
      const counts = { order: 0, home: 0, lastyear: 0, na: 0, unknown: 0 };
      let money = 0, confirmed = 0;
      classesWithBooks.forEach(c => {
        const bs = bookList.filter(b => b.class_id == c.id);
        (studs || []).filter(s => s.class_id == c.id).forEach(s => {
          let anyOrder = false, mail = false;
          bs.forEach(b => {
            const o = ordMap[s.id + ':' + b.id];
            const k = o ? o.status : 'unknown';
            counts[k] = (counts[k] || 0) + 1;
            if (k === 'order') anyOrder = true;
            if (o && o.source === 'מייל הורים') mail = true;
          });
          if (anyOrder) money += priceOf(c.id);
          if (mail) confirmed++;
        });
      });
      const paid = (orders || []).filter(o => o.paid).length;
      page.querySelector('#bkSum').innerHTML =
        '<div class="bk-card"><b>' + (studs || []).length + '</b><span>תלמידים</span></div>' +
        '<div class="bk-card"><b>' + counts.order + '</b><span>פריטים להזמנה</span></div>' +
        '<div class="bk-card"><b>' + confirmed + '</b><span>משפחות שאישרו במייל</span></div>' +
        '<div class="bk-card"><b>' + money.toLocaleString('he-IL') + ' ₪</b><span>גבייה צפויה</span></div>' +
        '<div class="bk-card"><b>' + (counts.home + counts.lastyear) + '</b><span>מביאים מהבית / משנה שעברה</span></div>' +
        '<div class="bk-card"><b>' + paid + '</b><span>פריטים ששולמו</span></div>';
    }

    function draw() {
      const host = page.querySelector('#bkBody');
      const shown = classesWithBooks.filter(c => !fCls() || String(c.id) === fCls());
      host.innerHTML = shown.map(c => {
        const bs = bookList.filter(b => b.class_id == c.id);
        const rows = studentsOf(c.id);
        if (!rows.length) return '';
        const totals = bs.map(b => rows.filter(s => ((ordMap[s.id + ':' + b.id] || {}).status || 'unknown') === 'order').length);
        return '<div class="bk-sec"><h3>' + esc(c.name) +
          '<span class="bk-price">· ' + priceOf(c.id) + ' ₪ לתלמיד · ' + esc(bs[0] ? (bs[0].supplier || '') : '') + '</span></h3>' +
          '<div class="table-wrap"><table class="bk-tbl"><thead><tr>' +
          '<th style="min-width:150px">תלמיד</th>' +
          bs.map(b => '<th>' + esc(b.name) + (b.detail ? '<small>' + esc(b.detail) + '</small>' : '') + '</th>').join('') +
          '<th style="min-width:96px">מקור</th><th style="width:58px">שולם</th>' +
          '</tr></thead><tbody>' +
          rows.map(s => {
            const first = bs.map(b => ordMap[s.id + ':' + b.id]).find(Boolean) || {};
            const mail = first.source === 'מייל הורים';
            return '<tr data-s="' + s.id + '"><td class="bk-nm">' + esc(nm(s)) + '</td>' +
              bs.map(b => {
                const o = ordMap[s.id + ':' + b.id] || {};
                const k = o.status || 'unknown';
                return '<td class="' + stOf(k).cls + '"><select data-s="' + s.id + '" data-b="' + b.id + '">' +
                  ST.map(x => '<option value="' + x.k + '"' + (x.k === k ? ' selected' : '') + '>' + esc(x.short) + '</option>').join('') +
                  '</select></td>';
              }).join('') +
              '<td class="bk-src' + (mail ? ' mail' : '') + '" title="' + esc(first.note || '') + '">' +
                (mail ? 'אישור במייל' : 'ברירת מחדל') + '</td>' +
              '<td style="text-align:center"><input type="checkbox" data-paid="' + s.id + '"' +
                (first.paid ? ' checked' : '') + '></td></tr>';
          }).join('') +
          '<tr class="bk-foot"><td>סה"כ להזמנה</td>' +
          totals.map(t => '<td>' + t + '</td>').join('') +
          '<td colspan="2"></td></tr>' +
          '</tbody></table></div></div>';
      }).join('') || '<div class="empty-state"><i class="bi bi-journal-x"></i><div>אין תלמידים תואמים לסינון</div></div>';

      host.querySelectorAll('select[data-b]').forEach(sel => {
        sel.addEventListener('change', async () => {
          const sid = sel.dataset.s, bid = sel.dataset.b, val = sel.value;
          const cur = ordMap[sid + ':' + bid];
          sel.disabled = true;
          try {
            if (cur && cur.id) {
              await window.store.update('book_orders', cur.id, { status: val, source: 'עודכן ידנית', updated_at: new Date().toISOString() });
              cur.status = val; cur.source = 'עודכן ידנית';
            } else {
              const r = await window.store.add('book_orders', { student_id: +sid, book_id: +bid, status: val, source: 'עודכן ידנית' });
              ordMap[sid + ':' + bid] = Object.assign({ student_id: +sid, book_id: +bid, status: val, source: 'עודכן ידנית' }, r || {});
            }
            sel.closest('td').className = stOf(val).cls;
            drawSummary();
            const foot = sel.closest('table').querySelector('.bk-foot');
            if (foot) draw();
          } catch (e) {
            alert('השמירה נכשלה: ' + (e && e.message ? e.message : e));
          } finally { sel.disabled = false; }
        });
      });

      host.querySelectorAll('input[data-paid]').forEach(cb => {
        cb.addEventListener('change', async () => {
          const sid = cb.dataset.paid;
          const mine = (orders || []).filter(o => o.student_id == sid);
          cb.disabled = true;
          try {
            for (const o of mine) {
              await window.store.update('book_orders', o.id, { paid: cb.checked });
              o.paid = cb.checked;
            }
            drawSummary();
          } catch (e) {
            alert('השמירה נכשלה: ' + (e && e.message ? e.message : e));
            cb.checked = !cb.checked;
          } finally { cb.disabled = false; }
        });
      });
    }

    function supplierSummary() {
      const agg = {};
      classesWithBooks.forEach(c => {
        bookList.filter(b => b.class_id == c.id).forEach(b => {
          const n = (studs || []).filter(s => s.class_id == c.id)
            .filter(s => ((ordMap[s.id + ':' + b.id] || {}).status || 'unknown') === 'order').length;
          const key = b.name + (b.detail ? ' — ' + b.detail : '');
          agg[key] = (agg[key] || 0) + n;
        });
      });
      const lines = Object.keys(agg).sort().map(k => k + '  ×  ' + agg[k]);
      const w = window.open('', '_blank');
      w.document.write('<meta charset="utf-8"><title>סיכום הזמנה לספק</title>' +
        '<body dir="rtl" style="font-family:system-ui,sans-serif;padding:24px;line-height:1.7">' +
        '<h2>סיכום הזמנה — ' + esc(YEAR) + '</h2><ol><li>' +
        lines.map(esc).join('</li><li>') + '</li></ol></body>');
      w.document.close();
    }

    function csv() {
      const out = [['שיעור', 'תלמיד', 'ספר', 'פירוט', 'סטטוס', 'מקור', 'שולם', 'הערה']];
      classesWithBooks.forEach(c => {
        bookList.filter(b => b.class_id == c.id).forEach(b => {
          (studs || []).filter(s => s.class_id == c.id).forEach(s => {
            const o = ordMap[s.id + ':' + b.id] || {};
            out.push([c.name, nm(s), b.name, b.detail || '', stOf(o.status || 'unknown').t,
                      o.source || '', o.paid ? 'כן' : 'לא', o.note || '']);
          });
        });
      });
      const blob = new Blob(['﻿' + out.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n')],
        { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'הזמנת ספרים ' + YEAR + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    }

    page.querySelector('#bkQ').addEventListener('input', draw);
    page.querySelector('#bkCls').addEventListener('change', draw);
    page.querySelector('#bkSt').addEventListener('change', draw);
    page.querySelector('#bkCsv').addEventListener('click', csv);
    page.querySelector('#bkSupplier').addEventListener('click', supplierSummary);
    page.querySelector('#bkPrint').addEventListener('click', () => window.print());

    drawSummary();
    draw();
  }

  window.cv3Books = { ST, stOf };
  const R = window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  R.books = render;
})();
