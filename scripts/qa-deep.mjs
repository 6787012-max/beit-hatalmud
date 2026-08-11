// _deep_qa.mjs — ניפוי עומק: כל מסך, כל כפתור, הזנת נתונים בפועל ואימות שנשמר.
// לא מסתפק ב"המסך נטען" — מזין רשומה בכל טאב שאפשר, סופר לפני ואחרי,
// ומוודא שהיא באמת נכנסה למאגר. כל שגיאת קונסולה נאספת.
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8852';
const findings = [];
const add = (sev, where, what) => findings.push({ sev, where, what });

const USERS = [
  ['מנהל', 'הרב מנהל לדוגמה', '050-0000101'],
  ['מחנך', 'הרב מחנך לדוגמה', '050-0000102'],
  ['מלמד', 'הרב מלמד לדוגמה', '050-0000108'],
  ['מפקח', 'משגיח לדוגמה', '050-0000110'],
  ['מזכירה', 'מזכירות לדוגמה', '050-0000111'],
];

const browser = await chromium.launch();

async function session(role, name, pw, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'he-IL' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 140)));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#loginTz', name); await page.fill('#loginPw', pw);
  await page.click('#loginBtn'); await page.waitForTimeout(1300);
  const ok = await page.evaluate(() => !!window.currentUser);
  if (!ok) { add('חמור', role, 'כניסה נכשלה'); await ctx.close(); return; }
  await fn(page, role);
  if (errs.length) add('חמור', role, `${errs.length} שגיאות קונסולה: ${[...new Set(errs)].slice(0, 2).join(' | ')}`);
  await ctx.close();
}

const count = (page, t) => page.evaluate(tb => window.store.list(tb).then(r => r.length), t);

// ---- כל מסך: נפתח? יש בו תוכן? יש כפתורים שבורים? ----
const SCREENS = ['tasks', 'behavior', 'attendance', 'tests', 'students', 'medical',
  'forms', 'calendar', 'reports', 'tuition', 'cashbox', 'settings'];

await session(...USERS[0], async (page, role) => {
  for (const id of SCREENS) {
    const r = await page.evaluate(async mid => {
      if (!window.Auth.canAccess(mid)) return { skip: true };
      window.showPage(mid);
      await new Promise(s => setTimeout(s, 900));
      const el = document.getElementById('page-' + mid);
      if (!el) return { missing: true };
      const txt = (el.innerText || '').trim();
      const btns = [...el.querySelectorAll('button')].filter(b => getComputedStyle(b).display !== 'none');
      const dead = btns.filter(b => !b.id && !b.className.includes('btn') && !b.dataset.del && !b.dataset.uedit).length;
      return {
        chars: txt.length, buttons: btns.length, dead,
        skeleton: !!el.querySelector('.soon-card'),
        empty: /אין .* עדיין|טוען…/.test(txt) && txt.length < 120,
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      };
    }, id);
    if (r.skip) continue;
    if (r.missing) { add('חמור', role, `מסך ${id} לא קיים ב-DOM`); continue; }
    if (r.skeleton) add('חמור', role, `מסך ${id} עדיין שלד`);
    if (r.chars < 60) add('חמור', role, `מסך ${id} כמעט ריק (${r.chars} תווים)`);
    if (r.overflow > 1) add('בינוני', role, `מסך ${id}: גלישה אופקית ${r.overflow}px`);
    console.log(`  ${id.padEnd(12)} ${String(r.chars).padStart(5)} תווים · ${r.buttons} כפתורים`);
  }
});

