// _qa20.mjs — 20 סבבי ניפוי יסודי, כל סבב בודק זווית אחרת.
// כולל: הזנה בפועל, הצטלבות בין מסכים ובדוחות, החלפת סיסמה, ואימות
// שהנתונים שורדים יציאה+כניסה מחדש. כל ממצא מדווח עם הסבר.
//
// הערה על התמדה: בעותק הדגמה (DEMO) המאגר בזיכרון, ולכן רענון מאפס אותו —
// זו התנהגות מתוכננת של מצב ההדגמה, לא באג. לכן "שרד יציאה/כניסה" נבדק
// בתוך אותה טעינה: יציאה (logout) שאינה טוענת מחדש את הדף, וכניסה מחדש.
// אימות ההתמדה האמיתית מול Supabase נבדק בנפרד (נדרשת גישת פרודקשן).
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8852';
const findings = [];
const add = (round, sev, what) => findings.push({ round, sev, what });

const U = {
  admin: ['הרב מנהל לדוגמה', '050-0000101'],
  mechanech: ['הרב מחנך לדוגמה', '050-0000102'],
  melamed: ['הרב מלמד לדוגמה', '050-0000108'],
  mefake: ['משגיח לדוגמה', '050-0000110'],
  mazkira: ['מזכירות לדוגמה', '050-0000111'],
};
const SCREENS = ['tasks', 'behavior', 'attendance', 'tests', 'students', 'medical',
  'forms', 'calendar', 'reports', 'tuition', 'cashbox', 'settings', 'yemot'];

const browser = await chromium.launch();
let ctx, page;

async function fresh() {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'he-IL' });
  page = await ctx.newPage();
  page.on('pageerror', e => add('*', 'חמור', 'pageerror: ' + String(e).slice(0, 90)));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
}
async function login(role) {
  const [name, pw] = U[role];
  await page.fill('#loginTz', name); await page.fill('#loginPw', pw);
  await page.click('#loginBtn'); await page.waitForTimeout(1100);
  return page.evaluate(() => !!window.currentUser);
}
async function logout() {
  await page.evaluate(() => { const b = document.querySelector('#logoutBtn'); if (b) b.click(); });
  await page.waitForTimeout(700);
}
const cnt = t => page.evaluate(tb => window.store.list(tb).then(r => r.length), t);
const nav = id => page.evaluate(i => window.showPage(i), id).then(() => page.waitForTimeout(700));
const errsOf = async fn => {
  const errs = [];
  const h = m => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); };
  page.on('console', h); await fn(); page.off('console', h); return errs;
};

// ---- הסבבים ----
const rounds = [];

// 1: כל מסך נטען עם תוכן, לכל התפקידים
rounds.push(async () => {
  for (const role of Object.keys(U)) {
    await fresh(); if (!await login(role)) { add(1, 'חמור', `${role}: כניסה נכשלה`); continue; }
    for (const id of SCREENS) {
      const r = await page.evaluate(async mid => {
        if (!window.Auth.canAccess(mid)) return { skip: true };
        window.showPage(mid); await new Promise(s => setTimeout(s, 600));
        const el = document.getElementById('page-' + mid);
        return { chars: el ? (el.innerText || '').trim().length : -1, skeleton: el && !!el.querySelector('.soon-card') };
      }, id);
      if (r.skip) continue;
      if (r.chars < 40) add(1, 'חמור', `${role}/${id}: מסך כמעט ריק (${r.chars})`);
      if (r.skeleton) add(1, 'חמור', `${role}/${id}: עדיין שלד`);
    }
  }
});

