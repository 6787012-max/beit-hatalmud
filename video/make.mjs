// make.mjs — מייצר סרטון הדרכה למסך אחד: הקלטת מסך אמיתית + קריינות + כתוביות.
//
// למה בסדר הזה: קודם מייצרים את הקריינות ומודדים כמה שנייה כל משפט אורך,
// ורק אז מריצים את הדפדפן — כל סצנה "נעצרת" בדיוק לאורך המשפט שלה.
// כך הקריינות והתמונה מסונכרנות בלי עריכה ידנית.
//
// הרצה:  node video/make.mjs attendance
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'https://6787012-max.github.io/beit-hatalmud';
const KEY = process.argv[2] || 'attendance';
const ROOT = path.resolve('video');
const WORK = path.join(ROOT, '_work', KEY);
const OUT = path.join(ROOT, 'out');
const VOICE = 'he-IL-AvriNeural';
const W = 1600, H = 900;
const PAD = 0.7;                    // שקט קצר בין משפטים, שלא יישמע דחוס

fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const dur = f => parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'csv=p=0', f]).trim());

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes.json'), 'utf8'))[KEY];
if (!cfg) throw new Error('אין הגדרה למסך ' + KEY);

/* ── 1. קריינות ── */
console.log('קריינות…');
const scenes = cfg.scenes.map((s, i) => ({ ...s, mp3: path.join(WORK, `n${String(i).padStart(2, '0')}.mp3`) }));
for (const s of scenes) {
  if (!fs.existsSync(s.mp3)) {
    sh('python', ['-m', 'edge_tts', '--voice', VOICE, '--rate=-5%', '--text', s.say,
      '--write-media', s.mp3]);
  }
  s.dur = dur(s.mp3);
}
let t = 0;
for (const s of scenes) { s.start = t; t += s.dur + PAD; }
const total = t;
console.log(`  ${scenes.length} משפטים · ${total.toFixed(1)} שניות`);

/* ── 2. הקלטת המסך ── */
console.log('מקליט מסך…');
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({
  viewport: { width: W, height: H }, locale: 'he-IL',
  recordVideo: { dir: WORK, size: { width: W, height: H } },
});
const p = await ctx.newPage();
const wait = ms => p.waitForTimeout(ms);
const hold = async s => {              // מחזיק את הסצנה בדיוק לאורך הקריינות
  const ms = Math.round((s.dur + PAD) * 1000) - (Date.now() - s._t0);
  if (ms > 0) await wait(ms);
};

await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.evaluate(async () => {
  if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
});
await p.reload({ waitUntil: 'networkidle' });
await p.fill('#loginTz', '0556742853'); await p.fill('#loginPw', '6742853');
await p.click('#loginBtn');
await p.waitForFunction(() => !!window.currentUser, null, { timeout: 30000 });
await wait(1500);

// סמן עכבר מצויר — הקלטת Playwright לא מצלמת את הסמן האמיתי
await p.addStyleTag({ content: `
  #vidCur{position:fixed;width:22px;height:22px;border-radius:50%;
    background:rgba(183,121,31,.35);border:2px solid #b7791f;z-index:99999;
    pointer-events:none;transition:all .45s cubic-bezier(.4,0,.2,1);opacity:0}
  .vid-ring{position:fixed;border:3px solid #b7791f;border-radius:10px;z-index:99998;
    pointer-events:none;transition:all .4s;box-shadow:0 0 0 4000px rgba(0,0,0,.35)}
`});
await p.evaluate(() => {
  const c = document.createElement('div'); c.id = 'vidCur'; document.body.appendChild(c);
  window.__cur = (x, y) => { const e = document.querySelector('#vidCur'); e.style.opacity = 1; e.style.left = (x - 11) + 'px'; e.style.top = (y - 11) + 'px'; };
  window.__ring = sel => {
    document.querySelectorAll('.vid-ring').forEach(e => e.remove());
    const el = document.querySelector(sel); if (!el) return;
    const r = el.getBoundingClientRect();
    const d = document.createElement('div'); d.className = 'vid-ring';
    d.style.left = (r.left - 5) + 'px'; d.style.top = (r.top - 5) + 'px';
    d.style.width = (r.width + 10) + 'px'; d.style.height = (r.height + 10) + 'px';
    document.body.appendChild(d);
  };
  window.__unring = () => document.querySelectorAll('.vid-ring').forEach(e => e.remove());
});
const point = async sel => {
  const el = await p.$(sel); if (!el) return;
  const bb = await el.boundingBox(); if (!bb) return;
  await p.evaluate(([x, y]) => window.__cur(x, y), [bb.x + bb.width / 2, bb.y + bb.height / 2]);
  await wait(500);
};
const ring = sel => p.evaluate(s => window.__ring(s), sel);
const unring = () => p.evaluate(() => window.__unring());

