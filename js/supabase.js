// supabase.js — אתחול חיבור מאובטח ל-Supabase (או מצב הדגמה).
// אין כאן שום סוד: ה-anon key מגיע מ-config.js וה-RLS בצד-שרת הוא ההגנה.
(function () {
  'use strict';
  const c = window.CV3 || {};
  if (c.DEMO) {
    window.sb = null;
    console.info('[cheder-v3] מצב הדגמה — אין חיבור Supabase. הדבק URL+anon key ב-js/config.js כדי להתחבר.');
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    // מוסד חי שבו ספריית הנתונים לא נטענה. בעבר פשוט המשכנו עם sb=null, והמערכת
    // נפלה בשקט למאגר-דמו בזיכרון: המשתמש ראה תלמידי דוגמה, הקליד נתונים אמיתיים,
    // והכול נמחק ברענון. עדיף להיעצר בגלוי מאשר לאבד נתונים בלי שאיש ישים לב.
    window.sb = null;
    window.CV3_LOAD_ERROR = 'ספריית הנתונים לא נטענה';
    console.error('[cheder-v3] supabase-js לא נטענה — עוצר כדי לא לאבד נתונים.');
    return;
  }
  window.sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
})();
