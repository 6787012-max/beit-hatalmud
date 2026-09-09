// phone-utils.js — נירמול מספרי טלפון, מקום אחד (09/09/2026, סריקת קוד: היה
// כפול ב-messaging.js ומוכפל פעמיים בתוך yemot-line.js עצמו — 3 עותקים זהים).
(function () {
  'use strict';
  window.cv3NormPhone = v => {
    if (!v) return null;
    let d = String(v).replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.slice(3);
    if (!d.startsWith('0')) d = '0' + d;
    return (d.length >= 9 && d.length <= 10) ? d : null;
  };
})();
