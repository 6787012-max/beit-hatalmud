// taitzer.js — יצוא שבועי לכרטיס נטען "טייצר" (09/09/2026, בקשת יוסף).
//
// היה קודם גיליון Google Sheets נפרד (של הרב וינברג) + Apps Script — יוסף
// ביקש שזה יעבור לגמרי לתוך התוכנה, לא קשור ל-Sheets בכלל. הנתונים:
//   • taitzer_cards — המקור-האמת לפרטי הכרטיס הקבועים (מס כרטיס/סטריפ/...),
//     כמעט לא משתנה. נזרע פעם אחת מקובץ ייחוס אמיתי מטייצר. כולל
//     extra_pending — טעינה נוספת חד-פעמית שממתינה להיכנס לחישוב הבא.
//   • taitzer_weekly — רשומה לכל (tz, week_no) — היסטוריה אמיתית, לא רק
//     "מצב נוכחי" (תוקן 09/09 המשך אותו יום: יוסף ביקש לראות/לבחור שבועות
//     קודמים, לא רק את הנוכחי).
// היצוא עצמו: vendor/xlsx-write-lite.js בונה xlsx אמיתי בדפדפן (בלי ספרייה
// חיצונית — נטפרי חוסם CDN-ים כבדים). ⚠️ הפורמט הוא 3 עמודות בלבד (ת"ז/
// סכום/"כן") — תוקן 09/09 אחרי שיוסף בדק בפועל: קובץ ה-29-עמודות ששלח
// (cards.14.07.15_09.09.26.xlsx) הוא "רשימת הכרטיסים" המלאה של טייצר
// (לניהול פרטי כרטיס, נדיר/חד-פעמי) — לא קובץ הטעינה השבועי הרגיל, שהוא
// הרבה יותר פשוט.
//
// חיבור לדרכון (בקשת יוסף, אותו יום): הסכום להטענה לא מוזן ידנית —
// נגזר מ-window.cv3Passport.shekels() (js/passport.js), אותה נוסחת "שכר
// השבוע" שכבר קיימת ומוצגת שם (שחרית+לימוד+מבחנים+קנין רש"י → ₪). לא
// score() הגולמי (0–100, אחוז) — shekels() הוא כבר ₪ אמיתיים. ממולא
// אוטומטית בפעם הראשונה שרואים תלמיד באותו שבוע (+ כל extra_pending
// ממתין), אבל נשאר שדה רגיל שאפשר לערוך/לתקן לפני יצוא — לא נעול.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── יצוא: 3 עמודות בלבד — תעודת זהות, סכום, והמילה הקבועה "כן". ──
  const HEADER = ['תעודת זהות', 'סכום', 'אישור'];
  const NUMERIC_COLS = [1];
  function exportRow(tz, amount) { return [tz, Number(amount) || 0, 'כן']; }

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
        '<code>supabase/migration_taitzer.sql</code> ו-<code>migration_taitzer_v2.sql</code> ב-Supabase SQL Editor קודם.</div></div>';
      return;
    }
    let cards = cardsRes.data || [];
    const allWeekly = weeklyRes.ok ? (weeklyRes.data || []) : [];
    cards.sort((a, b) => String(a.family || '').localeCompare(String(b.family || ''), 'he') ||
                          String(a.first_name || '').localeCompare(String(b.first_name || ''), 'he'));

    // ── סכום מוצע מדרכון: shekels() — "שכר השבוע" האמיתי בש"ח, לא score()
    // הגולמי (0–100, אחוז). תלמידים בלי רשומת דרכון לשבוע הנתון → 0/—.
    // ⚠️ 10/09/2026 (בקשת יוסף — "ההיסטוריה לא נותן נתוני אמת"): לפני זה
    // הפונקציה חישבה תמיד לפי הדרכון של **השבוע הנוכחי בלבד**, גם כשמסתכלים
    // על שבוע עבר — כלומר שבוע 1/2 הציגו את הסכום של היום כאילו זה מה
    // שהיה אז. עכשיו מקבלת week ומחשבת לפי הדרכון האמיתי של אותו שבוע
    // בדיוק (הנתונים כבר נשלפים לכל השבועות, לא רק לנוכחי). ──
    const P = window.cv3Passport;
    const students = Array.isArray(studentsRes) ? studentsRes : [];
    const studentByTz = {};
    students.forEach(s => { if (s.tz) studentByTz[String(s.tz).trim()] = s; });
    const passportRows = passportRes.ok ? (passportRes.data || []) : [];
    const curWeek = P ? P.currentWeek() : 1;
    const passportByStudentByWeek = {};
    passportRows.forEach(r => { (passportByStudentByWeek[r.week_no] = passportByStudentByWeek[r.week_no] || {})[r.student_id] = r; });
    function darkonAmount(tz, week) {
      const s = studentByTz[tz];
      if (!s || !P) return null;                       // אין תלמיד תואם (למשל איש צוות) — לא "0", אלא "לא רלוונטי"
      const pr = (passportByStudentByWeek[week] || {})[s.id];
      return pr ? P.shekels(pr) : 0;                    // יש תלמיד אבל עוד לא הוזן דרכון לשבוע הזה → 0 אמיתי
    }
    // סה"כ שכבר נטען בפועל לכל כרטיס (שבועות שיוצאו בפועל, לא רק אושרו).
    const totalByTz = {};
    allWeekly.forEach(w => { if (w.exported_at) totalByTz[w.tz] = (totalByTz[w.tz] || 0) + (Number(w.amount) || 0); });
    function weekLabel(n) {
      const wk = P && P.WEEKS && P.WEEKS[n - 1];
      return 'שבוע ' + n + (wk ? ' — ' + wk[0] + ' (' + wk[1] + ')' : '');
    }

    let selectedWeek = curWeek;
    let view = 'week'; // 'week' | 'summary'
    let unlockedWeek = null; // week_no שנפתח במפורש לעריכה למרות שהוא לא השבוע הנוכחי

    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>כרטיסי טייצר</h2>' +
      '<div class="head-actions">' +
        '<button class="btn-ghost sm" id="txSummaryToggle"><i class="bi bi-bar-chart"></i> <span>סיכום לפי תלמיד</span></button>' +
        '<button class="btn-ghost sm" id="txFillDarkon"><i class="bi bi-arrow-repeat"></i> מלא הכל מדרכון</button>' +
        '<button class="btn-primary sm" id="txExport"><i class="bi bi-download"></i> יצוא לטייצר</button>' +
      '</div></div>' +
      '<div class="qr-card"><p class="login-hint" style="margin:0"><i class="bi bi-info-circle"></i> ' +
      'הסכום ממולא אוטומטית משכר השבוע ב"דרכון" (אפשר לתקן ידנית, ותוסיף טעינה חד-פעמית ב-<i class="bi bi-plus-circle"></i>). ' +
      'סמנו אישור, ואז "יצוא לטייצר" — מוריד קובץ Excel מוכן להעלאה (ת״ז/סכום/אישור בלבד). ' +
      'שבועות קודמים (◄) מציגים רק מה שבאמת נשמר אז — ואפשר לפתוח כל שבוע לעריכה בנפרד אם צריך להשלים/לתקן.' +
      (cards.length ? '' : ' <b style="color:#b91c1c">אין עדיין כרטיסים ברשימה.</b>') + '</p></div>' +
      '<div id="txContent"></div>';

    function draw() {
      const box = page.querySelector('#txContent');
      if (view === 'summary') { drawSummary(box); return; }
      drawWeek(box);
    }

    function drawSummary(box) {
      // בקשת יוסף 10/09: "וגם לראות ... כל השבועות" — לא רק "טעינה אחרונה"
      // אלא כל ההיסטוריה, שבוע-שבוע, לכל תלמיד. כולל רק שבועות שיוצאו
      // בפועל (exported_at) — זו היסטוריה אמיתית, לא מה שרק אושר/הוקלד.
      box.innerHTML = '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>שם</th><th>ת״ז</th><th>סה״כ נטען עד היום</th><th>היסטוריית טעינות — כל השבועות</th><th>ממתין לטעינה הבאה</th>' +
        '</tr></thead><tbody>' + cards.map(c => {
          const hist = allWeekly.filter(w => w.tz === c.tz && w.exported_at)
            .sort((a, b) => (b.week_no || 0) - (a.week_no || 0));
          return '<tr>' +
            '<td>' + esc(c.holder_name || ((c.family || '') + ' ' + (c.first_name || '')).trim()) + '</td>' +
            '<td dir="ltr" style="text-align:left">' + esc(c.tz) + '</td>' +
            '<td><strong>' + (totalByTz[c.tz] || 0) + ' ₪</strong></td>' +
            '<td>' + (hist.length
              ? '<div style="max-height:76px;overflow-y:auto;font-size:.8rem;line-height:1.8">' +
                  hist.map(w => 'שבוע ' + w.week_no + ': <strong>' + w.amount + ' ₪</strong>').join('<br>') +
                '</div>'
              : '<span class="tl-note">אין עדיין טעינות</span>') + '</td>' +
            '<td>' + (Number(c.extra_pending) > 0 ? '<span class="chip warn">+' + c.extra_pending + ' ₪</span>' : '—') + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>';
    }

    function drawWeek(box) {
      const weeklyByTz = {};
      allWeekly.filter(w => w.week_no === selectedWeek).forEach(w => { weeklyByTz[w.tz] = w; });
      const editable = selectedWeek === curWeek;
      // "אופציה להטעין" גם בשבוע עבר (בקשת יוסף 10/09) — נעול כברירת מחדל
      // (למנוע שינוי בטעות של היסטוריה), אבל אפשר לפתוח לעריכה במפורש.
      const canEdit = editable || unlockedWeek === selectedWeek;

      box.innerHTML =
        '<div class="tx-weeknav">' +
          '<button class="btn-ghost sm" id="txPrevWk"' + (selectedWeek <= 1 ? ' disabled' : '') + '><i class="bi bi-chevron-right"></i></button>' +
          '<strong>' + esc(weekLabel(selectedWeek)) + '</strong>' +
          '<button class="btn-ghost sm" id="txNextWk"' + (selectedWeek >= curWeek ? ' disabled' : '') + '><i class="bi bi-chevron-left"></i></button>' +
          (editable ? '' : (canEdit
            ? '<span class="chip warn">היסטוריה — פתוח לעריכה</span>'
            : '<span class="chip off">היסטוריה — לצפייה בלבד</span> <button class="btn-ghost xs" id="txUnlock" type="button"><i class="bi bi-unlock"></i> פתח לעריכה</button>')) +
        '</div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr>' +
          '<th>שם</th><th>ת״ז</th><th>קבוצה</th><th>אישור</th><th>סכום להטענה</th><th>לפי דרכון (שבוע זה)</th><th></th><th>יוצא לאחרונה</th>' +
        '</tr></thead><tbody id="txBody">' + cards.map(c => {
          const w = weeklyByTz[c.tz];
          // "לפי דרכון" תמיד מחושב לפי הדרכון האמיתי **של השבוע הזה בדיוק**
          // (לא של היום) — זה בדיוק מה שהיה שבור: שבוע עבר הציג את נתוני
          // היום כאילו זה מה שהיה אז. מוצג כמידע גם בשבוע נעול, גם אם אי
          // אפשר לערוך לפיו.
          const dk = darkonAmount(c.tz, selectedWeek);
          // טעינה נוספת ממתינה רלוונטית רק ל"טעינה הבאה" האמיתית — כלומר
          // רק כשמסתכלים בפועל על השבוע הנוכחי, לא בשחזור שבוע עבר.
          const extra = (selectedWeek === curWeek) ? (Number(c.extra_pending) || 0) : 0;
          // בפעם הראשונה שרואים תלמיד בשבוע הזה (אין עדיין שורת taitzer_weekly)
          // — אם אפשר לערוך, ממלאים הצעה מדרכון+טעינה ממתינה; אם לא (היסטוריה
          // נעולה) — אין שום נתון אמיתי להציג, ולכן לא ממציאים מספר.
          const startAmount = w ? w.amount : (canEdit ? ((dk || 0) + extra) : null);
          const amtCell = startAmount == null
            ? '<span class="tl-note">לא נבדק</span>'
            : '<input type="number" class="inp mb0 tx-amt" style="width:90px" step="0.01" value="' + startAmount + '"' + (canEdit ? '' : ' disabled') + '>';
          return '<tr data-tz="' + esc(c.tz) + '">' +
            '<td>' + esc(c.holder_name || ((c.family || '') + ' ' + (c.first_name || '')).trim()) + '</td>' +
            '<td dir="ltr" style="text-align:left">' + esc(c.tz) + '</td>' +
            '<td>' + esc(c.city_field || '') + '</td>' +
            '<td><input type="checkbox" class="tx-app"' + (w && w.approved ? ' checked' : '') + (canEdit ? '' : ' disabled') + '></td>' +
            '<td>' + amtCell + '</td>' +
            '<td class="tl-note" data-dk style="font-size:.8rem">' + (dk == null ? '—' : dk + ' ₪') + '</td>' +
            '<td>' + (extra > 0 ? '<span class="chip warn" title="ייכנס אוטומטית לסכום">+' + extra + ' ₪</span>' : '') +
              // הכפתור רק בשבוע הנוכחי בפועל — "טעינה נוספת" היא תמיד ל"טעינה
              // הבאה" האמיתית, ובשבוע עבר (גם פתוח לעריכה) זה מבלבל/לא רלוונטי.
              ((selectedWeek === curWeek) ? ' <button class="btn-ghost xs tx-extra" type="button" title="הוסף טעינה חד-פעמית"><i class="bi bi-plus-circle"></i></button>' : '') + '</td>' +
            '<td class="tl-note" data-exp style="font-size:.78rem">' + (w && w.exported_at ? esc(new Date(w.exported_at).toLocaleDateString('he-IL')) : '—') + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>';

      // ניווט השבועות חייב לעבוד גם בשבוע היסטורי (אחרת אי אפשר לצאת ממנו) —
      // נרשם תמיד, לפני ה-guard הבא שחוסם רק את האינטרקציה של הטבלה עצמה.
      // נעילה חוזרת בברירת מחדל בכל ניווט — לא "נשארים פתוחים" בטעות.
      box.querySelector('#txPrevWk')?.addEventListener('click', () => { if (selectedWeek > 1) { unlockedWeek = null; selectedWeek--; draw(); } });
      box.querySelector('#txNextWk')?.addEventListener('click', () => { if (selectedWeek < curWeek) { unlockedWeek = null; selectedWeek++; draw(); } });
      box.querySelector('#txUnlock')?.addEventListener('click', () => { unlockedWeek = selectedWeek; draw(); });

      page.querySelector('#txFillDarkon').disabled = !canEdit;
      page.querySelector('#txExport').disabled = !canEdit;
      if (!canEdit) return; // היסטוריה נעולה — בלי עריכת הטבלה עצמה

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
          const r = await window.store.add('taitzer_weekly', { tz, name: c.holder_name, week_no: selectedWeek, approved, amount });
          if (!r || r.ok === false) { window.UI.toast('השמירה נכשלה', 'err'); return; }
          w = (r.data && r.data[0]) || { id: null, tz, week_no: selectedWeek, approved, amount };
          weeklyByTz[tz] = w; allWeekly.push(w);
          // הטעינה הנוספת נכנסה לתוך הסכום הזה רק אם זה באמת השבוע הנוכחי
          // (ראו extra למעלה — בשבוע עבר היא תמיד 0 ולא נכללה בסכום שנשמר
          // כרגע). לאפס אותה גם כשמשלימים שבוע עבר היה מוחק טעינה אמיתית
          // שעדיין לא נכנסה לשום ייצוא בפועל — נמצא בביקורת קוד 10/09.
          if (selectedWeek === curWeek && Number(c.extra_pending) > 0) {
            await window.store.update('taitzer_cards', c.id, { extra_pending: 0 });
            c.extra_pending = 0;
          }
        }
      }
      box.querySelectorAll('#txBody tr').forEach(tr => {
        tr.querySelector('.tx-app').addEventListener('change', () => saveRow(tr));
        tr.querySelector('.tx-amt').addEventListener('change', () => saveRow(tr));
        const eb = tr.querySelector('.tx-extra');
        if (eb) eb.addEventListener('click', async () => {
          const tz = tr.dataset.tz;
          const c = cards.find(x => x.tz === tz);
          const v = prompt('טעינה נוספת חד-פעמית לכרטיס (₪) — תיכנס אוטומטית לסכום בטעינה הבאה:');
          if (v == null) return;
          const n = Number(v);
          if (!n || n <= 0) { window.UI.toast('סכום לא תקין', 'err'); return; }
          const newVal = (Number(c.extra_pending) || 0) + n;
          const r = await window.store.update('taitzer_cards', c.id, { extra_pending: newVal });
          if (!r || r.ok === false) { window.UI.toast('השמירה נכשלה', 'err'); return; }
          c.extra_pending = newVal;
          window.UI.toast('נוספו ' + n + ' ₪ — ייכנסו אוטומטית בטעינה הבאה');
          draw();
        });
      });

      // "מלא הכל מדרכון" — דורס במפורש את כל שדות הסכום (גם שורות שכבר נערכו
      // ידנית — זו לחיצה מפורשת, לא ברירת מחדל פסיבית) ושומר מיד. ⚠️ מדלג
      // על שורות שכבר `exported_at` (הושלמו בפועל בעבר) — לשנות את הסכום
      // אחרי שכבר יוצא קובץ אמיתי היה יוצר פער בין מה שנטען בפועל למה
      // שרשום כאן, בלי שום קובץ חדש שמשקף את זה (נמצא בביקורת קוד 10/09).
      page.querySelector('#txFillDarkon').onclick = async () => {
        const btn = page.querySelector('#txFillDarkon');
        btn.disabled = true;
        let n = 0;
        const rows = [...box.querySelectorAll('#txBody tr')];
        for (const tr of rows) {
          const already = weeklyByTz[tr.dataset.tz];
          if (already && already.exported_at) continue;
          const dk = darkonAmount(tr.dataset.tz, selectedWeek);
          if (dk == null) continue;
          tr.querySelector('.tx-amt').value = dk;
          await saveRow(tr);
          n++;
        }
        btn.disabled = false;
        window.UI.toast('מולאו ונשמרו ' + n + ' סכומים מדרכון');
      };

      page.querySelector('#txExport').onclick = async () => {
        const btn = page.querySelector('#txExport');
        btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> מכין קובץ…';
        try {
          // ⚠️ 10/09/2026 (נמצא בביקורת קוד אחרי הוספת "פתח לעריכה" לשבוע
          // עבר): מאושר-אבל-כבר-`exported_at` נשאר בחוץ בכוונה. בלי זה,
          // פתיחת שבוע ישן שכבר יוצא ולחיצה על "יצוא לטייצר" מ-הרגל הייתה
          // מייצרת מחדש קובץ אמיתי לכל השבוע (סיכון טעינה כפולה בפועל
          // בטייצר!) ודורסת את exported_at ההיסטורי האמיתי. "יצוא" תמיד
          // אומר "מה שעוד לא יצא" — גם בשבוע נוכחי, גם בהשלמת שבוע עבר.
          const approvedRows = [];
          cards.forEach(c => { const w = weeklyByTz[c.tz]; if (w && w.approved && !w.exported_at) approvedRows.push({ c: c, w: w }); });
          if (!approvedRows.length) { window.UI.toast('אין מה לייצא — הכל כבר יוצא, או שאף אחד לא מאושר', 'err'); return; }
          const rows = approvedRows.map(({ c, w }) => exportRow(c.tz, w.amount));
          const blob = await window.XlsxWriteLite.build(HEADER, rows, NUMERIC_COLS);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'יצוא לטייצר ' + new Date().toISOString().slice(0, 10) + '.xlsx';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 20000);
          const now = new Date().toISOString();
          for (const { c, w } of approvedRows) {
            if (w.id != null) await window.store.update('taitzer_weekly', w.id, { exported_at: now });
            w.exported_at = now;
            totalByTz[c.tz] = (totalByTz[c.tz] || 0) + (Number(w.amount) || 0);
          }
          box.querySelectorAll('#txBody tr').forEach(tr => {
            const w = weeklyByTz[tr.dataset.tz];
            if (w && w.exported_at) tr.querySelector('[data-exp]').textContent = new Date(w.exported_at).toLocaleDateString('he-IL');
          });
          window.UI.toast('יוצאו ' + approvedRows.length + ' כרטיסים');
        } catch (e) {
          window.UI.toast('היצוא נכשל: ' + (e && e.message || e), 'err');
        } finally {
          btn.disabled = false; btn.innerHTML = orig;
        }
      };
    }

    page.querySelector('#txSummaryToggle').addEventListener('click', () => {
      view = view === 'summary' ? 'week' : 'summary';
      // נעילה חוזרת גם כשעוברים דרך הסיכום ובחזרה — לא רק בניווט ◄/►
      // (נמצא בביקורת קוד: שבוע שנפתח לעריכה נשאר פתוח אחרי סיבוב דרך
      // הסיכום, בניגוד לכוונה שכל ניווט מהשבוע נועל בחזרה).
      unlockedWeek = null;
      page.querySelector('#txSummaryToggle span').textContent = view === 'summary' ? 'חזרה לטבלה השבועית' : 'סיכום לפי תלמיד';
      const disableWeekBtns = view === 'summary';
      page.querySelector('#txFillDarkon').style.display = disableWeekBtns ? 'none' : '';
      page.querySelector('#txExport').style.display = disableWeekBtns ? 'none' : '';
      draw();
    });

    draw();
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.taitzer = render;

  // ── סקשן לכרטיס תלמיד: תקציר טייצר (מס' כרטיס, סה"כ נטען, טעינה אחרונה,
  // טעינה ממתינה). מודול נפרד מ-cv3Students — אין student_id בטבלה, רק tz,
  // אז לא store.byStudent הרגיל אלא שליפה לפי tz ישירות. ──
  async function forStudent(tz) {
    tz = tz ? String(tz).trim() : '';
    if (!tz) return null;
    const [cr, wr] = await Promise.all([
      window.db.list('taitzer_cards', { eq: { tz } }),
      window.db.list('taitzer_weekly', { eq: { tz } }),
    ]);
    if (!cr.ok || !cr.data || !cr.data.length) return null;   // אין לתלמיד הזה כרטיס טייצר
    return { card: cr.data[0], history: wr.ok ? (wr.data || []) : [] };
  }
  // גלילה פנימית מ-5 שורות ומעלה — אותו דפוס בדיוק כמו cardSection של דרכון
  // (js/passport.js), כדי שכרטיס עם המון שבועות לא ימתח את כל הכרטיס.
  function scrollWrap(html, n) { return n > 5 ? '<div class="det-scroll">' + html + '</div>' : html; }
  function cardSection(data) {
    if (!data) return '';
    const c = data.card;
    const hist = (data.history || []).filter(w => w.exported_at).sort((a, b) => (b.week_no || 0) - (a.week_no || 0));
    const total = hist.reduce((a, w) => a + (Number(w.amount) || 0), 0);
    const extra = Number(c.extra_pending) || 0;
    const head = '<div class="det-sec tx-sec"><h4><i class="bi bi-credit-card-fill"></i> טייצר' +
      (c.card_number ? ' <span class="det-badge">#' + esc(c.card_number) + '</span>' : '') + '</h4>';
    if (!hist.length) {
      return head + '<div class="tl-note" style="padding:6px 2px;font-size:.84rem">עדיין לא נטען לכרטיס זה' +
        (extra > 0 ? ' — <span class="chip warn">+' + extra + ' ₪ ממתין לטעינה הבאה</span>' : '.') + '</div></div>';
    }
    // בקשת יוסף 10/09 ("ואת כל ההיסטוריה גם") — לא רק "טעינה אחרונה" אלא
    // כל שבוע שנטען בפועל, אותו דפוס בדיוק כמו רשימת השבועות בדרכון.
    return head +
      '<div class="det-grid">' +
        '<div class="det-row"><span class="det-lbl">סה״כ נטען עד היום</span><span class="det-val"><strong>' + total + ' ₪</strong></span></div>' +
        (extra > 0 ? '<div class="det-row"><span class="det-lbl">ממתין לטעינה הבאה</span><span class="det-val"><span class="chip warn">+' + extra + ' ₪</span></span></div>' : '') +
      '</div>' +
      scrollWrap(hist.map(w =>
        '<div class="det-item"><span class="di-main">שבוע ' + w.week_no + '</span><span class="di-meta"><strong>' + w.amount + ' ₪</strong></span></div>'
      ).join(''), hist.length) +
    '</div>';
  }
  window.cv3Taitzer = { forStudent, cardSection };
})();
