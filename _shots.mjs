// מצלם את המסכים שייכנסו למייל ההדרכה. נכנסים כמנהל כדי שהכל יהיה מלא,
// אבל מצלמים רק מסכים שגם מלמד רואה.
import { chromium } from 'playwright-core';
const BASE = 'https://6787012-max.github.io/beit-hatalmud';
const b = await chromium.launch({ channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'he-IL', deviceScaleFactor: 2 })).newPage();
await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.evaluate(async () => { if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); if (window.caches) for (const k of await caches.keys()) await caches.delete(k); });
await p.reload({ waitUntil: 'networkidle' });

// 1) מסך הכניסה
await p.screenshot({ path: '.local/shots/01-login.png' });

await p.fill('#loginTz', '0556742853'); await p.fill('#loginPw', '6742853');
await p.click('#loginBtn');
await p.waitForFunction(() => !!window.currentUser, null, { timeout: 25000 });
await p.waitForTimeout(3500);
await p.screenshot({ path: '.local/shots/02-home.png' });

const shot = async (page, file, wait = 3000, sel) => {
  await p.evaluate(x => window.showPage(x), page);
  if (sel) await p.waitForSelector(sel, { timeout: 25000 }).catch(() => {});
  await p.waitForTimeout(wait);
  await p.screenshot({ path: '.local/shots/' + file });
};
await shot('attendance', '03-attendance.png', 3000, '#attBody tr');
await shot('behavior', '04-behavior.png', 3000);
await shot('passport', '05-passport.png', 3500, '#pspWrap table');
await shot('readassess', '06-reading.png', 2500);
await shot('medical', '07-medical.png', 3000, '#mdWrap table');

// כרטיס תלמיד
await p.evaluate(() => window.showPage('students'));
await p.waitForSelector('#stuBody tr', { timeout: 20000 });
await p.screenshot({ path: '.local/shots/08-students.png' });
await p.evaluate(() => document.querySelector('#stuBody .name-link').click());
await p.waitForSelector('.modal-card .det-sec', { timeout: 15000 });
await p.waitForTimeout(6000);
await p.screenshot({ path: '.local/shots/09-card.png' });
await p.evaluate(() => document.querySelector('.modal-card .modal-x').click());

// העוזר האישי — עם שאלה אמיתית
await p.evaluate(() => window.cv3AskAI());
await p.waitForSelector('#aihQ', { timeout: 10000 });
await p.fill('#aihQ', 'כמה תלמידים יש בשיעור א ומה אחוז ההגעה שלהם?');
await p.click('#aihSend');
await p.waitForFunction(() => !document.querySelector('#aihWait'), null, { timeout: 90000 }).catch(() => {});
await p.waitForTimeout(1200);
await p.screenshot({ path: '.local/shots/10-assistant.png' });
console.log('OK');
await b.close();
