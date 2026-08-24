// מריץ את המילוי האוטומטי על כל 37 התלמידים ושומר טיוטות.
// לא כותב לשום תיק — רק ל-tla_profile_drafts.
import { chromium } from 'playwright-core';
const BASE = 'https://6787012-max.github.io/beit-hatalmud';
const b = await chromium.launch({ channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'he-IL' })).newPage();
p.setDefaultTimeout(0);
await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.evaluate(async () => { if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); if (window.caches) for (const k of await caches.keys()) await caches.delete(k); });
await p.reload({ waitUntil: 'networkidle' });
await p.fill('#loginTz', '0556742853'); await p.fill('#loginPw', '6742853');
await p.click('#loginBtn');
await p.waitForFunction(() => !!window.currentUser, null, { timeout: 30000 });
await p.exposeFunction('report', (i, n, name, st) => {
  if (st.indexOf('עובד') !== 0) console.log(`  ${String(i).padStart(2)}/${n}  ${name.padEnd(24)} ${st}`);
});
console.log('מתחיל…\n');
const res = await p.evaluate(async () => {
  const all = await window.cv3Students.getStudents();
  return await window.cv3TlaAutofill.runAll(all, (i, n, name, st) => window.report(i, n, name, st), () => false);
});
console.log(`\nהסתיים · ${res.done.length} טיוטות · ${res.failed.length} נכשלו`);
if (res.failed.length) { console.log('\nכשלים:'); res.failed.forEach(f => console.log('  ' + f.name + ' — ' + f.why)); }
await b.close();
