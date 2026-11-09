"""מצב ערב אסיפת הורים במסך הלובי (18/11/2026).

    evening_mode.py on  [--dry-run]   מעביר את המסך לסרטונים ברצף מתיקיית ההקרנה
    evening_mode.py off [--dry-run]   מחזיר בדיוק את מה ששונה (מהגיבוי) ורק אותו
    evening_mode.py sync [--dry-run]  רק בונה את עותקי החזרה של סרטוני השנה (on עושה את זה בעצמו)

מה משתנה ב-lobby_config (ורק זה):
  display.videoRoot / videoFolders / videosEnabled / videosOnlyOnBreaks
  schedule.byDay["<יום האסיפה>"]  - משבצת אחת "אסיפת הורים" 19:45-23:55 (kind=event).
     בלי זה המסך חושב שהיום נגמר ב-18:00 ולא מנגן שום סרטון (dayOver ב-screen.html).
  kind=event ולא break: אין חלון שקט אקראי, אין תוכנית הפסקות, אין מעבר לשעון "שיעור".

--dry-run: מריץ את אותן פקודות SQL בתוך בלוק שנכשל בכוונה (rollback), ומדפיס את הערכים כפי שהיו נשארים. שום דבר לא נכתב.
הטוקן נקרא בזמן ריצה מ-_CREDENTIALS.md; לא מודפס ולא נשמר.
רץ גם תחת pythonw (בלי חלון): כל הפלט נכתב גם ל-evening_mode.log.
"""
import datetime
import glob
import io
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, 'evening_mode.log')
CRED = os.path.join(os.path.dirname(HERE), '_CREDENTIALS.md')
PROJECT = 'jpcepdbhouuwpjdidqfo'

EVENING_DATE = datetime.date(2026, 11, 18)
JS_DAY = str((EVENING_DATE.weekday() + 1) % 7)          # JS getDay(): ראשון=0 ... רביעי=3

ROOT_FS = 'Z:/סרטונים/תשפז/אסיפת הורים 18-11'
ROOT_CFG = 'Z:\\סרטונים\\תשפז\\אסיפת הורים 18-11'      # בדיוק כך הנגן משווה (בקסלשים)
SRC_DIR = ROOT_FS + '/תשפז-מקור'                        # מקורות השנה. מוסיפים סרטון - מעתיקים לכאן
OUT_DIR = ROOT_FS + '/תשפז-השנה'                        # עותקי חזרה (קישורים קשיחים). נבנה אוטומטית
PREV_DIR = ROOT_FS + '/שנים-קודמות'
FOLDERS = ['תשפז-השנה', 'שנים-קודמות']
COPIES = 6                                              # כמה פעמים כל סרטון של השנה נכנס לסבב
VIDEO_EXT = ('.mp4', '.mov', '.m4v', '.webm', '.mkv')

DISPLAY_NEW = {'videoRoot': ROOT_CFG, 'videoFolders': FOLDERS, 'videosEnabled': True, 'videosOnlyOnBreaks': False}
SLOT = [{'t': '19:45', 'end': '23:55', 'kind': 'event', 'title': 'אסיפת הורים'}]
ABSENT = '__absent__'