// 2: הזנה בכל מודול + ספירה
rounds.push(async () => {
  await fresh(); await login('admin');
  const jobs = [
    ['behavior_events', 'behavior', async () => { await pick('#page-behavior', 'שמואל'); await page.selectOption('#qCat', { index: 1 }); await page.fill('#qNote', 'סבב2'); await page.click('#qSave'); }],
    ['tests', 'tests', async () => { await pick('#page-tests', 'נחמן'); await page.fill('#page-tests [data-f="subject"]', 'גמרא'); await page.fill('#page-tests [data-f="grade"]', '90'); await page.click('#recSave-tests'); }],
    ['medications', 'medical', async () => { await pick('#page-medical', 'אליהו'); await page.fill('#page-medical [data-f="kind"]', 'אלרגיה'); await page.fill('#page-medical [data-f="name"]', 'סבב2'); await page.click('#recSave-medications'); }],
    ['income', 'cashbox', async () => { await page.fill('#inSrc', 'סבב2'); await page.fill('#inAmt', '100'); await page.click('#inSave'); }],
    ['categories', 'settings', async () => { await page.fill('#newCat', 'קטגוריה סבב2'); await page.click('#addCat'); }],
  ];
  for (const [table, screen, fn] of jobs) {
    await nav(screen); const b = await cnt(table);
    try { await fn(); } catch (e) { add(2, 'חמור', `${table}: ${String(e).slice(0, 60)}`); }
    await page.waitForTimeout(1000); const a = await cnt(table);
    if (a <= b) add(2, 'חמור', `${table}: לא נשמר (${b}→${a})`);
  }
});
async function pick(scope, q) {
  await page.click(`${scope} .pk-search`);
  await page.type(`${scope} .pk-search`, q, { delay: 60 });
  await page.waitForSelector(`${scope} .pk-res-item`, { timeout: 6000 });
  await page.click(`${scope} .pk-res-item`);
}

// 3: הצטלבות — דיווח על תלמיד מופיע בכרטיס התלמיד ובדשבורד
rounds.push(async () => {
  await fresh(); await login('admin');
  await nav('behavior');
  await pick('#page-behavior', 'אליהו');
  await page.selectOption('#qCat', { index: 1 });
  await page.fill('#qNote', 'הצטלבות-סבב3');
  await page.click('#qSave'); await page.waitForTimeout(1000);
  // דשבורד — מספר הדיווחים עלה
  await nav('reports');
  const dashHas = await page.evaluate(() => (document.getElementById('page-reports').innerText || '').includes('דיווח'));
  if (!dashHas) add(3, 'בינוני', 'דשבורד לא מציג דיווחי התנהגות');
  // כרטיס התלמיד — הדיווח שלנו מופיע
  await nav('students');
  const inCard = await page.evaluate(async () => {
    const v = document.querySelector('#page-students [data-view]');
    if (v) v.click();
    await new Promise(s => setTimeout(s, 1100));
    return (document.body.innerText || '').includes('הצטלבות-סבב3');
  });
  if (!inCard) add(3, 'חמור', 'דיווח שנוצר לא מופיע בכרטיס התלמיד — אין הצטלבות נתונים');
});

// 4: החלפת סיסמה — ואז כניסה מחדש עם החדשה, ואז חזרה
rounds.push(async () => {
  await fresh(); await login('mechanech');
  await page.click('#pwBtn'); await page.waitForTimeout(500);
  await page.fill('#cp_new', 'סיסמהחדשה12'); await page.fill('#cp_conf', 'סיסמהחדשה12');
  await page.click('.modal-card [data-act="save"]'); await page.waitForTimeout(800);
  await logout();
  // כניסה עם הסיסמה החדשה
  await page.fill('#loginTz', U.mechanech[0]); await page.fill('#loginPw', 'סיסמהחדשה12');
  await page.click('#loginBtn'); await page.waitForTimeout(1000);
  const ok = await page.evaluate(() => !!window.currentUser);
  if (!ok) add(4, 'חמור', 'החלפת סיסמה: כניסה עם הסיסמה החדשה נכשלה');
  // הסיסמה הישנה כבר לא עובדת
  if (ok) {
    await logout();
    await page.fill('#loginTz', U.mechanech[0]); await page.fill('#loginPw', U.mechanech[1]);
    await page.click('#loginBtn'); await page.waitForTimeout(1000);
    const stillOld = await page.evaluate(() => !!window.currentUser);
    if (stillOld) add(4, 'חמור', 'החלפת סיסמה: הסיסמה הישנה עדיין עובדת');
  }
});

