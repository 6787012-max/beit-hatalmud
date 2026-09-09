// taitzer.js — יצוא שבועי לכרטיס נטען "טייצר" (09/09/2026, בקשת יוסף).
//
// היה קודם גיליון Google Sheets נפרד (של הרב וינברג) + Apps Script — יוסף
// ביקש שזה יעבור לגמרי לתוך התוכנה, לא קשור ל-Sheets בכלל. הנתונים:
//   • taitzer_cards — המקור-האמת לפרטי הכרטיס הקבועים (מס כרטיס/סטריפ/...),
//     כמעט לא משתנה. נזרע פעם אחת מקובץ ייחוס אמיתי מטייצר.
//   • taitzer_weekly — מצב נוכחי בלבד (אישור+סכום), לא היסטוריה — בדיוק
//     כמו הגיליון הישן: מחליפים כל שבוע, לא צוברים.
// היצוא עצמו: vendor/xlsx-write-lite.js בונה xlsx אמיתי בדפדפן (בלי ספרייה
// חיצונית — נטפרי חוסם CDN-ים כבדים), באותו פורמט 29-עמודות בדיוק כמו
// הקובץ שיוסף קיבל מטייצר.
//
// חיבור לדרכון (בקשת יוסף, המשך אותו יום): הסכום להטענה לא מוזן ידנית —
// נגזר מ-window.cv3Passport.shekels() (js/passport.js), אותה נוסחת "שכר
// השבוע" שכבר קיימת ומוצגת שם (שחרית+לימוד+מבחנים+קנין רש"י → ₪). לא
// score() הגולמי (0–100, אחוז) — shekels() הוא כבר ₪ אמיתיים, בדיוק המושג
// שצריך כאן. ממולא אוטומטית בפעם הראשונה שרואים תלמיד השבוע, אבל נשאר
// שדה רגיל שאפשר לערוך/לתקן לפני יצוא — לא נעול. אנשי צוות (בלי רשומת
// תלמיד/דרכון) פשוט מקבלים 0 כברירת מחדל, עדיין ניתן להזין ידנית.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const HEADER = ['תגיות', 'סניפים', 'תעודת זהות', 'נייד', 'נייד 1', 'טלפון', 'מס כרטיס', 'סטריפ',
    'דואר אלקטרוני', 'תאריך לידה', 'גיל', 'תואר', 'משפחה', 'שם', 'סיומת כבוד', 'שם מחזיק הכרטיס',
    'קהילה', 'שכונה', 'עיר', 'כתובת', 'מספר בית', 'דירה', 'הערות', 'סטטוס', 'קבוצת כרטיסים', 'יתרה',
    'כרטיס קודם', 'תעודת זהות נוספת', 'מזהה פנימי'];
  // אינדקסים (0-based) שנשמרים כמספר, בדיוק כמו בקובץ הייחוס המקורי — כל
  // השאר טקסט (גם ת.ז ומספר בית, כדי לשמר אפסים מובילים).
  const NUMERIC_COLS = [6, 25, 26];

  function cardRow(c, amount, seq) {
    return ['', '', c.tz, c.mobile || '', c.mobile2 || '', c.phone || '',
      c.card_number ? Number(c.card_number) : '', c.stripe || '', c.email || '', c.birthdate || '', '',
      c.title || '', c.family || '', c.first_name || '', c.honorific || '', c.holder_name || '',
      c.community || '', c.neighborhood || '', c.city_field || '', c.address || '', c.house_no || '',
      c.apartment || '', c.notes || '', c.status || 'פעיל', c.card_group || '', Number(amount) || 0,
      Number(c.prev_card) || 0, seq != null ? String(seq) : (c.extra_tz || ''), c.internal_id || ''];
  }

  async function render(page) {
    page.innerHTML = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>כרטיסי טייצר</h2></div>' +
      '<div class="ld" style="padding:30px;text-align:center"><i class="bi bi-hourglass-split"></i> טוען…</div>';

    // בדיקה ישירה דרך window.db (לא window.store) כדי שטבלה שעוד לא נוצרה
    // (המיגרציה טרם הורצה) תיתן הודעה ידידותית במקום הטוסט האדום הגנרי.
    const [cardsRes, weeklyRes, studentsRes, passportRes] = await Promise.all([
      window.db.list('taitzer_cards', {}),
      window.db.list('taitzer_weekly', {}),
      window.cv3Students ? window.cv3Students.getStudents() : window.db.list('students', {}).then(r => r.data || []),
      window.db.list('passport', {}),
    ]);
    if (!cardsRes.ok) {
      page.innerHTML = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>כרטיסי טייצר</h2></div>' +
        '<div class="empty-state"><i class="bi bi-database-exclamation"></i><div>הטבלאות עדיין לא קיימות — יש להריץ את ' +
        '<code>supabase/migration_taitzer.sql</code> ב-Supabase SQL Editor קודם.</div></div>';
      return;
    }
    let cards = cardsRes.data || [];
    let weekly = weeklyRes.ok ? (weeklyRes.data || []) : [];
    const weeklyByTz = {};
    weekly.forEach(w => { weeklyByTz[w.tz] = w; });
    cards.sort((a, b) => String(a.family || '').localeCompare(String(b.family || ''), 'he') ||
                          String(a.first_name || '').localeCompare(String(b.first_name || ''), 'he'));

    // ── סכום מוצע מדרכון: shekels() — "שכר השבוע" האמיתי בש"ח, לא score()
    // הגולמי (0–100, אחוז). תלמידים בלי רשומת דרכון לשבוע הנוכחי → 0/—. ──
    const P = window.cv3Passport;
    const students = Array.isArray(studentsRes) ? studentsRes : [];
    const studentByTz = {};
    students.forEach(s => { if (s.tz) studentByTz[String(s.tz).trim()] = s; });
    const passportRows = passportRes.ok ? (passportRes.data || []) : [];
    const wk = P ? P.currentWeek() : null;
    const passportByStudent = {};
    if (wk != null) passportRows.forEach(r => { if (r.week_no === wk) passportByStudent[r.student_id] = r; });
    function darkonAmount(tz) {
      const s = studentByTz[tz];
      if (!s || !P) return null;                       // אין תלמיד תואם (למשל איש צוות) — לא "0", אלא "לא רלוונטי"
      const pr = passportByStudent[s.id];
      return pr ? P.shekels(pr) : 0;                    // יש תלמיד אבל עוד לא הוזן דרכון השבוע → 0 אמיתי
    }

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>כרטיסי טייצר</h2>' +
      '<div class="head-actions"><button class="btn-ghost sm" id="txFillDarkon"><i class="bi bi-arrow-repeat"></i> מלא הכל מדרכון</button>' +
      '<button class="btn-primary sm" id="txExport"><i class="bi bi-download"></i> יצוא לטייצר</button></div></div>' +
      '<div class="qr-card"><p class="login-hint" style="margin:0"><i class="bi bi-info-circle"></i> ' +
      'הסכום ממולא אוטומטית משכר השבוע ב"דרכון" (אפשר לתקן ידנית). סמנו אישור, ואז "יצוא לטייצר" — ' +
      'מוריד קובץ Excel מוכן להעלאה, באותו פורמט של טייצר.' +
      (cards.length ? '' : ' <b style="color:#b91c1c">אין עדיין כרטיסים ברשימה.</b>') + '</p></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>שם</th><th>ת״ז</th><th>קבוצה</th><th>אישור</th><th>סכום להטענה</th><th>לפי דרכון</th><th>יוצא לאחרונה</th>' +
      '</tr></thead><tbody id="txBody">' + cards.map(c => {
        const w = weeklyByTz[c.tz];
        const dk = darkonAmount(c.tz);
        // בפעם הראשונה שרואים תלמיד השבוע (אין עדיין שורת taitzer_weekly) —
        // ממלאים מדרכון אוטומטית. אם כבר יש שורה (מישהו כבר בדק/ערך) — לא דורסים.
        const startAmount = w ? w.amount : (dk || 0);
        return '<tr data-tz="' + esc(c.tz) + '">' +
          '<td>' + esc(c.holder_name || ((c.family || '') + ' ' + (c.first_name || '')).trim()) + '</td>' +
          '<td dir="ltr" style="text-align:left">' + esc(c.tz) + '</td>' +
          '<td>' + esc(c.city_field || '') + '</td>' +
          '<td><input type="checkbox" class="tx-app"' + (w && w.approved ? ' checked' : '') + '></td>' +
          '<td><input type="number" class="inp mb0 tx-amt" style="width:90px" step="0.01" value="' + startAmount + '"></td>' +
          '<td class="tl-note" data-dk style="font-size:.8rem">' + (dk == null ? '—' : dk + ' ₪') + '</td>' +
          '<td class="tl-note" data-exp style="font-size:.78rem">' + (w && w.exported_at ? esc(new Date(w.exported_at).toLocaleDateString('he-IL')) : '—') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';

    // שמירה מיידית בשינוי — כמו כל checkbox אחר במערכת, בלי כפתור "שמור" נפרד.
    async function saveRow(tr) {
      const tz = tr.dataset.tz;
      const c = cards.find(x => x.tz === tz);
      const approved = tr.querySelector('.tx-app').checked;
      const amount = Number(tr.querySelector('.tx-amt').value) || 0;
      let w = weeklyByTz[tz];
      if (w) {
        const r = await window.store.update('taitzer_weekly', w.id, { approved, amount, updated_at: new Date().toISOString() });
        if (!r || r.ok === false) { window.UI.toast('השמירה נכשלה', 'err'); return; }
        w.approved = approved; w.amount = amount;
      } else {
        const r = await window.store.add('taitzer_weekly', { tz, name: c.holder_name, approved, amount });
        if (!r || r.ok === false) { window.UI.toast('השמירה נכשלה', 'err'); return; }
        w = (r.data && r.data[0]) || { id: null, tz, approved, amount };
        weeklyByTz[tz] = w; weekly.push(w);
      }
    }
    page.querySelectorAll('#txBody tr').forEach(tr => {
      tr.querySelector('.tx-app').addEventListener('change', () => saveRow(tr));
      tr.querySelector('.tx-amt').addEventListener('change', () => saveRow(tr));
    });

    // "מלא הכל מדרכון" — דורס במפורש את כל שדות הסכום (גם שורות שכבר נערכו
    // ידנית — זו לחיצה מפורשת על "מלא הכל", לא ברירת מחדל פסיבית) ושומר מיד,
    // כדי שהכפתור באמת יעשה את מה שהוא אומר. שימושי בתחילת השבוע אחרי
    // שדרכון עודכן, או לרענון מלא.
    page.querySelector('#txFillDarkon').addEventListener('click', async () => {
      const btn = page.querySelector('#txFillDarkon');
      btn.disabled = true;
      let n = 0;
      const rows = [...page.querySelectorAll('#txBody tr')];
      for (const tr of rows) {
        const dk = darkonAmount(tr.dataset.tz);
        if (dk == null) continue;
        tr.querySelector('.tx-amt').value = dk;
        await saveRow(tr);
        n++;
      }
      btn.disabled = false;
      window.UI.toast('מולאו ונשמרו ' + n + ' סכומים מדרכון');
    });

    page.querySelector('#txExport').addEventListener('click', async () => {
      const btn = page.querySelector('#txExport');
      btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> מכין קובץ…';
      try {
        const approvedRows = [];
        cards.forEach(c => { const w = weeklyByTz[c.tz]; if (w && w.approved) approvedRows.push({ c: c, w: w }); });
        if (!approvedRows.length) { window.UI.toast('אין אף אחד מאושר', 'err'); return; }
        const rows = approvedRows.map(({ c, w }, i) => cardRow(c, w.amount, i + 1));
        const blob = await window.XlsxWriteLite.build(HEADER, rows, NUMERIC_COLS);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'יצוא לטייצר ' + new Date().toISOString().slice(0, 10) + '.xlsx';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 20000);
        const now = new Date().toISOString();
        for (const { w } of approvedRows) {
          if (w.id != null) await window.store.update('taitzer_weekly', w.id, { exported_at: now });
          w.exported_at = now;
        }
        page.querySelectorAll('#txBody tr').forEach(tr => {
          const w = weeklyByTz[tr.dataset.tz];
          if (w && w.exported_at) tr.querySelector('[data-exp]').textContent = new Date(w.exported_at).toLocaleDateString('he-IL');
        });
        window.UI.toast('יוצאו ' + approvedRows.length + ' כרטיסים');
      } catch (e) {
        window.UI.toast('היצוא נכשל: ' + (e && e.message || e), 'err');
      } finally {
        btn.disabled = false; btn.innerHTML = orig;
      }
    });
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.taitzer = render;
})();
