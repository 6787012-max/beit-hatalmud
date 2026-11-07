"""
lobby_server.py — שרת מקומי למסך הלובי של מכינת בית התלמוד.

מה הוא עושה:
  • מגיש את מסך הלובי (screen.html) ואת הנכסים שלו (פונט, אייקונים, לוגו).
  • מגיש את קבצי הווידאו מהתיקייה שהוגדרה — עם תמיכה ב-Range (דילוג וסטרימינג).
  • חושף API קטן שמסך הלובי משתמש בו כדי ליישר את התיקייה/תת־התיקיות
    לפי מה שהוגדר בפאנל שבאתר.

הגדרות התצוגה עצמן (סדר יום, תפריט, הודעות) *אינן* כאן — הן בענן, ונערכות
בפאנל "מסך הלובי" באתר. הקובץ lobby_config.json שומר רק את נתיב הסרטונים.

הרצה:  pythonw lobby_server.py      כתובת:  http://localhost:8484
"""
import datetime
import http.server
import json
import mimetypes
import os
import socketserver
import sys
import urllib.parse
import threading
import time

PORT = 8484
# מונה השמעות (23/10/2026): pool/rel -> {count, last}. נכתב אטומית (קובץ זמני ואז replace) תחת מנעול.
COUNTS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'play_counts.json')
_COUNTS_LOCK = threading.Lock()


def _load_counts():
    try:
        with open(COUNTS_PATH, 'r', encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def record_play(pool, rel):
    key = str(pool) + '/' + str(rel)
    with _COUNTS_LOCK:
        d = _load_counts()
        e = d.get(key) if isinstance(d.get(key), dict) else {}
        e = {'count': int(e.get('count', 0)) + 1, 'last': time.time()}
        d[key] = e
        tmp = COUNTS_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, COUNTS_PATH)
    return e


SIACH_FILE = 'D:/video-projects/siach-meorer/daily/lobby_siach.json'   # נכתב ע"י הצינור של שיח הבוקר/הצהריים (סיכום בעברית בלבד, בלי שמות)
def siach_payload(max_days=7, max_entries=4):
    """המסרים האחרונים מהשיח (עד 7 ימים, החדש קודם). קובץ חסר/פגום = רשימה ריקה."""
    try:
        with open(SIACH_FILE, 'r', encoding='utf-8') as f:
            items = json.load(f).get('items', [])
        today = datetime.date.today()
        keep = []
        for it in items:
            try:
                age = (today - datetime.date.fromisoformat(it['date'])).days
            except Exception:
                continue
            if 0 <= age <= max_days and it.get('points'):
                keep.append(it)
        keep.sort(key=lambda x: (x['date'], 1 if x.get('session') == 'צהריים' else 0), reverse=True)
        return {'items': keep[:max_entries]}
    except Exception:
        return {'items': []}

def program_payload():
    """program_lists() + meta: לכל סרטון (המפתח = pool/rel, כמו ברשימות) mtime בשניות ו-plays/last מהמונה."""
    out = program_lists()
    counts = _load_counts()
    meta = {}
    for pool, items in list(out.items()):
        root = PROG_SRC.get(pool)
        for rel in items:
            sub = rel[len(pool) + 1:]
            try:
                mt = os.path.getmtime(os.path.join(root, sub.replace('/', os.sep)))
            except Exception:
                mt = 0
            c = counts.get(rel) if isinstance(counts.get(rel), dict) else {}
            meta[rel] = {'mtime': mt, 'plays': int(c.get('count', 0)), 'last': c.get('last', 0)}
    out['meta'] = meta
    return out

VIDEO_EXTENSIONS = {'.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v'}
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(SCRIPT_DIR)                      # שורש האתר (vendor/, img/, css/)
CONFIG_PATH = os.path.join(SCRIPT_DIR, 'lobby_config.json')
DEFAULT_VIDEO_DIR = r'Z:\סרטונים'
STATIC_DIRS = ('vendor', 'img', 'css')
BECH_DIR = r'C:\projects\mechina-bechirot'                 # בוחרים לצמוח — ר' /bech/ ב-do_GET
# תוכנית ההפסקות (יוסף 18/10/2026): שיח מעורר ← 10 שניות הסבר ← מושג בגמרא עם ר' אלי סטפנסקי.
# מקורות קבועים, נפרדים מבחירת התיקיות בפאנל — יש בהם רק חומר שהוכן למסך:
#   siach    — קבצים שיושבים ישירות בתיקייה (את השבוע הקודם מעבירים לתת־תיקייה "ארכיון" והוא יוצא מהסבב)
#   concepts — תיקיית הפרסום של סרטוני המושגים: סרטון אחד בכל תת־תיקייה "NN - שם"; מושג חדש נכנס לבד
#   lashon / shabbat — סרטון הלכה יומי בתחילת ההפסקה הראשונה / השנייה של היום (קבצי "NN - שם.mp4" ישירות בתיקייה;
#                      התיקייה יכולה להיות ריקה או חסרה — אז מדלגים בשקט). הבחירה לפי תאריך במסך (screen.html)
PROG_SRC = {'siach': 'Z:/סרטונים/מסך הלובי - הפסקות/שיח מעורר',
            'concepts': 'Z:/מושגים בגמרא - סרטונים',
            'lashon': 'Z:/הלכה בלובי/שמירת הלשון - חפץ חיים',
            'shabbat': 'Z:/הלכה בלובי/הלכות שבת',
            'fried': 'Z:/הלכה בלובי/הלכה יומית - הרב פריד',   # fried — כנ"ל, בתחילת ההפסקה השלישית של היום
            'boker': 'Y:/שיעורים בבוקר'}   # boker — שיח הבוקר של אתמול, בתחילת ארוחת הבוקר (09:25); ר' _boker_latest