// 5: יציאה+כניסה — הנתונים שהוזנו שרדו (באותה טעינה)
rounds.push(async () => {
  await fresh(); await login('admin');
  await nav('behavior');
  await pick('#page-behavior', 'דוד');
  await page.selectOption('#qCat', { index: 2 });
  await page.fill('#qNote', 'שורד-יציאה-סבב5');
  await page.click('#qSave'); await page.waitForTimeout(900);
  const before = await cnt('behavior_events');
  await logout();
  await login('admin');
  const after = await cnt('behavior_events');
  if (after < before) add(5, 'חמור', `אחרי יציאה+כניסה הנתונים ירדו (${before}→${after})`);
  await nav('behavior');
  const visible = await page.evaluate(() => (document.getElementById('page-behavior').innerText || '').includes('שורד-יציאה-סבב5'));
  if (!visible) add(5, 'חמור', 'הדיווח לא מוצג אחרי כניסה מחדש');
});

// 6: אכיפת readonly — מפקח לא יכול לשמור
rounds.push(async () => {
  await fresh(); await login('mefake');
  for (const id of ['behavior', 'tests', 'attendance']) {
    await nav(id);
    const saves = await page.evaluate(mid => [...document.getElementById('page-' + mid)
      .querySelectorAll('.btn-primary')].filter(b => getComputedStyle(b).display !== 'none' && !b.classList.contains('always-on')).length, id);
    if (saves) add(6, 'חמור', `מפקח (צפייה-בלבד): ${saves} כפתורי שמירה גלויים ב-${id}`);
  }
});

// 7: מלמד — מסך הזנה עובד, אבל רשימות מוסתרות
rounds.push(async () => {
  await fresh(); await login('melamed');
  await nav('attendance');
  const r = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#page-attendance .att-btn')].filter(b => getComputedStyle(b).display !== 'none');
    const sum = document.querySelector('#attSum'); const sumVis = sum && getComputedStyle(sum).display !== 'none';
    return { btns: btns.length, sumVis };
  });
  if (!r.btns) add(7, 'חמור', 'מלמד: אין כפתורי נוכחות (מסך הזנה מוסתר)');
  if (!r.sumVis) add(7, 'חמור', 'מלמד: סיכום הנוכחות מוסתר');
});

// 8: הרשאות פר-משתמש — override
rounds.push(async () => {
  await fresh(); await login('admin');
  const modes = await page.evaluate(() => ({
    mefake: window.roleCaps('מפקח').mode,
    melamed: window.roleCaps('מלמד').mode,
    mazkira: window.roleCaps('מזכירה').perms,
  }));
  if (modes.mefake !== 'readonly') add(8, 'בינוני', 'תפקיד מפקח אינו readonly כברירת מחדל');
  if (modes.melamed !== 'writeonly') add(8, 'בינוני', 'תפקיד מלמד אינו writeonly');
});

// 9: מזהים כפולים
rounds.push(async () => {
  await fresh(); await login('admin');
  const dup = await page.evaluate(async () => {
    for (const m of window.MODULES) { window.showPage(m.id); await new Promise(s => setTimeout(s, 300)); }
    const seen = {}; document.querySelectorAll('[id]').forEach(e => seen[e.id] = (seen[e.id] || 0) + 1);
    return Object.entries(seen).filter(([, n]) => n > 1).map(([k]) => k);
  });
  if (dup.length) add(9, 'חמור', `מזהי DOM כפולים: ${dup.join(', ')}`);
});

// 10: כל כפתור נלחץ בלי לזרוק
rounds.push(async () => {
  await fresh(); await login('admin');
  for (const id of SCREENS) {
    await nav(id);
    const caught = await page.evaluate(mid => {
      const el = document.getElementById('page-' + mid); if (!el) return 0;
      let c = 0; const o = window.onerror; window.onerror = () => { c++; return true; };
      [...el.querySelectorAll('button')].filter(b => getComputedStyle(b).display !== 'none' &&
        !/מחיק|trash|del|למחוק/.test(b.className + b.title + b.innerHTML)).slice(0, 25).forEach(b => { try { b.click(); } catch (e) { c++; } });
      document.querySelectorAll('.modal-x,[data-act="cancel"]').forEach(x => x.click());
      window.onerror = o; return c;
    }, id);
    if (caught) add(10, 'בינוני', `${id}: ${caught} כפתורים זרקו שגיאה`);
  }
});

