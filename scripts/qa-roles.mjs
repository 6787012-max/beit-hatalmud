// cheder-qa.mjs — ניפוי מקיף לחיידר על ה-build המקומי (מצב הדגמה, בלי לגעת בפרודקשן).
// עובר על כל התפקידים × כל המסכים: הרשאות, מצבי עבודה, שגיאות קונסולה, גלישה, וזרימות כתיבה.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8830';
const SHOTS = process.argv[3] || '_qa-shots';
mkdirSync(SHOTS, { recursive: true });

// מתוך store.js — משתמשי ההדגמה. הסיסמה = הטלפון.
const USERS = [
  ['מנהל', 'עמנואל רקובסקי', '0548451402'],
  ['מחנך', 'משה רביבו', '0583256040'],
  ['מלמד', 'גדליה גורפלד', '0533199345'],
  ['מפקח', 'רמי אברמוביץ', '0556700049'],
  ['מזכירה', 'מירי הולצמן', '02-9931101'],
];

const MODULES = ['behavior', 'attendance', 'tests', 'students', 'medical', 'forms',
  'calendar', 'reports', 'tuition', 'cashbox', 'settings'];

const browser = await chromium.launch();
const findings = [];
const add = (sev, who, what) => findings.push({ sev, who, what });

for (const [role, name, pw] of USERS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he-IL' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 160)));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#loginTz', name);
  await page.fill('#loginPw', pw);
  await page.click('#loginBtn');
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => ({
    user: window.currentUser ? window.currentUser.name : null,
    role: window.currentUser ? window.currentUser.role : null,
    mode: window.Auth ? window.Auth.mode : null,
    bodyClass: document.body.className,
    pwBtn: !!document.querySelector('#pwBtn'),
    logoutBtn: !!document.querySelector('#logoutBtn'),
    tiles: [...document.querySelectorAll('.tile')].map(t => t.dataset.id),
    teacherHome: (() => { const t = document.querySelector('#teacherHome'); return !!t && t.style.display !== 'none'; })(),
  }));

  if (!state.user) { add('חמור', role, 'כניסה נכשלה'); await ctx.close(); continue; }
  if (!state.pwBtn) add('חמור', role, 'אין כפתור שינוי סיסמה בכותרת');

  // שינוי סיסמה — חייב להיות אפשרי לכל תפקיד, גם בצפייה-בלבד
  await page.click('#pwBtn');
  await page.waitForTimeout(400);
  const pwModal = await page.evaluate(() => {
    const c = document.querySelector('.modal-card'); if (!c) return null;
    const s = c.querySelector('[data-act="save"]');
    return { hasSave: !!s, visible: !!s && getComputedStyle(s).display !== 'none' && s.getBoundingClientRect().height > 0 };
  });
  if (!pwModal) add('חמור', role, 'מודאל שינוי סיסמה לא נפתח');
  else if (!pwModal.visible) add('חמור', role, 'כפתור "עדכן סיסמה" קיים אך לא נראה');
  await page.evaluate(() => { const x = document.querySelector('.modal-x'); if (x) x.click(); });
  await page.waitForTimeout(200);

  // כל מסך: האם מותר, האם מרונדר, והאם יש בו יכולת כתיבה בהתאם למצב
  const perScreen = [];
  for (const id of MODULES) {
    const r = await page.evaluate(async (mid) => {
      const allowed = window.Auth.canAccess(mid);
      window.showPage(mid);
      await new Promise(res => setTimeout(res, 700));
      const el = document.getElementById('page-' + mid);
      const active = !!el && el.classList.contains('active');
      const text = el ? (el.innerText || '').trim().length : 0;
      const saveBtns = el ? [...el.querySelectorAll('.btn-primary')]
        .filter(b => getComputedStyle(b).display !== 'none').length : 0;
      const skeleton = el ? !!el.querySelector('.soon-card') : false;
      return { allowed, active, text, saveBtns, skeleton };
    }, id);
    perScreen.push({ id, ...r });

    if (r.allowed && r.active && r.text < 40) add('בינוני', role, `מסך ${id} מורשה אך כמעט ריק (${r.text} תווים)`);
    if (r.allowed && r.active && r.skeleton) add('בינוני', role, `מסך ${id} עדיין שלד ("ייבנה בחלק")`);
    if (!r.allowed && r.active) add('חמור', role, `מסך ${id} אסור אך נפתח בכל זאת`);
    if (state.mode === 'readonly' && r.allowed && r.active && r.saveBtns > 0)
      add('חמור', role, `צפייה-בלבד: ${r.saveBtns} כפתורי שמירה גלויים במסך ${id}`);
  }

  // גלישה אופקית בעמוד הבית
  await page.evaluate(() => window.showPage('home'));
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  if (overflow > 1) add('בינוני', role, `גלישה אופקית בבית: ${overflow}px`);

  await page.screenshot({ path: `${SHOTS}/${role}.png`, fullPage: true }).catch(() => {});
  if (errors.length) add('חמור', role, `${errors.length} שגיאות קונסולה: ${errors.slice(0, 2).join(' | ')}`);

  console.log(`\n=== ${role} (${name}) ===`);
  console.log(`  מצב: ${state.mode} · body="${state.bodyClass || '—'}" · אריחים: ${state.tiles.length} · בית-מורה: ${state.teacherHome}`);
  console.log(`  מסכים מורשים: ${perScreen.filter(s => s.allowed).map(s => s.id).join(', ') || '—'}`);
  console.log(`  שגיאות קונסולה: ${errors.length}`);
  await ctx.close();
}

await browser.close();
console.log('\n\n========== ממצאים ==========');
if (!findings.length) console.log('אין ממצאים.');
for (const f of findings) console.log(`[${f.sev}] ${f.who}: ${f.what}`);
console.log(`\nסה"כ: ${findings.length} · חמורים: ${findings.filter(f => f.sev === 'חמור').length}`);
console.log(`צילומים: ${SHOTS}/`);
