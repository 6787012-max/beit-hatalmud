# דיווח קולי — שלוחה 9 בקו 0733518751

איש צוות מתקשר, אומר את שמו · שם התלמיד · הדיווח — וזה נכנס למערכת.

## למה זה בנוי כך

**דרישה:** שיעבוד גם כשהמחשב של יוסף כבוי.
לכן אין כאן שום סקריפט מקומי: השלוחה יושבת בימות, והעיבוד רץ ב-Cloudflare
Worker לפי cron בענן.

## החלקים

| מה | איפה | תפקיד |
|---|---|---|
| `ext9/ext.ini` | ימות, שלוחה 9 | מקליטה, שומרת בתיקייה, ושולחת עותק+תמלול למייל המכינה |
| `ext9/WhiteList.ini` | ימות | רק טלפוני הצוות. **בלי הקובץ הזה `white_list=yes` חוסם את כולם** |
| `ext9/000.tts` | ימות | ההנחיה שנשמעת לפני הצפצוף |
| `worker/` | Cloudflare | כל 5 דק׳: מושך הקלטות חדשות → Gemini (תמלול+סיווג) → טיוטה ב-Supabase |

## שני דברים שנשמרו בכוונה

1. **הדיווח נכנס כטיוטה, לא ישר לכרטיס.** המודל יכול לשמוע "יעקבסון"
   ולהחליט "יעקב רוזן". דיווח על תלמיד לא נכנס למערכת בלי עין אנושית.
2. **המייל הוא גיבוי.** גם אם ה-Worker ייפול לגמרי, ההקלטה והתמלול
   מגיעים לתיבת המכינה ואפשר לטפל ידנית.

## התקנה

```
cd yemot/worker
wrangler secret put YM_USER        # 0733518751
wrangler secret put YM_PASS
wrangler secret put SB_URL
wrangler secret put SB_SERVICE_KEY
wrangler secret put GEMINI_KEY
wrangler secret put RUN_KEY
wrangler deploy
```
בדיקה ידנית: `https://bht-voice-reports.<account>.workers.dev/run?key=<RUN_KEY>`
