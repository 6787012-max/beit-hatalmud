// call.js — כפתור "חייג" בכרטיס תלמיד → שיחת PBX (Adel Telecom) להורה, למנהל בלבד.
// הבדיקה כאן (role==='מנהל') היא UX בלבד, לא ביטחון — מי שרוצה יכול לקרוא ל-Worker
// ישירות מ-devtools. ההרשאה האמיתית נבדקת בצד-שרת (worker-call/src/index.js): טוקן
// Supabase + role/active ב-profiles עם service-role, לפני שה-Worker נוגע בכלל ב-PBX.
//
// כתובת ה-Worker: המקור האמיתי הוא CV3.CALL_WORKER_URL (js/config.js), מתעדכן שם בכל
// wrangler deploy של worker-call. הפלייסהולדר כאן הוא רק רשת ביטחון אם config.js לא נטען.
(function () {
  'use strict';
  const CALL_WORKER_URL = (window.CV3 && window.CV3.CALL_WORKER_URL) || 'https://jpcepdbhouuwpjdidqfo.supabase.co/functions/v1/call-parent';

  function buttonHTML(s) {
    if (!s || !s.parent_phone) return '';
    if ((window.currentUser || {}).role !== 'מנהל') return '';
    return '<button class="mini" id="callParentBtn" title="חיוג להורה"><i class="bi bi-telephone-outbound"></i> חייג</button>';
  }

  // נירמול מקומי לצורך חיוג בלבד — טווח 8-11 ספרות, זהה בכוונה ל-normPhone
  // של supabase/functions/call-parent/index.ts. שונה מ-window.cv3NormPhone
  // הגלובלי (js/phone-utils.js, 9-10 ספרות) כי מספרי-בדיקה עצמית (DID, כמו
  // 07722000030 — VOB 11 ספרות, אומת חי 10/09/2026) ארוכים ממספר נייד/קווי
  // רגיל. לא לגעת ב-cv3NormPhone הגלובלי — הוא משמש גם תצוגה (כרטיס תלמיד/צוות)
  // שלא אמורה לשנות התנהגות בגלל צורך צר של פיצ'ר החיוג.
  function normPhoneForDial(v) {
    if (!v) return null;
    let d = String(v).replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.slice(3);
    if (!d.startsWith('0')) d = '0' + d;
    return (d.length >= 8 && d.length <= 11) ? d : null;
  }

  // חיוג בפועל: נירמול → אישור → קריאה ל-Worker → טוסט לפי סטטוס. rawPhone
  // לא חייב להיות מנורמל מראש. משמש גם את wire() למטה (כפתור החיוג בכרטיס
  // תלמיד) וגם את js/quickdial.js (טקסט חופשי + בחירה מרשימת אנשי קשר) —
  // אותו קוד רשת בדיוק לשני הקוראים, כדי שטקסט הטוסטים לא יתפצל בין עותקים.
  // מחזיר true/false להצלחה, לא זורק. snumber הוא קבוע בצד-שרת — לא נשלח
  // מכאן (10/09/2026: התברר שזה לא "שלוחת המחייג", אלא ערך טכני קבוע).
  async function dial(rawPhone) {
    // בדיקת-שפיות בצד לקוח, עוד לפני שנוגעים ברשת — אותו אלגוריתם שה-Worker
    // מריץ שוב בעצמו בצד-שרת (לא סומכים על הלקוח).
    const phone = normPhoneForDial(rawPhone);
    if (!phone) { window.UI.toast('מספר טלפון לא תקין', 'err'); return false; }
    // חיוג אמיתי (וכנראה בתשלום) — קליק בטעות לא יעלה כסף בלי אישור מפורש.
    if (!window.confirm('לחייג למספר ' + phone + '?')) return false;
    try {
      const { data } = await window.sb.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (!token) { window.UI.toast('אין סשן פעיל — יש להתחבר מחדש', 'err'); return false; }
      const res = await fetch(CALL_WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          apikey: window.CV3.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
      });
      if (res.status === 403) { window.UI.toast('אין הרשאת מנהל לחיוג', 'err'); return false; }
      if (res.status === 400) { window.UI.toast('מספר טלפון לא תקין', 'err'); return false; }
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { window.UI.toast('החיוג נכשל' + (d.error ? ': ' + d.error : ''), 'err'); return false; }
      window.UI.toast('מחייג… הטלפון יצלצל קודם');
      return true;
    } catch (e) {
      window.UI.toast('שגיאה בחיוג: ' + (e.message || e), 'err');
      return false;
    }
  }

  function wire(rootEl, s) {
    const btn = rootEl && rootEl.querySelector('#callParentBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const icon = btn.querySelector('i');
      const prevIcon = icon ? icon.className : '';
      btn.disabled = true;
      if (icon) icon.className = 'bi bi-hourglass-split';
      try {
        await dial(s.parent_phone);
      } finally {
        btn.disabled = false;
        if (icon) icon.className = prevIcon;
      }
    });
  }

  window.cv3Call = { buttonHTML, wire, dial };
})();
