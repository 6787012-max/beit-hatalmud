// ai-proxy.js — שכבת-תעבורה אחת לכל קריאות ה-AI במערכת.
//
// למה: עד עכשיו כל קובץ קרא ל-generateContent ישירות מהדפדפן עם מפתח Gemini
// שהיה **מוטמע בקוד הלקוח** (repo ציבורי) — דליפת סוד קלאסית. מעכשיו המפתח
// שמור כסוד צד-שרת (Supabase secret GEMINI_KEY) ופונקציית ה-Edge `ai` היא
// היחידה שנוגעת בו. הלקוח שולח רק model+body, מאומת דרך ה-JWT שלו.
//
// יתרון נלווה: אצל משתמשים שהסינון שלהם חוסם את generativelanguage מהדפדפן
// (קרה לנעמי 1.9.26) — Supabase מאושר אצל כולם, אז ה-AI פשוט עובד.
//
// window.cv3call(model, body, signal) → Response (כמו fetch: יש .ok/.json()).
// גיבוי: אם מנהל הזין מפתח משלו ידנית (localStorage) — קריאה ישירה מהירה,
// ורק אם היא נכשלת ברשת נופלים לפרוקסי. ברירת-המחדל (בלי מפתח מקומי) = פרוקסי.
(function () {
  'use strict';
  var GEN = 'https://generativelanguage.googleapis.com/v1beta/models/';

  // מפתח אופציונלי שהמנהל הזין ידנית. לרוב אין — ואז הכל עובר בפרוקסי.
  function userKey() {
    try {
      var k = localStorage.getItem('cv3_gemini_key') || '';
      return /^AIza[\w-]{20,}$/.test(k) ? k : '';
    } catch (_) { return ''; }
  }

  async function proxy(model, body, signal) {
    var cfg = window.CV3 || {};
    var base = cfg.SUPABASE_URL || '';
    var jwt = '';
    try {
      var s = window.sb && window.sb.auth && (await window.sb.auth.getSession());
      jwt = (s && s.data && s.data.session && s.data.session.access_token) || '';
    } catch (_) {}
    if (!base) throw new Error('חסר חיבור לשרת');
    if (!jwt) throw new Error('צריך להתחבר מחדש כדי להשתמש ב-AI');
    var uk = userKey();  // נשלח רק אם המנהל הזין מפתח משלו; אחרת השרת משתמש בשלו
    var payload = uk ? { model: model, key: uk, body: body } : { model: model, body: body };
    return fetch(base + '/functions/v1/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.SUPABASE_ANON_KEY || '',
        'Authorization': 'Bearer ' + jwt,
      },
      body: JSON.stringify(payload),
      signal: signal,
    });
  }

  // API אחוד. מחזיר Response. model = 'gemini-2.5-flash' וכו'.
  async function cv3call(model, body, signal) {
    var uk = userKey();
    if (uk) {
      // יש מפתח-מנהל מקומי → ניסיון ישיר מהיר, נפילה-לאחור לפרוקסי בכשל רשת.
      try {
        var r = await fetch(GEN + model + ':generateContent?key=' + encodeURIComponent(uk),
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: signal });
        return r;
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        // כשל רשת (כנראה סינון שחוסם את גוגל) → פרוקסי
      }
    }
    return proxy(model, body, signal);
  }

  window.cv3call = cv3call;
})();