const ACTIONS = {
  intro: async () => { await p.evaluate(() => window.showPage('home')); await wait(800); },
  goHome: async () => { await p.evaluate(() => window.showPage('home')); await wait(600); await ring('[data-mod="attendance"], .mod-card'); },
  goAttendance: async () => {
    await unring();
    await p.evaluate(() => window.showPage('attendance'));
    await p.waitForSelector('#attBody tr', { timeout: 20000 }); await wait(900);
  },
  focusDate: async () => { await point('#attDate'); await ring('#attDate'); },
  showButtons: async () => { await unring(); await ring('#attBody tr:nth-child(2) .att-cell'); },
  clickPresent: async () => {
    await unring();
    await point('#attBody tr:nth-child(2) .att-btn.p');
    await p.click('#attBody tr:nth-child(2) .att-btn.p'); await wait(700);
    await point('#attBody tr:nth-child(3) .att-btn.p');
    await p.click('#attBody tr:nth-child(3) .att-btn.p'); await wait(700);
  },
  clickLate: async () => {
    await point('#attBody tr:nth-child(3) .att-btn.l');
    await p.click('#attBody tr:nth-child(3) .att-btn.l'); await wait(900);
  },
  showSummary: async () => { await ring('#attSum'); await point('#attSum'); },
  filterClass: async () => {
    await unring(); await point('#attClass'); await ring('#attClass');
    const v = await p.$eval('#attClass', s => s.options[1] && s.options[1].value);
    if (v) { await p.selectOption('#attClass', v); await wait(1200); }
  },
  search: async () => {
    await unring(); await p.selectOption('#attClass', ''); await wait(500);
    await point('#attSearch'); await ring('#attSearch');
    for (const ch of 'לוי') { await p.type('#attSearch', ch, { delay: 260 }); }
    await wait(1200); await p.fill('#attSearch', ''); await wait(700);
  },
  group: async () => {
    await unring(); await point('#attGroup'); await p.check('#attGroup'); await wait(1500);
  },
  sortFirst: async () => {
    await point('#attSort'); await ring('#attSort');
    await p.selectOption('#attSort', 'first'); await wait(1400);
    await p.selectOption('#attSort', 'family'); await wait(900);
  },
  outro: async () => { await unring(); await p.evaluate(() => window.showPage('home')); await wait(900); },
};

for (const s of scenes) {
  s._t0 = Date.now();
  const fn = ACTIONS[s.do];
  if (fn) { try { await fn(); } catch (e) { console.log('  (סצנה ' + s.do + ': ' + e.message + ')'); } }
  await hold(s);
}
await ctx.close();
await b.close();

const webm = fs.readdirSync(WORK).filter(f => f.endsWith('.webm'))
  .map(f => path.join(WORK, f)).sort((a, b2) => fs.statSync(b2).mtimeMs - fs.statSync(a).mtimeMs)[0];
console.log('  וידאו גולמי:', (fs.statSync(webm).size / 1024 / 1024).toFixed(1), 'MB ·',
  dur(webm).toFixed(1), 'שניות');

/* ── 3. פס קול: כל משפט במקום שלו ── */
console.log('שוזר קריינות…');
const aList = path.join(WORK, 'audio.txt');
const inputs = [];
scenes.forEach((s, i) => { inputs.push('-i', s.mp3); });
const delays = scenes.map((s, i) => `[${i}:a]adelay=${Math.round(s.start * 1000)}|${Math.round(s.start * 1000)}[a${i}]`).join(';');
const mixIn = scenes.map((_, i) => `[a${i}]`).join('');
const narration = path.join(WORK, 'narration.m4a');
sh('ffmpeg', ['-y', ...inputs, '-filter_complex',
  `${delays};${mixIn}amix=inputs=${scenes.length}:normalize=0[out]`,
  '-map', '[out]', '-c:a', 'aac', '-b:a', '160k', narration]);

/* ── 4. כתוביות ── */
const ts = x => {
  const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = (x % 60);
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};
const ass = [
  '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', '',
  '[V4+ Styles]',
  'Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  'Style: Sub,Arial,42,&H00FFFFFF,&H00301500,&HB0000000,1,3,0,0,2,60,60,46,177', '',
  '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ...scenes.map(s => `Dialogue: 0,${ts(s.start)},${ts(s.start + s.dur + PAD * 0.6)},Sub,,0,0,0,,${s.sub}`),
].join('\n');
const assFile = path.join(WORK, 'subs.ass');
fs.writeFileSync(assFile, ass, 'utf8');

/* ── 5. מיזוג ── */
console.log('מרנדר…');
const outFile = path.join(OUT, `${cfg.file}.mp4`);
const assPath = assFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
sh('ffmpeg', ['-y', '-i', webm, '-i', narration,
  '-filter_complex', `[0:v]scale=${W}:${H},subtitles='${assPath}'[v]`,
  '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', outFile]);

console.log(`\n✓ ${outFile}`);
console.log(`  ${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB · ${dur(outFile).toFixed(1)} שניות`);