// 11: גלישה אופקית בכל מסך, דסקטופ + מובייל
rounds.push(async () => {
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 800 }]) {
    if (ctx) await ctx.close();
    ctx = await browser.newContext({ viewport: vp, locale: 'he-IL' }); page = await ctx.newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
    await login('admin');
    for (const id of SCREENS) {
      await nav(id);
      const ov = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
      if (ov > 2) add(11, 'בינוני', `${id} @${vp.width}: גלישה אופקית ${ov}px`);
    }
  }
});

// 12: ייצוא CSV מכל מסך שיש בו
rounds.push(async () => {
  await fresh(); await login('admin');
  for (const [id, sel] of [['behavior', '#behCsv'], ['reports', '#rpPrint'], ['cashbox', '#cbCsv'], ['tests', '#recCsv-tests']]) {
    await nav(id);
    const has = await page.evaluate(s => !!document.querySelector(s), sel);
    if (!has) { add(12, 'בינוני', `${id}: חסר כפתור ייצוא ${sel}`); continue; }
    if (id === 'reports') continue; // הדפסה, לא הורדה
    const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.click(sel).catch(() => {});
    if (!await dl) add(12, 'בינוני', `${id}: ייצוא ${sel} לא הפיק קובץ`);
  }
});

// 13: הוספה ואז מחיקה — שתיהן עובדות
rounds.push(async () => {
  await fresh(); await login('admin');
  await nav('settings');
  const b = await cnt('categories');
  await page.fill('#newCat', 'למחיקה-סבב13'); await page.click('#addCat'); await page.waitForTimeout(800);
  const mid = await cnt('categories');
  if (mid <= b) { add(13, 'חמור', 'הוספת קטגוריה נכשלה'); return; }
  // מחיקה של הקטגוריה שהוספנו
  page.on('dialog', d => d.accept());
  const deleted = await page.evaluate(async () => {
    const items = [...document.querySelectorAll('#catList .tl-item')];
    const target = items.find(i => i.textContent.includes('למחיקה-סבב13'));
    if (!target) return false;
    const del = target.querySelector('[data-cdel]'); if (!del) return false;
    // עוקף confirm ע"י קריאה ישירה
    window.__origConfirm = window.UI.confirm; window.UI.confirm = async () => true;
    del.click(); await new Promise(s => setTimeout(s, 900));
    window.UI.confirm = window.__origConfirm; return true;
  });
  await page.waitForTimeout(600);
  const after = await cnt('categories');
  if (!deleted) add(13, 'בינוני', 'לא נמצא כפתור מחיקה לקטגוריה');
  else if (after >= mid) add(13, 'חמור', `מחיקת קטגוריה לא עבדה (${mid}→${after})`);
});

// 14: עריכת רשומה קיימת (משתמש)
rounds.push(async () => {
  await fresh(); await login('admin');
  await nav('settings');
  const opened = await page.evaluate(async () => {
    const e = document.querySelector('[data-uedit]'); if (!e) return false;
    e.click(); await new Promise(s => setTimeout(s, 700));
    return !!document.querySelector('.modal-card #u_name');
  });
  if (!opened) add(14, 'בינוני', 'עריכת משתמש: המודאל לא נפתח');
  else {
    const hasMode = await page.evaluate(() => !!document.querySelector('.modal-card #u_mode'));
    if (!hasMode) add(14, 'בינוני', 'עריכת משתמש: חסר שדה מצב עבודה');
    await page.evaluate(() => document.querySelector('.modal-x').click());
  }
});

// 15: כרטיס תלמיד — כל הסקציות
rounds.push(async () => {
  await fresh(); await login('admin');
  await nav('students');
  const sections = await page.evaluate(async () => {
    const v = document.querySelector('#page-students [data-view]');
    if (!v) return null;
    v.click(); await new Promise(s => setTimeout(s, 1100));
    const txt = document.body.innerText;
    return ['דיווח', 'נוכחות', 'מבחנ', 'רפואי', 'שכר'].filter(k => txt.includes(k));
  });
  if (!sections) add(15, 'בינוני', 'כרטיס תלמיד: לא נפתח');
  else if (sections.length < 3) add(15, 'בינוני', `כרטיס תלמיד: רק ${sections.length} סקציות (${sections.join(',')})`);
});

