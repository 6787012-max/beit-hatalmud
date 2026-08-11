// sw.js — Service Worker (PWA + offline).
// network-first לנכסי האפליקציה: תיקון/עדכון שנפרס מגיע למשתמש מיד.
// ה-cache משמש רק כגיבוי כשאין רשת. (cache-first עם CACHE קבוע גרם לכך
// שמשתמש שטען את האתר פעם אחת המשיך לקבל את הגרסה הישנה לנצח.)
const CACHE = 'cv3-v8';
const ASSETS = ['./', 'index.html', 'css/main.css', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png',
  'js/config.js', 'js/supabase.js', 'js/api.js', 'js/store.js', 'js/ui.js', 'js/auth.js',
  'js/students.js', 'js/picker.js', 'js/behavior.js', 'js/tracking.js', 'js/dashboard.js',
  'js/admin.js', 'js/cashbox.js', 'js/forms.js', 'js/teacher.js', 'js/tasks.js',
  'js/calendar.js', 'js/staffcard.js', 'js/guide-data.js', 'js/help.js', 'js/yemot.js', 'js/voicereports.js', 'js/app.js',
  'vendor/supabase.js', 'vendor/chart.umd.min.js',
  'vendor/heebo.css', 'vendor/bootstrap-icons.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});
// מנקה גרסאות cache ישנות ותופס שליטה על הלשוניות הפתוחות
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;   // לא לשמור בקשות ל-Supabase/CDN
  e.respondWith(
    // cache:'no-cache' — תמיד מאמת מול השרת (304 אם לא השתנה), כדי שעדכון ייתפס מיד
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        // מרעננים את ה-cache ברקע כדי שמצב אופליין יישאר עדכני
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
