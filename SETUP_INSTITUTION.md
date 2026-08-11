# שכפול המערכת למוסד חדש — צעד אחר צעד

אותו קוד משרת כל מוסד. כדי להקים מוסד חדש (הכל חינם) — 5 צעדים:

---

## 1. עותק של הקוד ל-GitHub (האתר)
- צור repo חדש ב-GitHub (או Fork לריפו הזה).
- העלה את כל הקבצים (index.html, css/, js/, supabase/, manifest, .nojekyll).
- הפעל **GitHub Pages**: Settings → Pages → Source = branch `main`, תיקייה `/ (root)`.
- האתר יעלה בכתובת `https://<user>.github.io/<repo>/`.

## 2. פרויקט Supabase חדש (הנתונים — חינם)
- היכנס ל-[supabase.com](https://supabase.com) → New Project (התוכנית החינמית מספיקה).
- שמור את הסיסמה של ה-DB במקום בטוח.

## 3. הקמת הטבלאות + שומר האבטחה
- ב-Supabase → **SQL Editor**.
- הדבק והרץ את התוכן של `supabase/schema.sql` (הטבלאות).
- הדבק והרץ את התוכן של `supabase/policies.sql` (ה-RLS — שומר האבטחה). **חובה!**

## 4. הגדרת אימות (ת״ז + סיסמה)
המערכת מתחברת עם **ת״ז + סיסמה** (הת״ז ממופה פנימית למייל סינתטי `{תז}@bht.co.il`).
- Supabase → Authentication → Providers → הפעל **Email**.
- **חשוב:** Authentication → Providers → Email → **כבה "Confirm email"** (השדה `Confirm email` = OFF).
  בלי זה כניסה תיכשל, כי אין תיבת מייל אמיתית ל-`@bht.co.il`.

## 5. חיבור הקוד לנתונים
- Supabase → Project Settings → API → העתק את **Project URL** ואת **anon public key**.
- ערוך את `js/config.js`:
  ```js
  INSTANCE: 'maale-amos',
  INSTANCE_NAME: 'תלמוד תורה מעלה עמוס',
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',
  ```
- Commit + Push → GitHub Pages מתעדכן תוך דקה.

---

## הוספת המשתמש הראשון (מנהל)
1. Supabase → **Authentication → Users → Add user**:
   - Email: `000000000@bht.co.il` (הת״ז של המנהל + `@bht.co.il`).
   - Password: בחר סיסמה.
   - סמן **Auto Confirm User**.
2. Supabase → **Table Editor → `profiles`** → מצא את השורה החדשה → מלא:
   - `role` = `מנהל` · `tz` = `000000000` · `name` = השם.
3. היכנס לאתר עם **ת״ז `000000000` + הסיסמה**. מכאן המנהל מוסיף צוות ומקצה כיתות/הרשאות דרך מסך ההגדרות.

> **הוספת צוות נוסף במצב חי:** יצירת חשבון כניסה חדש דורשת הרשאת-שרת. כרגע מוסיפים כל איש צוות
> באותה דרך (Add user + עריכת `profiles`). ניתן להוסיף Edge Function שתאפשר למנהל להוסיף משתמשים
> ישירות מהמסך — בקשו ואבנה.

---

## ✅ למה זה בטוח
- הנתונים ב-Supabase **פרטי** — לא בגיטהב, לא ציבורי.
- ה-`anon key` בקוד בטוח — ה-RLS חוסם כל גישה לא-מורשית **בצד-שרת**.
- כל מוסד = פרויקט Supabase נפרד → הפרדה מלאה בין המוסדות.
