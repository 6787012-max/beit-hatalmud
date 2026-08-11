# cheder-v3 — מערכת מעקב התנהגות ולמידה לתלמוד תורה

בנייה מחדש, **מאובטחת מהיסוד**, **חינמית**, ו**לשכפול** לכל מוסד.
ארכיטקטורה: **GitHub Pages** (אתר) + **Supabase** (נתונים מאובטחים).

---

## 🧭 איך זה מאובטח (וחינם, והכל דרך גיטהב)

- **האתר והקוד** — ב-GitHub Pages (חינם).
- **הנתונים** — ב-Supabase (חינם), במסד פרטי שמוגן ע"י **RLS** — "שומר אבטחה" בצד-שרת שמאלץ:
  מנהל רואה הכל · מורה רק את הכיתות שהוקצו לו · מידע רפואי מוגבל.
- ה-`anon key` שנמצא ב-`js/config.js` **בטוח לפרסום** — הוא לא נותן כלום בלי אישור ה-RLS.
  (זה שונה לגמרי מהמפתח המסוכן של הגרסה הישנה, שפתח הכל.)

---

## 📁 איפה כל דבר נמצא

```
C:\projects\cheder-v3\
├── index.html            ← עמוד הכניסה (GitHub Pages מגיש מהשורש)
├── css/main.css          ← כל העיצוב (RTL, מצב לילה)
├── js/
│   ├── config.js         ← ⚙️ הקובץ היחיד שעורכים לכל מוסד (INSTANCE + פרטי Supabase)
│   ├── supabase.js       ← חיבור מאובטח ל-Supabase (או מצב הדגמה)
│   ├── api.js            ← שכבת נתונים דקה (db.list/insert/update/remove)
│   └── app.js            ← ה-router + בניית האריחים והעמודים
├── supabase/
│   ├── schema.sql        ← הטבלאות (מריצים פעם אחת ב-Supabase)
│   └── policies.sql      ← ה-RLS (שומר האבטחה)
├── manifest.webmanifest  ← PWA
├── .nojekyll             ← GitHub Pages: בלי עיבוד Jekyll
├── README.md
└── SETUP_INSTITUTION.md  ← ✅ מדריך שכפול למוסד חדש
```

---

## 🚀 הרצה מקומית (לבדיקה)

```bash
cd C:/projects/cheder-v3
npm run serve       # → http://127.0.0.1:8090
```
בלי פרטי Supabase ב-`config.js` → האתר עולה ב**מצב הדגמה** (המסכים נראים, בלי נתונים).

---

## 📦 מצב נוכחי — חלק 1/8 (שלד ותשתית) ✅

- מבנה ל-GitHub Pages + חיבור Supabase (עם מצב הדגמה).
- **סכמת Supabase מלאה** (`supabase/schema.sql`): 17 טבלאות + אינדקסים.
- **RLS מלא** (`supabase/policies.sql`): שומר אבטחה — מנהל/מורה-לפי-כיתה/רפואי-מוגבל.
- שלד frontend RTL: header, עמוד בית עם 14 אריחי מודולים, ראוטר, מצב לילה, עמודי ממלאי-מקום.

**הבא בתור:** חלק 2 — אימות (Supabase Auth) + חיווט ההרשאות בפועל.

**לשכפול למוסד חדש:** ראה [SETUP_INSTITUTION.md](SETUP_INSTITUTION.md).
