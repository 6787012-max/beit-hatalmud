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
import http.server
import json
import mimetypes
import os
import socketserver
import urllib.parse

PORT = 8484
VIDEO_EXTENSIONS = {'.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v'}
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(SCRIPT_DIR)                      # שורש האתר (vendor/, img/, css/)
CONFIG_PATH = os.path.join(SCRIPT_DIR, 'lobby_config.json')
DEFAULT_VIDEO_DIR = r'Z:\סרטונים'
STATIC_DIRS = ('vendor', 'img', 'css')


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
        self._file(os.path.join(SCRIPT_DIR, 'screen.html'), 'text/html; charset=utf-8')

    # ── POST ─────────────────────────────────────────────────────────────
    def do_POST(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        body = self._body()
        cfg = load_config()

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
    cfg = load_config()
    print('מסך לובי — בית התלמוד')
    print('תיקיית סרטונים:', cfg['root'], '(קיימת)' if os.path.isdir(cfg['root']) else '(לא נמצאה!)')
    print('נבחרו:', ', '.join(cfg['selected']) or 'הכל')
    print('כתובת: http://localhost:%d' % PORT)
    ThreadedServer(('', PORT), Handler).serve_forever()