// ---- הזנת נתונים אמיתית בכל מודול ----
console.log('\n=== הזנת נתונים ואימות התמדה ===');
await session(...USERS[0], async (page, role) => {

  async function tryAdd(label, table, fn) {
    const before = await count(page, table);
    let err = null;
    try { await fn(); } catch (e) { err = String(e).slice(0, 90); }
    await page.waitForTimeout(1100);
    const after = await count(page, table);
    const ok = after > before;
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(22)} ${before}→${after}${err ? '  ' + err : ''}`);
    if (!ok) add('חמור', role, `${label}: הרשומה לא נשמרה (${table} ${before}→${after})${err ? ' — ' + err : ''}`);
    return ok;
  }

  // התנהגות
  await page.evaluate(() => window.showPage('behavior')); await page.waitForTimeout(900);
  await tryAdd('דיווח התנהגות', 'behavior_events', async () => {
    await page.fill('#page-behavior .pk-search', 'שמואל');
    await page.waitForTimeout(600);
    await page.click('#page-behavior .pk-res-item');
    await page.selectOption('#qCat', { index: 1 });
    await page.fill('#qNote', 'בדיקת ניפוי אוטומטית');
    await page.click('#qSave');
  });

  // נוכחות
  await page.evaluate(() => window.showPage('attendance')); await page.waitForTimeout(900);
  {
    const before = await page.evaluate(() => window.store.list('attendance')
      .then(r => JSON.stringify(r.map(x => x.student_id + ':' + x.status).sort())));
    const b = (await page.$$('#page-attendance .att-btn'))[2];
    if (b) await b.click();
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => window.store.list('attendance')
      .then(r => JSON.stringify(r.map(x => x.student_id + ':' + x.status).sort())));
    const ok = before !== after;
    console.log(`  ${ok ? '✓' : '✗'} ${'סימון נוכחות'.padEnd(22)} ${ok ? 'הסטטוס השתנה' : 'ללא שינוי'}`);
    if (!ok) add('חמור', role, 'סימון נוכחות לא שינה את הרשומה');
  }

  // מבחנים
  await page.evaluate(() => window.showPage('tests')); await page.waitForTimeout(900);
  await tryAdd('רישום מבחן', 'tests', async () => {
    await page.fill('#page-tests .pk-search', 'נחמן');
    await page.waitForTimeout(600);
    await page.click('#page-tests .pk-res-item');
    await page.fill('#page-tests [data-f="subject"]', 'גמרא');
    await page.fill('#page-tests [data-f="grade"]', '88');
    await page.click('#recSave-tests');
  });

  // רפואי
  await page.evaluate(() => window.showPage('medical')); await page.waitForTimeout(900);
  await tryAdd('רישום רפואי', 'medications', async () => {
    const s = await page.$('#page-medical .pk-search');
    await s.click();
    await page.type('#page-medical .pk-search', 'אליהו', { delay: 90 });
    await page.waitForSelector('#page-medical .pk-res-item', { timeout: 8000 });
    await page.click('#page-medical .pk-res-item');
    await page.fill('#page-medical [data-f="kind"]', 'אלרגיה');
    await page.fill('#page-medical [data-f="name"]', 'בדיקת ניפוי');
    await page.click('#recSave-medications');
  });

  // שכר לימוד
  await page.evaluate(() => window.showPage('tuition')); await page.waitForTimeout(1100);
  await tryAdd('רישום שכר לימוד', 'tuition', async () => {
    const s = await page.$('#page-tuition .pk-search');
    if (s) { await s.fill('שמואל'); await page.waitForTimeout(600); await page.click('#page-tuition .pk-res-item'); }
    const amt = await page.$('#page-tuition #tuAmount, #page-tuition [id*="mount"]');
    if (amt) await amt.fill('450');
    const btn = await page.$('#page-tuition .btn-primary');
    if (btn) await btn.click();
  });

  // קופה — הכנסה
  await page.evaluate(() => window.showPage('cashbox')); await page.waitForTimeout(1100);
  await tryAdd('הכנסה בקופה', 'income', async () => {
    await page.fill('#inSrc', 'תרומה לבדיקה');
    await page.fill('#inAmt', '300');
    await page.click('#inSave');
  });

  await tryAdd('הוצאה בקופה', 'expenses', async () => {
    await page.fill('#exName', 'ספק בדיקה');
    await page.fill('#exAmt', '120');
    await page.click('#exSave');
  });

  // הגדרות — קטגוריה חדשה
  await page.evaluate(() => window.showPage('settings')); await page.waitForTimeout(1200);
  await tryAdd('קטגוריה חדשה', 'categories', async () => {
    await page.fill('#newCat', 'קטגוריית בדיקה');
    await page.click('#addCat');
  });
  await tryAdd('כיתה חדשה', 'classes', async () => {
    await page.fill('#newCls', 'כיתת בדיקה');
    await page.click('#addCls');
  });

  // משימות
  await page.evaluate(() => window.showPage('tasks')); await page.waitForTimeout(1200);
  const taskBtn = await page.$('#taskAdd');
  if (taskBtn) {
    await tryAdd('משימה חדשה', 'tasks', async () => {
      await taskBtn.click();
      await page.waitForTimeout(700);
      const ti = await page.$('.modal-card input');
      if (ti) await ti.fill('משימת בדיקה');
      const sv = await page.$('.modal-card [data-act="save"]');
      if (sv) await sv.click();
    });
  } else add('בינוני', role, 'מסך משימות: לא נמצא כפתור הוספה');

  // ייצוא CSV — לא אמור לזרוק
  await page.evaluate(() => window.showPage('behavior')); await page.waitForTimeout(800);
  const dl = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
  await page.click('#behCsv').catch(() => {});
  const d = await dl;
  console.log(`  ${d ? '✓' : '✗'} ייצוא CSV${d ? ' — ' + d.suggestedFilename() : ''}`);
  if (!d) add('בינוני', role, 'ייצוא CSV לא הפיק קובץ');
});

// ---- מזהים כפולים ב-DOM ----
console.log('\n=== תקינות DOM ===');
await session(...USERS[0], async (page, role) => {
  const dup = await page.evaluate(async () => {
    for (const m of window.MODULES) { window.showPage(m.id); await new Promise(s => setTimeout(s, 350)); }
    const seen = {};
    document.querySelectorAll('[id]').forEach(e => { seen[e.id] = (seen[e.id] || 0) + 1; });
    return Object.entries(seen).filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
  });
  console.log('  מזהים כפולים:', dup.length ? dup.join(', ') : 'אין');
  if (dup.length) add('חמור', role, `מזהי DOM כפולים: ${dup.join(', ')}`);
});

// ---- אכיפת הרשאות: מה שאסור באמת חסום ----
console.log('\n=== אכיפת הרשאות ===');
for (const [role, name, pw] of USERS.slice(1)) {
  await session(role, name, pw, async (page, r) => {
    const res = await page.evaluate(async () => {
      const out = { mode: window.Auth.mode, blocked: [], allowed: [] };
      for (const m of window.MODULES) {
        (window.Auth.canAccess(m.id) ? out.allowed : out.blocked).push(m.id);
      }
      // ניסיון עקיפה: לנווט ידנית למסך אסור
      const forb = out.blocked[0];
      if (forb) {
        window.showPage(forb);
        await new Promise(s => setTimeout(s, 700));
        out.bypass = document.getElementById('page-' + forb)?.classList.contains('active') || false;
      }
      return out;
    });
    console.log(`  ${r.padEnd(8)} מצב=${res.mode} · מותר ${res.allowed.length} · חסום ${res.blocked.length}`);
    if (res.bypass) add('חמור', r, `עקיפה: ניווט ידני פתח מסך אסום`);
    if (res.mode === 'readonly') {
      const saves = await page.evaluate(() => [...document.querySelectorAll('.btn-primary')]
        .filter(b => getComputedStyle(b).display !== 'none' && !b.classList.contains('always-on')).length);
      if (saves) add('חמור', r, `צפייה-בלבד: ${saves} כפתורי שמירה גלויים`);
    }
  });
}

await browser.close();
console.log('\n========== ממצאים ==========');
if (!findings.length) console.log('אין ממצאים.');
findings.forEach(f => console.log(`[${f.sev}] ${f.where}: ${f.what}`));
console.log(`\nסה"כ ${findings.length} · חמורים ${findings.filter(f => f.sev === 'חמור').length}`);
