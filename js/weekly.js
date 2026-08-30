// weekly.js — סיכום שבועי לר"מ: מה נלמד בכל תחום, מה הספיקו, ואילו פעילויות היו.
// בקשת צבי וינברג (30/08/2026). מסך אחד, שתי פנים:
//   ר"מ (מלמד/מחנך) — טופס מילוי לשבוע הנבחר, לשיעורים שלו.
//   הנהלה (מנהל/מפקח) — טבלת ריכוז של כל הר"מים לאותו שבוע, כולל מי טרם מילא.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const heb = iso => (window.UI && window.UI.hebDate ? window.UI.hebDate(iso) : iso);
  const RATINGS = ['מעולה', 'טוב', 'חלקי', 'פיגור'];
  const RATE_CLS = { 'מעולה': 'ok', 'טוב': 'ok', 'חלקי': 'mid', 'פיגור': 'bad' };

  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  // תמיד יום ראשון. שני ר"מים שפתחו את המסך בימים שונים חייבים ליפול על
  // אותו week_start, אחרת דוח הריכוז מפצל אותם לשתי עמודות.
  function weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
  function weekEnd(ws) { const x = new Date(ws); x.setDate(x.getDate() + 5); return x; }   // ראשון→שישי
  const shift = (isoStr, weeks) => { const d = new Date(isoStr + 'T00:00:00'); d.setDate(d.getDate() + weeks * 7); return iso(d); };
  const rangeLabel = ws => heb(ws) + ' – ' + heb(iso(weekEnd(new Date(ws + 'T00:00:00'))));

  const isAdmin = () => { const u = window.currentUser; return u && (u.role === 'מנהל' || u.role === 'מפקח'); };
  const meId = () => (window.currentUser && window.currentUser.id) || null;

  async function load(ws) {
    const [rows, classes] = await Promise.all([
      window.store.list('weekly_reports', { eq: { week_start: ws } }),
      window.cv3Students ? window.cv3Students.getClasses() : [],
    ]);
    return { rows: rows || [], classes: classes || [] };
  }

  // השיעורים שהמשתמש רשאי למלא עליהם. מחנך/מלמד משויך — כיתותיו; מלמד בלי
  // שיוך — כל המכינה (ראה migration_staff_view_scope.sql).
  function myClasses(classes) {
    const sc = window.cv3Students ? window.cv3Students.scopeClasses() : null;
    return sc ? classes.filter(c => sc.some(x => String(x) === String(c.id))) : classes;
  }

  async function render(page) {
    if (window.Author) await window.Author.load();
    let ws = iso(weekStart(new Date()));
    let subjects = [];
    try { subjects = (await window.store.list('subjects')) || []; } catch (_) { subjects = []; }

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>סיכום שבועי</h2>' +
        '<div class="head-actions">' +
          '<button class="btn-ghost sm" id="wkPrint"><i class="bi bi-printer"></i> הדפסה</button>' +
          '<button class="btn-ghost sm" id="wkCsv"><i class="bi bi-download"></i> ייצוא CSV</button>' +
        '</div></div>' +
      '<div class="wk-nav entry-ui">' +
        '<button class="btn-ghost sm" id="wkPrev"><i class="bi bi-chevron-right"></i> שבוע קודם</button>' +
        '<span class="wk-label" id="wkLabel"></span>' +
        '<button class="btn-ghost sm" id="wkNext">שבוע הבא <i class="bi bi-chevron-left"></i></button>' +
        '<button class="btn-ghost sm" id="wkNow">השבוע</button>' +
      '</div>' +
      '<div id="wkBody"></div>';

    page.querySelector('#wkPrev').addEventListener('click', () => { ws = shift(ws, -1); draw(); });
    page.querySelector('#wkNext').addEventListener('click', () => { ws = shift(ws, 1); draw(); });
    page.querySelector('#wkNow').addEventListener('click', () => { ws = iso(weekStart(new Date())); draw(); });
    page.querySelector('#wkPrint').addEventListener('click', () => window.print());
    page.querySelector('#wkCsv').addEventListener('click', () => exportCsv(ws));

    let lastData = { rows: [], classes: [] };

    async function draw() {
      page.querySelector('#wkLabel').textContent = 'שבוע ' + rangeLabel(ws);
      const host = page.querySelector('#wkBody');
      host.innerHTML = '<div class="page-loading"><span class="spin"><i class="bi bi-arrow-repeat"></i></span><div>טוען…</div></div>';
      const data = await load(ws);
      lastData = data;
      // ההנהלה באה לקרוא, לא למלא: הטפסים של כל השיעורים דחפו את הריכוז
      // מטה בארבעה כרטיסים ריקים. הם נשארים זמינים למנהל שגם מלמד, אבל מקופלים.
      const forms = formsHtml(data);
      host.innerHTML = isAdmin()
        ? adminHtml(data) + (forms
            ? '<details class="wk-own"><summary><i class="bi bi-pencil-square"></i> מילוי סיכום בשמי</summary>' + forms + '</details>'
            : '')
        : forms;
      wireForms(host, data);
      wireAdmin(host, data);
    }

    // ── פני ההנהלה: מי מילא, מי לא, ומה נכתב ──────────────────────────
    function adminHtml(data) {
      const staff = (window.Author && window.Author.all) ? window.Author.all() : [];
      // active !== false — איש צוות שסיים אינו אמור להופיע ב"טרם דיווחו".
      const rams = staff.filter(p => p.active !== false && (p.role === 'מלמד' || p.role === 'מחנך'));
      const byClass = {};
      data.classes.forEach(c => { byClass[c.id] = data.rows.filter(r => String(r.class_id) === String(c.id)); });
      const filled = data.rows.length;
      const nameOf = id => (window.Author ? window.Author.name(id) : '') || 'לא ידוע';
      const missing = rams.filter(p => !data.rows.some(r => String(r.created_by) === String(p.id)));

      const noneCls = data.classes.filter(c => !(byClass[c.id] || []).length);
      const cards = data.classes.map(c => {
        const rs = byClass[c.id] || [];
        if (!rs.length) return '';
        return rs.map(r => {
          const items = Array.isArray(r.items) ? r.items : [];
          const rowsHtml = items.filter(it => it && (it.subject || it.learned || it.progress)).map(it =>
            '<tr><td class="wk-sub">' + esc(it.subject || '—') + '</td>' +
            '<td>' + esc(it.learned || '') + '</td>' +
            '<td>' + esc(it.progress || '') + '</td>' +
            '<td>' + (it.rating ? '<span class="wk-tag ' + (RATE_CLS[it.rating] || 'mid') + '">' + esc(it.rating) + '</span>' : '') + '</td></tr>').join('');
          return '<div class="wk-card"><h4>' + esc(c.name) +
            ' <span class="wk-by"><i class="bi bi-person-badge"></i> ' + esc(nameOf(r.created_by)) + '</span></h4>' +
            (rowsHtml
              ? '<div class="table-wrap"><table class="tbl wk-tbl"><thead><tr><th style="width:20%">תחום</th><th>מה נלמד</th><th>מה הספקנו</th><th style="width:88px">הספק</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
              : '<div class="wk-none">לא פורטו תחומים</div>') +
            (r.activities ? '<div class="wk-extra"><b>פעילויות:</b> ' + esc(r.activities) + '</div>' : '') +
            (r.notes ? '<div class="wk-extra"><b>להנהלה:</b> ' + esc(r.notes) + '</div>' : '') +
            '</div>';
        }).join('');
      }).join('');

      return '<div class="qr-card wk-sum"><h3><i class="bi bi-clipboard-data"></i> ריכוז הנהלה — שבוע ' + esc(rangeLabel(ws)) + '</h3>' +
        '<div class="stat-row wk-stats">' +
          '<div class="stat"><b>' + filled + '</b><span>סיכומים התקבלו</span></div>' +
          '<div class="stat"><b>' + (rams.length - missing.length) + '/' + rams.length + '</b><span>ר"מים שדיווחו</span></div>' +
          '<div class="stat"><b>' + data.rows.reduce((n, r) => n + (Array.isArray(r.items) ? r.items.filter(i => i && i.subject).length : 0), 0) + '</b><span>תחומים שדווחו</span></div>' +
        '</div>' +
        (missing.length
          ? '<div class="wk-missing"><i class="bi bi-exclamation-triangle"></i> <span>טרם דיווחו: ' +
            missing.map(p => esc(p.name || '')).join(' · ') + '</span></div>'
          : '<div class="wk-allin"><i class="bi bi-check-circle"></i> <span>כל הר"מים דיווחו על שבוע זה</span></div>') +
        (noneCls.length
          ? '<div class="wk-chips"><span class="wk-chips-t">שיעורים ללא דיווח:</span> ' +
            noneCls.map(c => '<span class="wk-chip">' + esc(c.name) + '</span>').join('') + '</div>'
          : '') +
        '</div>' +
        '<div class="wk-grid">' + (cards ||
          '<div class="empty-state"><i class="bi bi-inbox"></i><div>עדיין לא התקבל אף סיכום על שבוע זה</div></div>') + '</div>';
    }

    // ── פני הר"מ: טופס מילוי לכל שיעור שלו ────────────────────────────
    function formsHtml(data) {
      if (window.Auth && window.Auth.isReadonly && window.Auth.isReadonly()) return '';
      const mine = myClasses(data.classes);
      if (!mine.length) return isAdmin() ? '' :
        '<div class="empty-state"><i class="bi bi-info-circle"></i><div>לא הוקצו לך שיעורים. פנה למנהל.</div></div>';
      const dl = '<datalist id="wkSubjects">' + subjects.map(s => '<option value="' + esc(s.name) + '">').join('') + '</datalist>';
      return dl + mine.map(c => {
        const r = data.rows.find(x => String(x.class_id) === String(c.id) && String(x.created_by) === String(meId()));
        const items = (r && Array.isArray(r.items) && r.items.length) ? r.items : [{}, {}, {}];
        return '<div class="qr-card wk-form" data-cls="' + c.id + '" data-id="' + (r ? r.id : '') + '">' +
          '<h3><i class="bi bi-journal-text"></i> ' + esc(c.name) +
            (r ? '<span class="wk-saved"><i class="bi bi-check-circle-fill"></i> נשמר · עודכן ' + esc(heb(String(r.updated_at || '').slice(0, 10))) + '</span>' : '') + '</h3>' +
          '<div class="table-wrap entry-ui"><table class="tbl wk-tbl"><thead><tr>' +
            '<th style="width:19%">תחום</th><th>מה נלמד השבוע</th><th>מה הספקנו / היכן אוחזים</th><th style="width:120px">הספק</th><th style="width:40px"></th>' +
          '</tr></thead><tbody class="wk-rows">' + items.map(itemRow).join('') + '</tbody></table></div>' +
          '<button class="btn-ghost sm wk-add"><i class="bi bi-plus-lg"></i> הוסף תחום</button>' +
          '<div class="form-grid" style="margin-top:12px">' +
            '<label class="fld fld-wide"><span>פעילויות ואירועים השבוע</span>' +
              '<textarea class="inp mb0 ta-auto wk-act" rows="2" placeholder="טיול, מבחן, שבת התאחדות, אירוע מיוחד…">' + esc((r && r.activities) || '') + '</textarea></label>' +
            '<label class="fld fld-wide"><span>הערות וצרכים להנהלה</span>' +
              '<textarea class="inp mb0 ta-auto wk-notes" rows="2" placeholder="מה חסר, במה צריך עזרה…">' + esc((r && r.notes) || '') + '</textarea></label>' +
          '</div>' +
          '<button class="btn-primary sm wk-save"><i class="bi bi-check-lg"></i> ' + (r ? 'עדכון הסיכום' : 'שמירת הסיכום') + '</button>' +
          '</div>';
      }).join('');
    }

    function itemRow(it) {
      it = it || {};
      return '<tr class="wk-row">' +
        '<td><input class="inp mb0 wk-f" data-f="subject" list="wkSubjects" placeholder="גמרא…" value="' + esc(it.subject || '') + '"></td>' +
        '<td><textarea class="inp mb0 ta-auto wk-f" data-f="learned" rows="1" placeholder="דף / פרק / נושא">' + esc(it.learned || '') + '</textarea></td>' +
        '<td><textarea class="inp mb0 ta-auto wk-f" data-f="progress" rows="1" placeholder="היכן אוחזים, כמה הספקנו">' + esc(it.progress || '') + '</textarea></td>' +
        '<td><select class="inp mb0 wk-f" data-f="rating"><option value="">—</option>' +
          RATINGS.map(x => '<option' + (it.rating === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></td>' +
        '<td><button class="mini danger wk-del" title="הסר שורה"><i class="bi bi-x-lg"></i></button></td></tr>';
    }

    function wireForms(host, data) {
      host.querySelectorAll('.wk-form').forEach(card => {
        card.querySelector('.wk-add').addEventListener('click', () => {
          const tb = card.querySelector('.wk-rows');
          tb.insertAdjacentHTML('beforeend', itemRow({}));
          bindDel(card);
        });
        bindDel(card);
        card.querySelector('.wk-save').addEventListener('click', () => save(card, data));
      });
    }
    function bindDel(card) {
      card.querySelectorAll('.wk-del').forEach(b => {
        if (b._w) return; b._w = 1;
        b.addEventListener('click', () => {
          const tb = card.querySelector('.wk-rows');
          if (tb.querySelectorAll('.wk-row').length <= 1) { window.UI.toast('צריכה להישאר לפחות שורה אחת', 'err'); return; }
          b.closest('tr').remove();
        });
      });
    }

    async function save(card, data) {
      const items = [...card.querySelectorAll('.wk-row')].map(tr => {
        const g = f => { const el = tr.querySelector('[data-f="' + f + '"]'); return el ? el.value.trim() : ''; };
        return { subject: g('subject'), learned: g('learned'), progress: g('progress'), rating: g('rating') };
      }).filter(x => x.subject || x.learned || x.progress);
      const row = {
        class_id: Number(card.dataset.cls), week_start: ws, items: items,
        activities: card.querySelector('.wk-act').value.trim(),
        notes: card.querySelector('.wk-notes').value.trim(),
      };
      if (!items.length && !row.activities && !row.notes) { window.UI.toast('אין מה לשמור — הטופס ריק', 'err'); return; }
      const btn = card.querySelector('.wk-save'); btn.disabled = true;
      const existing = card.dataset.id;
      const r = existing ? await window.store.update('weekly_reports', Number(existing), row)
                         : await window.store.add('weekly_reports', row);
      btn.disabled = false;
      if (!r || r.ok === false) { window.UI.toast('השמירה נכשלה' + (r && r.error ? ' — ' + r.error : ''), 'err'); return; }
      window.UI.toast('הסיכום נשמר');
      draw();
    }

    function wireAdmin(host) { /* לריכוז ההנהלה אין כרגע פעולות אינטראקטיביות */ }

    async function exportCsv(week) {
      const data = lastData.rows.length || lastData.classes.length ? lastData : await load(week);
      const clsName = id => { const c = data.classes.find(x => String(x.id) === String(id)); return c ? c.name : ''; };
      const nameOf = id => (window.Author ? window.Author.name(id) : '') || '';
      const lines = [['שבוע', 'שיעור', 'ר"מ', 'תחום', 'מה נלמד', 'מה הספקנו', 'הספק', 'פעילויות', 'הערות להנהלה']];
      data.rows.forEach(r => {
        const its = (Array.isArray(r.items) && r.items.length) ? r.items : [{}];
        its.forEach((it, i) => lines.push([
          rangeLabel(week), clsName(r.class_id), nameOf(r.created_by),
          it.subject || '', it.learned || '', it.progress || '', it.rating || '',
          i === 0 ? (r.activities || '') : '', i === 0 ? (r.notes || '') : '',
        ]));
      });
      const csv = '﻿' + lines.map(l => l.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = 'סיכום-שבועי-' + week + '.csv';
      a.click(); URL.revokeObjectURL(a.href);
    }

    draw();
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.weekly = render;
})();
