// medical.js — מידע רפואי מופרד לשלושה סוגים (2026-08-23, בקשת יוסף).
//
// קודם הכל ישב בטבלה שטוחה אחת ("סוג / שם / פרטים"), וזה לא עבד: רגישות
// לפניצילין ונטילת ריטלין הן לא אותו סוג מידע ולא צריכות אותם שדות.
// כאן שלוש לשוניות:
//   • רגישויות ואלרגיות — מה אסור לתת לו. מוצג ראשון כי זה הקריטי.
//   • מצב רפואי         — רקע קבוע (קשב וריכוז, קשיי שמיעה…).
//   • נטילת תרופות      — מינון, שעות השפעה, אופן נטילה ותופעות לוואי.
//
// ⚠️ נטילת תרופה משתנה: מינון עולה, תרופה מוחלפת, ילד מפסיק. לכן לכל רשומת
// תרופה יש `updated_on`, והמסך מסמן באדום כל מי שלא עודכן מעל חודש — ומאפשר
// לשלוח להורים טופס עדכון בלחיצה.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nm = s => (window.UI && window.UI.fullName) ? window.UI.fullName(s) : (s && s.name) || '';
  const today = () => new Date().toISOString().slice(0, 10);
  const STALE_DAYS = 31;

  const TABS = [
    { k: 'רגישות',   t: 'רגישויות ואלרגיות', icon: 'bi-exclamation-octagon' },
    { k: 'מצב רפואי', t: 'מצב רפואי',         icon: 'bi-heart-pulse' },
    { k: 'תרופה',    t: 'נטילת תרופות',      icon: 'bi-capsule' },
  ];

  // שדות לכל קטגוריה — גם לטופס וגם לטבלה
  const FIELDS = {
    'רגישות': [
      { k: 'name', t: 'למה רגיש', req: true },
      { k: 'details', t: 'מה עושים / חומרה', wide: true },
    ],
    'מצב רפואי': [
      { k: 'name', t: 'המצב', req: true },
      { k: 'details', t: 'פירוט', wide: true },
    ],
    'תרופה': [
      { k: 'name', t: 'שם התרופה', req: true },
      { k: 'purpose', t: 'מטרת הנטילה' },
      { k: 'dose', t: 'מינון' },
      { k: 'hours', t: 'שעות השפעה' },
      { k: 'take_time', t: 'זמן נטילה' },
      { k: 'take_how', t: 'אופן נטילה', opts: ['עצמאי', 'נוכחות אחד ההורים', 'במכינה'] },
      { k: 'side_during', t: 'תופעות לוואי בזמן ההשפעה', wide: true },
      { k: 'side_after', t: 'תופעות לוואי אחרי ההשפעה', wide: true },
      { k: 'second', t: 'כדור נוסף בצהריים', type: 'bool' },
      { k: 'dose2', t: 'מינון הכדור השני' },
      { k: 'hours2', t: 'שעות השפעה — שני' },
      { k: 'notes', t: 'הערות ובקשות ההורים', wide: true },
      { k: 'updated_on', t: 'עודכן בתאריך', type: 'date' },
    ],
  };

  const daysSince = d => {
    if (!d) return null;
    const t = Date.parse(String(d).slice(0, 10) + 'T00:00:00');
    return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
  };
  function freshness(r) {
    const n = daysSince(r.updated_on);
    if (n == null) return { cls: 'off', txt: 'לא עודכן מעולם', stale: true };
    if (n > STALE_DAYS) return { cls: 'off', txt: 'עודכן לפני ' + n + ' ימים', stale: true };
    return { cls: 'ok', txt: 'עודכן לפני ' + n + ' ימים', stale: false };
  }

  async function render(page) {
    const [studs, classes, rows] = await Promise.all([
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
      window.store.list('classes'),
      window.store.list('medications'),
    ]);
    const clsOf = s => { const c = classes.find(x => x.id == s.class_id); return c ? c.name : 'ללא שיעור'; };
    const stuOf = id => studs.find(x => x.id == id);
    let data = rows || [];

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
      '<h2>מידע רפואי</h2>' +
      '<div class="head-actions">' +
        '<button class="btn-primary sm" id="mdAdd"><i class="bi bi-plus-lg"></i> רישום חדש</button>' +
        '<button class="btn-ghost sm" id="mdUpdate"><i class="bi bi-envelope-paper"></i> טופס עדכון להורים</button>' +
        '<button class="btn-ghost sm" id="mdCsv"><i class="bi bi-download"></i> ייצוא CSV</button>' +
      '</div></div>' +
      '<div class="demo-note" style="margin:0 2px 12px"><i class="bi bi-shield-lock"></i> ' +
        'מידע רגיש — הגישה מוגבלת לתפקידים מורשים ונאכפת בשרת.</div>' +
      '<div class="toolbar">' +
        '<div class="md-tabs" id="mdTabs">' +
          TABS.map((t, i) => '<button class="md-tab' + (i === 0 ? ' on' : '') + '" data-tab="' + esc(t.k) + '">' +
            '<i class="bi ' + t.icon + '"></i> ' + esc(t.t) + ' <span class="det-badge" data-cnt="' + esc(t.k) + '">0</span></button>').join('') +
        '</div>' +
        '<input type="search" class="inp mb0" id="mdQ" placeholder="חיפוש תלמיד / תרופה…">' +
        '<select class="inp mb0" id="mdCls"><option value="">כל השיעורים</option>' +
          classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select>' +
        '<label class="cb" id="mdStaleWrap" style="white-space:nowrap"><input type="checkbox" id="mdStale"> רק מה שדורש עדכון</label>' +
      '</div>' +
      '<div class="count-line" id="mdCount"></div>' +
      '<div id="mdWrap" class="table-wrap"></div>' +
      '<div id="mdEmpty" class="empty-state" hidden><i class="bi bi-capsule"></i><div>אין רישומים בקטגוריה זו</div></div>';

    let tab = 'רגישות';
    const visible = () => {
      const q = (page.querySelector('#mdQ').value || '').trim();
      const cid = page.querySelector('#mdCls').value;
      const onlyStale = page.querySelector('#mdStale').checked;
      return data.filter(r => {
        if ((r.category || 'תרופה') !== tab) return false;
        const s = stuOf(r.student_id);
        if (cid && String((s || {}).class_id) !== cid) return false;
        if (q && ![nm(s), r.name, r.purpose, r.details].join(' ').includes(q)) return false;
        if (onlyStale && tab === 'תרופה' && !freshness(r).stale) return false;
        return true;
      });
    };

    function draw() {
      TABS.forEach(t => {
        const el = page.querySelector('[data-cnt="' + t.k + '"]');
        if (el) el.textContent = data.filter(r => (r.category || 'תרופה') === t.k).length;
      });
      page.querySelector('#mdStaleWrap').style.display = tab === 'תרופה' ? '' : 'none';

      const list = visible().slice().sort((a, b) => {
        const A = stuOf(a.student_id) || {}, B = stuOf(b.student_id) || {};
        return String(A.family || '').localeCompare(String(B.family || ''), 'he') ||
               String(A.name || '').localeCompare(String(B.name || ''), 'he');
      });
      const isMed = tab === 'תרופה';
      const head = isMed
        ? ['#', 'תלמיד', 'שיעור', 'תרופה', 'מטרה', 'מינון', 'שעות', 'זמן נטילה', 'אופן נטילה', 'תופעות לוואי', 'עדכניות', '']
        : ['#', 'תלמיד', 'שיעור', tab === 'רגישות' ? 'למה רגיש' : 'המצב', 'פירוט', ''];
      const cell = v => '<td>' + esc(v == null || v === '' ? '—' : v) + '</td>';
      const body = list.map((r, i) => {
        const s = stuOf(r.student_id);
        const f = freshness(r);
        const acts = '<td class="row-act">' +
          '<button class="mini" data-edit="' + r.id + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
          '<button class="mini danger" data-del="' + r.id + '" title="מחיקה"><i class="bi bi-trash"></i></button></td>';
        if (!isMed) {
          return '<tr><td class="idx">' + (i + 1) + '</td><td><b>' + esc(nm(s)) + '</b></td>' +
            cell(clsOf(s || {})) + cell(r.name) + cell(r.details) + acts + '</tr>';
        }
        const side = [r.side_during, r.side_after].filter(Boolean).join(' / ');
        return '<tr' + (f.stale ? ' class="md-stale"' : '') + '><td class="idx">' + (i + 1) + '</td>' +
          '<td><b>' + esc(nm(s)) + '</b>' + (r.second ? ' <span class="det-badge">+ צהריים</span>' : '') + '</td>' +
          cell(clsOf(s || {})) + cell(r.name) + cell(r.purpose) + cell(r.dose) + cell(r.hours) +
          cell(r.take_time) + cell(r.take_how) + cell(side) +
          '<td><span class="chip ' + f.cls + '">' + esc(f.txt) + '</span></td>' + acts + '</tr>';
      }).join('');

      page.querySelector('#mdWrap').innerHTML = list.length
        ? '<table class="tbl"><thead><tr>' + head.map(h => '<th>' + esc(h) + '</th>').join('') +
          '</tr></thead><tbody>' + body + '</tbody></table>' : '';
      page.querySelector('#mdEmpty').hidden = list.length > 0;
      const stale = data.filter(r => (r.category || '') === 'תרופה' && freshness(r).stale).length;
      page.querySelector('#mdCount').innerHTML = list.length + ' רישומים' +
        (tab === 'תרופה' && stale ? ' · <b style="color:#b91c1c">' + stale + ' דורשים עדכון מההורים</b>' : '');

      page.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
        const r = data.find(x => x.id == b.dataset.edit); if (r) form(r);
      }));
      page.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        if (!await window.UI.confirm('למחוק את הרישום?')) return;
        const res = await window.store.remove('medications', Number(b.dataset.del));
        if (!res || res.ok === false) { window.UI.toast('המחיקה נכשלה', 'err'); return; }
        data = data.filter(x => x.id != b.dataset.del); draw(); window.UI.toast('נמחק');
      }));
    }

    // ── טופס רישום/עריכה ──────────────────────────────────────────────────
    function form(rec) {
      const cat = (rec && rec.category) || tab;
      const flds = FIELDS[cat] || FIELDS['תרופה'];
      const stuOpts = studs.map(x => '<option value="' + x.id + '"' +
        (rec && x.id == rec.student_id ? ' selected' : '') + '>' + esc(nm(x)) + '</option>').join('');
      const catOpts = TABS.map(t => '<option value="' + esc(t.k) + '"' + (t.k === cat ? ' selected' : '') + '>' + esc(t.t) + '</option>').join('');
      const one = f => {
        const v = rec && rec[f.k] != null ? rec[f.k] : '';
        let input;
        if (f.type === 'bool') {
          input = '<select class="inp mb0" data-m="' + f.k + '"><option value="">לא</option>' +
            '<option value="1"' + (v === true ? ' selected' : '') + '>כן</option></select>';
        } else if (f.opts) {
          input = '<select class="inp mb0" data-m="' + f.k + '"><option value=""></option>' +
            f.opts.map(o => '<option' + (String(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
        } else {
          input = '<input class="inp mb0" data-m="' + f.k + '"' + (f.type === 'date' ? ' type="date"' : '') +
            ' value="' + esc(f.type === 'date' ? String(v).slice(0, 10) : v) + '">';
        }
        return '<label class="fld' + (f.wide ? ' fld-wide' : '') + '"><span>' + esc(f.t) +
          (f.req ? ' *' : '') + '</span>' + input + '</label>';
      };
      window.UI.modal({
        title: rec ? 'עריכת רישום רפואי' : 'רישום רפואי חדש', saveLabel: 'שמירה',
        bodyHTML: '<div class="form-grid">' +
          '<label class="fld"><span>תלמיד *</span><select class="inp mb0" id="md_stu">' + stuOpts + '</select></label>' +
          '<label class="fld"><span>סוג *</span><select class="inp mb0" id="md_cat">' + catOpts + '</select></label>' +
          '<div id="md_fields" class="fld-wide"><div class="form-grid">' + flds.map(one).join('') + '</div></div>' +
          '</div>',
        onSave: async (mel) => {
          const c = mel.querySelector('#md_cat').value;
          const row = { student_id: Number(mel.querySelector('#md_stu').value) || null, category: c, kind: c, source: 'ידני' };
          if (!row.student_id) { window.UI.toast('חובה לבחור תלמיד', 'err'); return false; }
          (FIELDS[c] || []).forEach(f => {
            const el = mel.querySelector('[data-m="' + f.k + '"]');
            if (!el) return;
            const v = (el.value || '').trim();
            row[f.k] = f.type === 'bool' ? v === '1' : (v || null);
          });
          if (!row.name) { window.UI.toast('חובה למלא ' + (FIELDS[c][0].t), 'err'); return false; }
          if (c === 'תרופה' && !row.updated_on) row.updated_on = today();
          const res = rec
            ? await window.store.update('medications', rec.id, row)
            : await window.store.add('medications', row);
          if (!res || res.ok === false) { window.UI.toast('השמירה נכשלה', 'err'); return false; }
          if (rec) Object.assign(rec, row);
          else data = data.concat([(res.data && res.data[0]) || row]);
          tab = c;
          page.querySelectorAll('.md-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === c));
          draw();
          window.UI.toast(rec ? 'עודכן' : 'נוסף');
          return true;
        },
      });
      // החלפת סוג מחליפה את השדות — אין טעם לשאול על מינון ברגישות לאגוזים
      const sel = document.querySelector('.modal-card #md_cat');
      if (sel) sel.addEventListener('change', () => {
        const c = sel.value;
        document.querySelector('.modal-card #md_fields').innerHTML =
          '<div class="form-grid">' + (FIELDS[c] || []).map(one).join('') + '</div>';
      });
    }

    // ── טופס עדכון חודשי להורים ───────────────────────────────────────────
    // נבנה דרך מודול הטפסים הקיים: כל הורה מקבל קישור אישי, ממלא, והתשובה
    // נשמרת תחת התלמיד. כך העדכון החודשי הוא תהליך במערכת ולא קובץ אקסל חדש.
    function updateForm() {
      const stale = data.filter(r => (r.category || '') === 'תרופה' && freshness(r).stale);
      const ids = [...new Set(stale.map(r => r.student_id))];
      const names = ids.map(i => nm(stuOf(i))).filter(Boolean);
      window.UI.modal({
        title: 'טופס עדכון נטילת תרופות', saveLabel: 'צור טופס',
        bodyHTML:
          '<p style="margin:0 0 10px">נוצר טופס עם השאלות של טופס העדכון הקיים. ' +
          'כל הורה מקבל קישור אישי, והתשובה נשמרת תחת התלמיד שלו.</p>' +
          '<div class="det-grid"><div class="det-row"><span class="det-lbl">דורשים עדכון כרגע</span>' +
          '<span class="det-val">' + ids.length + ' תלמידים</span></div></div>' +
          (names.length ? '<p class="tl-note" style="font-size:.82rem">' + esc(names.join(' · ')) + '</p>' : '') +
          '<label class="fld fld-wide" style="margin-top:8px"><span>נמענים</span>' +
          '<select class="inp mb0" id="md_scope">' +
            '<option value="stale">רק מי שדורש עדכון (' + ids.length + ')</option>' +
            '<option value="all">כל התלמידים (' + studs.length + ')</option>' +
          '</select></label>',
        onSave: async (mel) => {
          const scope = mel.querySelector('#md_scope').value;
          const targets = scope === 'stale' ? ids : studs.map(s => s.id);
          if (!targets.length) { window.UI.toast('אין למי לשלוח', 'err'); return false; }
          // שדות הטופס יושבים ב-js/form-templates.js — מקור אחד, לא שכפול
          if (!window.cv3FormTemplates) { window.UI.toast('מודול התבניות לא נטען', 'err'); return false; }
          let r;
          try { r = await window.cv3FormTemplates.create('meds', targets); }
          catch (e) { window.UI.toast(e.message || 'יצירת הטופס נכשלה', 'err'); return false; }
          window.UI.toast('נוצר טופס ל-' + r.sent + ' תלמידים');
          if (window.showPage) showPage('forms');
          return true;
        },
      });
    }

    page.querySelectorAll('.md-tab').forEach(b => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      page.querySelectorAll('.md-tab').forEach(x => x.classList.toggle('on', x === b));
      draw();
    }));
    ['#mdQ', '#mdCls', '#mdStale'].forEach(s => {
      const el = page.querySelector(s);
      el.addEventListener('input', draw); el.addEventListener('change', draw);
    });
    page.querySelector('#mdAdd').addEventListener('click', () => form(null));
    page.querySelector('#mdUpdate').addEventListener('click', updateForm);
    page.querySelector('#mdCsv').addEventListener('click', () => {
      const t = page.querySelector('#mdWrap table');
      if (!t) { window.UI.toast('אין נתונים ליצוא', 'err'); return; }
      const q = v => '"' + String(v == null ? '' : v).replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"';
      const lines = [...t.tHead.rows, ...t.tBodies[0].rows].map(r => [...r.cells].map(c => q(c.innerText)).join(','));
      const blob = new Blob([String.fromCharCode(0xFEFF) + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'רפואי — ' + tab + '.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    });

    style();
    draw();
  }

  function style() {
    if (document.getElementById('mdStyle')) return;
    const s = document.createElement('style'); s.id = 'mdStyle';
    s.textContent =
      '.md-tabs{display:flex;gap:6px;flex-wrap:wrap}' +
      '.md-tab{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--line,#d1d5db);' +
      'background:var(--card,#fff);border-radius:10px;cursor:pointer;font:inherit;color:inherit;transition:.15s}' +
      '.md-tab:hover{border-color:var(--primary,#003048)}' +
      '.md-tab.on{background:var(--primary,#003048);color:#fff;border-color:var(--primary,#003048)}' +
      '.md-tab.on .det-badge{background:rgba(255,255,255,.22);color:#fff}' +
      'tr.md-stale td{background:#fff5f5}';
    document.head.appendChild(s);
  }

  window.cv3Medical = { FIELDS, TABS, freshness };
  const R = window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  R.medical = render;
})();
