// shots.mjs — מצלם את כל מצבי המסך שהסרטונים צריכים.
//
// שיטה: צילומי מסך ולא הקלטת וידאו. זה מה שעבד בעבר (_video/make_video2.py):
// Playwright מקליט וידאו דרך ffmpeg משלו שלא מותקן אצלנו, וגם טקסט עברי
// יוצא חד יותר בצילום מלא-רזולוציה מאשר ב-webm דחוס.
//
// כל "סצנה" בסרטון = צילום אחד. לכן יש כאן הרבה מצבים לכל מסך, ולא צילום
// אחד לכל מסך: לפני ואחרי לחיצה, עם סינון, עם קיבוץ, מודאל פתוח וכו'.
//
// הרצה: node video/shots.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'https://6787012-max.github.io/beit-hatalmud';
const DIR = path.resolve('video/shots');
fs.mkdirSync(DIR, { recursive: true });

const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL', deviceScaleFactor: 2 });
const p = await ctx.newPage();
const wait = ms => p.waitForTimeout(ms);
let n = 0;
const shot = async (name, opts) => {
  n++;
  await p.screenshot({ path: path.join(DIR, name + '.png'), ...(opts || {}) });
  console.log('  ' + String(n).padStart(2, '0') + ' ' + name);
};
// צילום ממוקד של אזור אחד — כך אפשר להסביר כפתור בודד בלי שיאבד במסך שלם
const crop = async (name, sel, pad = 24) => {
  const el = await p.$(sel);
  if (!el) { console.log('  (לא נמצא: ' + sel + ')'); return; }
  const bb = await el.boundingBox();
  if (!bb) return;
  const vp = p.viewportSize();
  await shot(name, { clip: {
    x: Math.max(0, bb.x - pad), y: Math.max(0, bb.y - pad),
    width: Math.min(vp.width, bb.width + pad * 2),
    height: Math.min(vp.height, bb.height + pad * 2) } });
};

await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.evaluate(async () => {
  if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
});
await p.reload({ waitUntil: 'networkidle' });
await shot('login');

await p.fill('#loginTz', '0556742853'); await p.fill('#loginPw', '6742853');
await p.click('#loginBtn');
await p.waitForFunction(() => !!window.currentUser, null, { timeout: 30000 });
await wait(3500);
await shot('home');

const go = async (pg, sel, ms = 2500) => {
  await p.evaluate(x => window.showPage(x), pg);
  if (sel) await p.waitForSelector(sel, { timeout: 25000 }).catch(() => {});
  await wait(ms);
};

/* ── נוכחות ── */
await go('attendance', '#attBody tr');
await shot('att-1-full');
await crop('att-2-toolbar', '.toolbar');
await crop('att-3-row', '#attBody tr:nth-child(2)', 12);
await p.click('#attBody tr:nth-child(2) .att-btn.p'); await wait(600);
await p.click('#attBody tr:nth-child(3) .att-btn.l'); await wait(600);
await p.click('#attBody tr:nth-child(4) .att-btn.a'); await wait(900);
await shot('att-4-marked');
await crop('att-5-summary', '#attSum', 14);
const cid = await p.$eval('#attClass', s => s.options[1] && s.options[1].value);
if (cid) { await p.selectOption('#attClass', cid); await wait(1400); await shot('att-6-filtered'); await p.selectOption('#attClass', ''); await wait(700); }
await p.check('#attGroup'); await wait(1600); await shot('att-7-grouped'); await p.uncheck('#attGroup'); await wait(800);
await p.selectOption('#attSort', 'first'); await wait(1200); await shot('att-8-sorted');
await p.selectOption('#attSort', 'family'); await wait(600);

/* ── מעקב ודיווחים ── */
await go('behavior', '#timeline', 3000);
await shot('beh-1-full');
await crop('beh-2-form', '.qr-card', 16);
await crop('beh-3-timeline', '#timeline', 12);

/* ── דרכון ── */
await go('passport', '#pspWrap table', 3200);
await shot('psp-1-full');
await crop('psp-2-toolbar', '.toolbar');
await crop('psp-3-row', '#pspWrap tbody tr:nth-child(2)', 12);
await p.selectOption('#pspView', 'all'); await wait(2200);
await shot('psp-4-summary');
await crop('psp-5-spark', '#pspWrap tbody tr:nth-child(2)', 12);
await p.selectOption('#pspView', 'week'); await wait(1400);

/* ── מעקב קריאה ── */
await go('readassess', '#raClass', 2200);
await p.waitForFunction(() => document.querySelector('#raClass').options.length > 1, null, { timeout: 20000 }).catch(() => {});
const rc = await p.$eval('#raClass', s => s.options[1] && s.options[1].value);
if (rc) { await p.selectOption('#raClass', rc); await wait(2200); }
await shot('rd-1-full');

/* ── רפואי ── */
await go('medical', '#mdWrap table', 3000);
await shot('med-1-allergy');
await crop('med-2-tabs', '#mdTabs', 14);
await p.click('#mdTabs .md-tab[data-tab="מצב רפואי"]').catch(() => {}); await wait(1200);
await shot('med-3-conditions');
await p.click('#mdTabs .md-tab[data-tab="תרופה"]').catch(() => {}); await wait(1400);
await shot('med-4-meds');
await crop('med-5-fresh', '#mdWrap tbody tr:nth-child(1)', 10);

/* ── תלמידים וכרטיס ── */
await go('students', '#stuBody tr', 2600);
await shot('stu-1-list');
await crop('stu-2-toolbar', '.toolbar');
await p.check('#stuGroup'); await wait(1500); await shot('stu-3-grouped'); await p.uncheck('#stuGroup'); await wait(700);
await p.evaluate(() => document.querySelector('#stuBody .name-link').click());
await p.waitForSelector('.modal-card .det-sec', { timeout: 20000 });
await wait(7000);
await shot('stu-4-card');
await p.evaluate(() => { const b = document.querySelector('#stuMoreBtn'); if (b) b.click(); });
await wait(1500);
await shot('stu-5-card-full');
await p.evaluate(() => document.querySelector('.modal-card .modal-x').click());
await wait(800);

/* ── יצוא והדפסה ── */
await go('exporter', '#exSrc', 3000);
await shot('exp-1-full');
await crop('exp-2-toolbar', '.toolbar', 12);
await p.selectOption('#exFit', 'page'); await wait(600);
await p.selectOption('#exPages', '1'); await wait(2500);
await shot('exp-3-fit1');
await p.selectOption('#exPages', '2'); await wait(2500);
await shot('exp-4-fit2');
await p.selectOption('#exFit', ''); await wait(1200);
await p.check('#exSplit'); await wait(2000);
await shot('exp-5-split');
await p.uncheck('#exSplit'); await wait(1000);
await p.selectOption('#exSrc', 'blank').catch(() => {}); await wait(2000);
await shot('exp-6-blank');

/* ── העוזר האישי ── */
await p.evaluate(() => window.cv3AskAI());
await p.waitForSelector('#aihQ', { timeout: 12000 });
await wait(900);
await shot('ai-1-open');
await p.fill('#aihQ', 'טבלה של מספר התלמידים בכל שיעור');
await p.click('#aihSend');
await p.waitForFunction(() => !document.querySelector('#aihWait'), null, { timeout: 90000 }).catch(() => {});
await wait(1500);
await shot('ai-2-answer');

console.log('\n' + n + ' צילומים → video/shots/');
await b.close();