BOKER_FROM = '2026-11-01'   # first recording day whose film follows the no-human-figures rule


def _boker_latest():
    """שיח הבוקר (יוסף 01/11/2026): הסרטון של יום ההקלטה האחרון שלפני היום — "<date>/שיח הבוקר - <date>.mp4".
    ביום ראשון זה של שישי. רשימה של פריט אחד לכל היותר; תיקייה חסרה/ריקה = רשימה ריקה.
    BOKER_FROM: רק סרטים שנבנו בלי דמויות אדם (יוסף 01/11/2026: "לא לעשות דמויות בכלל") — הישנים לא עולים ללובי."""
    root, today = PROG_SRC['boker'], time.strftime('%Y-%m-%d')
    try:
        days = sorted((d for d in os.listdir(root) if len(d) == 10 and BOKER_FROM <= d < today and os.path.isdir(os.path.join(root, d))), reverse=True)
    except Exception:
        return []
    for d in days[:10]:
        f = 'שיח הבוקר - ' + d + '.mp4'
        if os.path.isfile(os.path.join(root, d, f)):
            return ['boker/' + d + '/' + f]
    return []


def _videos_in(d):
    try:
        return sorted(f for f in os.listdir(d)
                      if os.path.splitext(f)[1].lower() in VIDEO_EXTENSIONS and os.path.isfile(os.path.join(d, f)))
    except Exception:
        return []


def program_lists():
    out = {'siach': ['siach/' + f for f in _videos_in(PROG_SRC['siach'])], 'concepts': [],
           'lashon': ['lashon/' + f for f in _videos_in(PROG_SRC['lashon'])],
           'shabbat': ['shabbat/' + f for f in _videos_in(PROG_SRC['shabbat'])],
           'fried': ['fried/' + f for f in _videos_in(PROG_SRC['fried'])],
           'boker': _boker_latest()}
    root = PROG_SRC['concepts']
    try:
        subs = sorted(x for x in os.listdir(root) if os.path.isdir(os.path.join(root, x)))
    except Exception:
        subs = []
    for sub in subs:
        # כל סרטון מוכן בכל תיקיית מושג (19/10: "כל הסרטונים שנהיו מוכנים") — לא רק הראשון
        out['concepts'] += ['concepts/' + sub + '/' + v for v in _videos_in(os.path.join(root, sub))]
    return out


def load_config():
    if os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            if isinstance(cfg, dict):
                cfg.setdefault('root', DEFAULT_VIDEO_DIR)
                if not isinstance(cfg.get('selected'), list):
                    cfg['selected'] = []
                return cfg
        except Exception as e:
            print('שגיאה בקריאת ההגדרות:', e)
    return {'root': DEFAULT_VIDEO_DIR, 'selected': []}


def save_config(cfg):
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def list_subfolders(root):
    if not os.path.isdir(root):
        return []
    try:
        return sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))
    except Exception:
        return []


def collect_videos(root, selected):
    """כל הסרטונים תחת root. selected ריק = הכל; אחרת רק תת־התיקיות שנבחרו
    ('__root__' מוסיף גם קבצים שיושבים ישירות בשורש)."""
    out = []
    if not os.path.isdir(root):
        return out
    sel = set(selected or [])
    for cur, dirs, files in os.walk(root):
        rel_dir = os.path.relpath(cur, root).replace('\\', '/')
        if sel:
            if rel_dir == '.':
                if '__root__' not in sel:
                    files = []
            elif rel_dir.split('/')[0] not in sel:
                continue
        for f in files:
            if os.path.splitext(f)[1].lower() in VIDEO_EXTENSIONS:
                out.append(f if rel_dir == '.' else rel_dir + '/' + f)
    return out