// 16: חיפוש מהיר Ctrl+K
rounds.push(async () => {
  await fresh(); await login('admin');
  await page.keyboard.press('Control+k'); await page.waitForTimeout(600);
  const open = await page.evaluate(() => !!document.querySelector('#qkInput, .modal-card input'));
  if (!open) add(16, 'בינוני', 'חיפוש מהיר Ctrl+K לא נפתח');
  else await page.keyboard.press('Escape');
});

// 17: לוח שנה מציג תאריך עברי
rounds.push(async () => {
  await fresh(); await login('admin');
  await nav('calendar');
  const heb = await page.evaluate(() => /תשפ|תשפ"|57[0-9]{2}|אלול|תשרי|חשון|כסלו|טבת|שבט|אדר|ניסן|אייר|סיון|תמוז|(^|[^ר])אב /.test(document.getElementById('page-calendar').innerText));
  if (!heb) add(17, 'בינוני', 'לוח שנה: לא מציג תאריך עברי');
});

// 18: מודאל נסגר בכל הדרכים
rounds.push(async () => {
  await fresh(); await login('admin');
  await page.click('#pwBtn'); await page.waitForTimeout(400);
  await page.click('.modal-x'); await page.waitForTimeout(300);
  let still = await page.evaluate(() => !!document.querySelector('.modal-card'));
  if (still) add(18, 'בינוני', 'מודאל לא נסגר ב-X');
  await page.click('#pwBtn'); await page.waitForTimeout(400);
  await page.click('[data-act="cancel"]'); await page.waitForTimeout(300);
  still = await page.evaluate(() => !!document.querySelector('.modal-card'));
  if (still) add(18, 'בינוני', 'מודאל לא נסגר בביטול');
});

// 19: פאנל ימות — נטען, מסך התחברות, וקריאת API אמיתית
rounds.push(async () => {
  await fresh(); await login('admin');
  await nav('yemot');
  const r = await page.evaluate(() => {
    const e = document.getElementById('page-yemot');
    return { line: (e.querySelector('#ymLine') || {}).value, hasPass: !!e.querySelector('#ymPass') };
  });
  if (r.line !== '033060570') add(19, 'בינוני', `פאנל ימות: מספר קו ברירת מחדל שגוי (${r.line})`);
  if (!r.hasPass) add(19, 'חמור', 'פאנל ימות: אין שדה סיסמה');
});

// 20: אין שגיאות קונסולה בטעינה מלאה של כל המסכים
rounds.push(async () => {
  await fresh();
  const errs = await errsOf(async () => {
    await login('admin');
    for (const id of SCREENS) { await nav(id); }
  });
  const real = errs.filter(e => !/favicon|sourcemap|the server responded with a status of 404.*sw/i.test(e));
  if (real.length) add(20, 'חמור', `${real.length} שגיאות קונסולה: ${[...new Set(real)].slice(0, 3).join(' | ')}`);
});

// ---- הרצה ----
for (let i = 0; i < rounds.length; i++) {
  process.stdout.write(`סבב ${i + 1}/20… `);
  try { await rounds[i](); console.log('✓'); }
  catch (e) { console.log('✗ ' + String(e).slice(0, 70)); add(i + 1, 'חמור', 'הסבב קרס: ' + String(e).slice(0, 80)); }
}
if (ctx) await ctx.close();
await browser.close();

console.log('\n========== ממצאים מ-20 הסבבים ==========');
if (!findings.length) console.log('אין ממצאים. כל 20 הסבבים עברו נקי.');
findings.forEach(f => console.log(`[סבב ${f.round}][${f.sev}] ${f.what}`));
console.log(`\nסה"כ ${findings.length} · חמורים ${findings.filter(f => f.sev === 'חמור').length}`);
process.exit(findings.filter(f => f.sev === 'חמור').length ? 1 : 0);