def log(msg):
    line = '%s  %s' % (datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), msg)
    try:
        print(line)
    except Exception:
        pass
    try:
        with io.open(LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


# ── גישה למסד ───────────────────────────────────────────────────────────
def token():
    try:
        txt = io.open(CRED, encoding='utf-8').read()
    except OSError:
        txt = ''
    m = re.search(r'sbp_(?:v0_)?[0-9a-f]{40}', txt)
    if not m:
        raise SystemExit('לא נמצא טוקן ניהול ב-_CREDENTIALS.md')
    return m.group()


def run_sql(sql):
    """מחזיר (קוד, גוף). הטוקן לא נכתב לשום מקום."""
    url = 'https://api.supabase.com/v1/projects/%s/database/query' % PROJECT
    payload = json.dumps({'query': sql}, ensure_ascii=False).encode('utf-8')
    tok = token()
    try:
        req = urllib.request.Request(url, data=payload, method='POST', headers={
            'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'evening-mode/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:                                   # נטפרי/תעודות: ניסיון שני עם curl
        log('urllib נכשל (%s) - מנסה curl' % type(e).__name__)
        r = subprocess.run(['curl', '-s', '-w', '\n%{http_code}', '-X', 'POST', url, '-H', 'Authorization: Bearer ' + tok,
                            '-H', 'Content-Type: application/json', '--data-binary', '@-'], input=payload, capture_output=True)
        out = r.stdout.decode('utf-8', 'replace')
        body, _, code = out.rpartition('\n')
        return int(code or 0), body


def read_state():
    code, body = run_sql("select key, value from lobby_config where key in ('display','schedule');")
    if code != 201 and code != 200:
        raise SystemExit('קריאת lobby_config נכשלה: HTTP %s' % code)
    rows = {r['key']: r['value'] for r in json.loads(body)}
    if 'display' not in rows or 'schedule' not in rows:
        raise SystemExit('חסרה שורת display או schedule ב-lobby_config')
    return rows['display'], rows['schedule']


def jlit(v):
    s = json.dumps(v, ensure_ascii=False)
    assert '$j$' not in s
    return '$j$' + s + '$j$::jsonb'


def sql_display_set(vals):
    """vals: מפתח -> ערך, או ABSENT למחיקת המפתח. עדכון אטומי רק של המפתחות האלה."""
    put = {k: v for k, v in vals.items() if v != ABSENT}
    drop = [k for k, v in vals.items() if v == ABSENT]
    expr = 'value'
    for k in drop:
        expr = "(%s - '%s')" % (expr, k.replace("'", "''"))
    if put:
        expr = '(%s || %s)' % (expr, jlit(put))
    return "update lobby_config set value = %s, updated_at = now() where key = 'display';" % expr


def sql_byday_set(day, slots):
    """slots = רשימה, או ABSENT. נוגע רק במפתח byDay[day]."""
    by = "coalesce(value->'byDay', '{}'::jsonb)"
    if slots == ABSENT:
        new_by = "(%s - '%s')" % (by, day)
    else:
        new_by = "(%s || jsonb_build_object('%s', %s))" % (by, day, jlit(slots))
    return ("update lobby_config set value = value || jsonb_build_object('byDay', %s), updated_at = now() "
            "where key = 'schedule';") % new_by


def apply_sql(stmts, dry):
    """dry: בתוך בלוק שנזרק (rollback) ומחזיר את הערכים שהיו נשארים."""
    body = '\n'.join(stmts)
    if not dry:
        code, out = run_sql(body)
        if code not in (200, 201):
            raise SystemExit('כתיבה נכשלה HTTP %s: %s' % (code, out[:300]))
        return None
    probe = ("do $x$ begin %s raise exception 'DRYRUN|%%|%%', "
             "(select value::text from lobby_config where key='display'), "
             "(select value::text from lobby_config where key='schedule'); end $x$;") % body
    code, out = run_sql(probe)
    m = re.search(r'DRYRUN\|(.*)\|(\{.*\})', json.loads(out).get('message', '') if out.startswith('{') else out, re.S)
    if not m:
        raise SystemExit('בדיקת ה-SQL נכשלה (%s): %s' % (code, out[:300]))
    return json.loads(m.group(1)), json.loads(m.group(2))


# ── תיקיית ההקרנה ────────────────────────────────────────────────────────
def copy_name(stem, ext, k):
    return stem + ext if k == 1 else '%s (חזרה %d)%s' % (stem, k, ext)


def sync_copies(dry):
    """לכל סרטון ב-תשפז-מקור: COPIES עותקים ב-תשפז-השנה (קישור קשיח; אם אי אפשר - העתקה). לא מוחק כלום."""
    if not os.path.isdir(SRC_DIR):
        raise SystemExit('חסרה תיקיית המקורות: ' + SRC_DIR)
    srcs = sorted(f for f in os.listdir(SRC_DIR) if f.lower().endswith(VIDEO_EXT))
    missing, made = [], 0
    for f in srcs:
        stem, ext = os.path.splitext(f)
        for k in range(1, COPIES + 1):
            dst = os.path.join(OUT_DIR, copy_name(stem, ext, k))
            if os.path.isfile(dst) and os.path.getsize(dst) == os.path.getsize(os.path.join(SRC_DIR, f)):
                continue
            missing.append(dst)
    log('סנכרון עותקים: %d מקורות x %d = %d קבצים, חסרים %d%s' % (len(srcs), COPIES, len(srcs) * COPIES, len(missing), ' (dry-run)' if dry else ''))
    if dry:
        return len(srcs)
    os.makedirs(OUT_DIR, exist_ok=True)
    for dst in missing:
        stem_k = os.path.basename(dst)
        src = None
        for f in srcs:
            stem, ext = os.path.splitext(f)
            if any(copy_name(stem, ext, k) == stem_k for k in range(1, COPIES + 1)):
                src = os.path.join(SRC_DIR, f)
                break
        if os.path.exists(dst):
            os.remove(dst)      # רק קישור/עותק שלנו שגודלו שונה מהמקור (המקור לא נפגע)
        try:
            os.link(src, dst)
        except OSError:
            shutil.copy2(src, dst)
        made += 1
    log('נוצרו %d עותקים' % made)
    return len(srcs)


def count_videos():
    n = 0
    for d in (OUT_DIR, PREV_DIR):
        if os.path.isdir(d):
            n += sum(1 for f in os.listdir(d) if f.lower().endswith(VIDEO_EXT))
    return n


# ── גיבוי ────────────────────────────────────────────────────────────────
def pending_backup():
    files = sorted(glob.glob(os.path.join(HERE, 'evening_mode_backup_*.json')))
    for p in reversed(files):
        try:
            b = json.load(io.open(p, encoding='utf-8'))
        except Exception:
            continue
        if not b.get('restored_at'):
            return p, b
    return None, None


def show_diff(before, after, title):
    log(title)
    for k in sorted(set(before) | set(after)):
        b, a = before.get(k, ABSENT), after.get(k, ABSENT)
        if b != a:
            log('   %s: %s  ->  %s' % (k, json.dumps(b, ensure_ascii=False), json.dumps(a, ensure_ascii=False)))


def untouched_check(disp0, sched0, disp1, sched1):
    """מוודא שכל מה שלא תכננו לשנות נשאר זהה."""
    bad = [k for k in set(disp0) | set(disp1) if k not in DISPLAY_NEW and disp0.get(k, ABSENT) != disp1.get(k, ABSENT)]
    bad += ['schedule.' + k for k in set(sched0) | set(sched1) if k != 'byDay' and sched0.get(k, ABSENT) != sched1.get(k, ABSENT)]
    b0, b1 = sched0.get('byDay') or {}, sched1.get('byDay') or {}
    bad += ['schedule.byDay.' + k for k in set(b0) | set(b1) if k != JS_DAY and b0.get(k, ABSENT) != b1.get(k, ABSENT)]
    return bad


def cmd_on(dry, force=False):
    # שער זמן: למשימה המתוזמנת יש "הפעל מיד כשהמחשב חוזר", ולכן הפעלה באיחור (למשל למחרת בבוקר)
    # חייבת להיחסם, אחרת המסך יישאר במצב ערב ביום לימודים. --force עוקף (הפעלה ידנית מכוונת).
    now = datetime.datetime.now()
    if not dry and not force and not (now.date() == EVENING_DATE and 18 <= now.hour and (now.hour, now.minute) <= (23, 30)):
        raise SystemExit('on נחסם: מותר רק ב-%s בין 18:00 ל-23:30 (עכשיו %s). להפעלה בכל זאת: --force'
                         % (EVENING_DATE.strftime('%d/%m/%Y'), now.strftime('%d/%m/%Y %H:%M')))
    disp, sched = read_state()
    bp, existing = pending_backup()
    already = all(disp.get(k, ABSENT) == v for k, v in DISPLAY_NEW.items()) and \
        (sched.get('byDay') or {}).get(JS_DAY) == SLOT
    if already and existing:
        log('המצב כבר פעיל (גיבוי ממתין: %s) - אין מה לשנות' % os.path.basename(bp))
        return
    if existing and not dry:
        log('אזהרה: יש גיבוי ממתין שלא שוחזר (%s) - הגיבוי החדש לא יידרס עליו; מצב הגיבוי הישן נשמר' % os.path.basename(bp))
    sync_copies(dry)
    if not dry and count_videos() == 0:
        raise SystemExit('אין סרטונים בתיקיית ההקרנה - לא משנה את המסך')
    before_disp = {k: disp.get(k, ABSENT) for k in DISPLAY_NEW}
    before_slot = (sched.get('byDay') or {}).get(JS_DAY, ABSENT)
    stmts = [sql_display_set(DISPLAY_NEW), sql_byday_set(JS_DAY, SLOT)]
    if not dry:
        stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        path = os.path.join(HERE, 'evening_mode_backup_%s.json' % stamp)
        if existing:                                         # לא מאבדים את הגיבוי המקורי
            path = bp
        else:
            json.dump({'created': datetime.datetime.now().isoformat(timespec='seconds'), 'js_day': JS_DAY,
                       'display_before': before_disp, 'byday_before': before_slot, 'restored_at': None},
                      io.open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            log('גיבוי נשמר: ' + os.path.basename(path))
    res = apply_sql(stmts, dry)
    if dry:
        d2, s2 = res
        bad = untouched_check(disp, sched, d2, s2)
        show_diff(disp, d2, 'DRY-RUN on - שינויים ב-display:')
        log('   schedule.byDay[%s]: %s  ->  %s' % (JS_DAY, json.dumps(before_slot, ensure_ascii=False), json.dumps((s2.get('byDay') or {}).get(JS_DAY), ensure_ascii=False)))
        log('   מפתחות שלא תוכננו ושונו בטעות: %s' % (bad or 'אין'))
    else:
        d2, s2 = read_state()
        show_diff(disp, d2, 'on בוצע - שינויים ב-display:')
        log('   schedule.byDay[%s] הוגדר: %s' % (JS_DAY, json.dumps(SLOT[0]['title'], ensure_ascii=False)))
        log('   מפתחות שלא תוכננו ושונו בטעות: %s' % (untouched_check(disp, sched, d2, s2) or 'אין'))


def cmd_off(dry):
    disp, sched = read_state()
    bp, b = pending_backup()
    simulated = False
    if not b:
        if not dry:
            log('אין גיבוי ממתין לשחזור - לא משנה כלום (אולי off כבר רץ, או on לא רץ)')
            return
        simulated = True                                     # בדיקה יבשה בלי on: מדמה גיבוי מהמצב הנוכחי
        b = {'js_day': JS_DAY, 'display_before': {k: disp.get(k, ABSENT) for k in DISPLAY_NEW},
             'byday_before': (sched.get('byDay') or {}).get(JS_DAY, ABSENT)}
        log('DRY-RUN off: אין גיבוי אמיתי (on טרם רץ) - מדמה גיבוי מהמצב הנוכחי')
    stmts = [sql_display_set(b['display_before']), sql_byday_set(b['js_day'], b['byday_before'])]
    res = apply_sql(stmts, dry)
    if dry:
        d2, s2 = res
        show_diff(disp, d2, 'DRY-RUN off - שינויים ב-display (מול המצב הנוכחי):')
        log('   schedule.byDay[%s]: %s  ->  %s' % (b['js_day'], json.dumps((sched.get('byDay') or {}).get(b['js_day'], ABSENT), ensure_ascii=False),
                                               json.dumps((s2.get('byDay') or {}).get(b['js_day'], ABSENT), ensure_ascii=False)))
        bad = untouched_check(disp, sched, d2, s2)
        log('   מפתחות שלא בגיבוי ושונו: %s' % (bad or 'אין') + (' (סימולציה)' if simulated else ''))
        return
    d2, s2 = read_state()
    show_diff(disp, d2, 'off בוצע - שינויים ב-display:')
    log('   schedule.byDay[%s] שוחזר: %s' % (b['js_day'], json.dumps((s2.get('byDay') or {}).get(b['js_day'], ABSENT), ensure_ascii=False)))
    b['restored_at'] = datetime.datetime.now().isoformat(timespec='seconds')
    json.dump(b, io.open(bp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    log('גיבוי סומן כמשוחזר: ' + os.path.basename(bp))


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    dry = '--dry-run' in argv
    if len(args) != 1 or args[0] not in ('on', 'off', 'sync'):
        print(__doc__)
        return 2
    log('=== evening_mode %s%s ===' % (args[0], ' --dry-run' if dry else ''))
    try:
        if args[0] == 'on':
            cmd_on(dry, force='--force' in argv)
        else:
            {'off': cmd_off, 'sync': lambda d: sync_copies(d)}[args[0]](dry)
    except SystemExit as e:
        log('שגיאה: %s' % e)
        return 1
    except Exception as e:
        log('חריגה: %s: %s' % (type(e).__name__, e))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