def inside(root, path):
    """הגנה מפני יציאה מהתיקייה. commonpath ולא startswith — כדי ש-'Z:\\vid2'
    לא ייחשב כנמצא בתוך 'Z:\\vid'."""
    try:
        return os.path.commonpath([os.path.normcase(os.path.abspath(root)),
                                   os.path.normcase(os.path.abspath(path))]) == \
               os.path.normcase(os.path.abspath(root))
    except Exception:
        return False



def _brit_active():
    """מסך הברית (brit_mode.html) מוגש במקום המסך הרגיל עד 'until' ב-brit_mode.json (יוסף 06/11/2026)."""
    try:
        meta = json.load(open(os.path.join(SCRIPT_DIR, 'brit_mode.json'), encoding='utf-8'))
        f = os.path.join(SCRIPT_DIR, 'brit_mode.html')
        if os.path.exists(f) and time.time() < float(meta.get('until', 0)):
            return f
    except Exception:
        pass
    return None


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'LobbyScreen/2.0'

    # ── עזרים ────────────────────────────────────────────────────────────
    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode('utf-8'))
        except Exception:
            try:
                return dict(urllib.parse.parse_qsl(raw.decode('utf-8')))
            except Exception:
                return {}

    def _file(self, path, ctype=None, cache='no-store'):
        if not os.path.isfile(path):
            self.send_error(404, 'Not found')
            return
        with open(path, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype or (mimetypes.guess_type(path)[0] or 'application/octet-stream'))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', cache)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    # ── GET ──────────────────────────────────────────────────────────────
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        query = urllib.parse.parse_qs(parsed.query)
        cfg = load_config()

        if path == '/api/config':
            self._json(200, {'root': cfg['root'], 'selected': cfg['selected'],
                             'rootExists': os.path.isdir(cfg['root'])})
            return
        if path == '/api/folders':
            root = (query.get('path') or [cfg['root']])[0]
            self._json(200, {'root': root, 'exists': os.path.isdir(root), 'folders': list_subfolders(root)})
            return
        if path == '/api/videos':
            videos = collect_videos(cfg['root'], cfg['selected'])
            if (query.get('meta') or [None])[0] == '1':
                self._json(200, {'root': cfg['root'], 'selected': cfg['selected'],
                                 'count': len(videos), 'videos': videos})
            else:
                self._json(200, videos)
            return
        if path.startswith('/video/'):
            self.serve_video(cfg['root'], path[len('/video/'):])
            return
        if path == '/api/version':   # המסך טוען את עצמו מחדש כשהקובץ הזה משתנה (בלי לגשת למחשב הלובי)
            self._json(200, {'v': str(os.path.getmtime(_brit_active() or os.path.join(SCRIPT_DIR, 'screen.html'))) + ('b' if _brit_active() else '')})
            return
        if path == '/api/program':
            self._json(200, program_payload())
            return
        if path == '/api/siach':   # מסרים מהשיח של הרב וינברג (07/11/2026)
            self._json(200, siach_payload())
            return
        # בוחרים לצמוח (28/10/2026): תוצאות + פוסטרים + תמונות, ישר מהדיסק של שרת הבחירות.
        # התמונות לא נכנסות לריפו (הוא ציבורי) — הן מוגשות מכאן בלבד, ולכן גם כשהשרת ב-8585 כבוי.
        if path == '/bech/state':
            try:
                with open(os.path.join(BECH_DIR, 'state.json'), 'r', encoding='utf-8') as f:
                    st = json.load(f)
                self._json(200, {k: st.get(k) for k in ('voted', 'of', 'yellow', 'green', 'classes', 'invalid')})
            except Exception:
                self._json(200, {})
            return
        if path.startswith('/bech/'):
            parts = [p for p in path[len('/bech/'):].split('/') if p and p != '..']
            ok = (parts == ['emblem.svg'] or
                  (len(parts) == 2 and parts[0] in ('posters', 'photos') and parts[1].lower().endswith('.jpg')))
            target = os.path.join(BECH_DIR, *parts) if ok else ''
            if ok and inside(BECH_DIR, target):
                self._file(target, cache='max-age=3600')
            else:
                self.send_error(404, 'Not found')
            return
        if path.startswith('/pvideo/'):
            key, _, rest = path[len('/pvideo/'):].partition('/')
            if key in PROG_SRC:
                self.serve_video(PROG_SRC[key], rest)
            else:
                self.send_error(404, 'Not found')
            return

        # נכסים סטטיים של האתר (הפונט, האייקונים והלוגו יושבים מחוץ לתיקיית lobby)
        parts = [p for p in path.strip('/').split('/') if p and p != '..']
        if parts and parts[0] in STATIC_DIRS:
            target = os.path.join(SITE_DIR, *parts)
            if inside(SITE_DIR, target):
                self._file(target, cache='max-age=86400')
            else:
                self.send_error(403, 'Forbidden')
            return

        # כל השאר → מסך הלובי
        self._file(_brit_active() or os.path.join(SCRIPT_DIR, 'screen.html'), 'text/html; charset=utf-8')

    # ── POST ─────────────────────────────────────────────────────────────
    def do_POST(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        body = self._body()
        cfg = load_config()

        if path == '/api/played':
            pool, rel = body.get('pool'), body.get('rel')
            if not isinstance(pool, str) or not isinstance(rel, str) or not pool or not rel:
                self._json(400, {'ok': False, 'error': 'missing pool/rel'})
                return
            e = record_play(pool, rel)
            self._json(200, {'ok': True, 'plays': e['count']})
            return

        if path == '/api/setRoot':
            new_root = body.get('path')
            if not new_root:
                self._json(400, {'ok': False, 'error': 'missing path'})
                return
            cfg['root'] = new_root
            cfg['selected'] = []          # בחירת תת־תיקיות של תיקייה אחרת חסרת משמעות
            save_config(cfg)
            self._json(200, {'ok': True, 'root': new_root, 'exists': os.path.isdir(new_root),
                             'folders': list_subfolders(new_root)})
            return

        if path == '/api/setSelection':
            sel = body.get('selected')
            if isinstance(sel, str):
                try:
                    sel = json.loads(sel)
                except Exception:
                    sel = [s.strip() for s in sel.split(',') if s.strip()]
            cfg['selected'] = [str(x) for x in sel] if isinstance(sel, list) else []
            save_config(cfg)
            self._json(200, {'ok': True, 'selected': cfg['selected']})
            return

        self._json(404, {'ok': False, 'error': 'unknown action'})

    # ── וידאו עם Range ───────────────────────────────────────────────────
    def serve_video(self, root, rel_path):
        file_path = os.path.normpath(os.path.join(root, rel_path.replace('/', os.sep)))
        if not inside(root, file_path) or not os.path.isfile(file_path):
            self.send_error(404, 'Video not found')
            return
        size = os.path.getsize(file_path)
        ctype = mimetypes.guess_type(file_path)[0] or 'video/mp4'
        rng = self.headers.get('Range')
        start, end = 0, size - 1
        partial = False
        if rng:
            try:
                val = rng.strip().split('=')[1].split('-')
                start = int(val[0])
                end = int(val[1]) if len(val) > 1 and val[1] else size - 1
                partial = True
            except Exception:
                self.send_error(416, 'Bad Range')
                return
        end = min(end, size - 1)
        length = max(0, end - start + 1)
        self.send_response(206 if partial else 200)
        if partial:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        with open(file_path, 'rb') as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(262144, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    return
                left -= len(chunk)

    def log_message(self, fmt, *args):
        pass          # מסך קיוסק — הלוג רק מייצר רעש


class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """סרטון בסטרימינג תופס חיבור לאורך זמן; בלי ריבוי תהליכונים ה-API נתקע מאחוריו."""
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    # מופעל גם ממשימה מתוזמנת כל 10 דקות (שומר-חיים). allow_reuse_address בחלונות מאפשר לשני תהליכים
    # להאזין לאותו פורט — לכן אם השרת כבר עונה, יוצאים בשקט.
    import socket
    # ארגומנטים לבדיקות בלבד (ברירות המחדל = הפעלה רגילה): --port N --config FILE --counts FILE --progroot DIR
    _a = sys.argv[1:]
    for _i in range(0, len(_a) - 1, 2):
        if _a[_i] == '--port':
            PORT = int(_a[_i + 1])
        elif _a[_i] == '--config':
            CONFIG_PATH = _a[_i + 1]
        elif _a[_i] == '--counts':
            COUNTS_PATH = _a[_i + 1]
        elif _a[_i] == '--progroot':
            PROG_SRC = {k: _a[_i + 1] + '/' + k for k in PROG_SRC}
    print('port=%d config=%s counts=%s' % (PORT, CONFIG_PATH, COUNTS_PATH))
    _probe = socket.socket()
    _probe.settimeout(1)
    if _probe.connect_ex(('127.0.0.1', PORT)) == 0:
        raise SystemExit(0)
    _probe.close()
    cfg = load_config()
    print('מסך לובי — בית התלמוד')
    print('תיקיית סרטונים:', cfg['root'], '(קיימת)' if os.path.isdir(cfg['root']) else '(לא נמצאה!)')
    print('נבחרו:', ', '.join(cfg['selected']) or 'הכל')
    print('כתובת: http://localhost:%d' % PORT)
    ThreadedServer(('', PORT), Handler).serve_forever()
