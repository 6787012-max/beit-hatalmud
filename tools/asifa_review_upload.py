# -*- coding: utf-8 -*-
"""asifa_review_upload.py — יוצר/מעדכן סשן ביקורת תמונות לשלט אסיפת ההורים ומעלה את התמונות.

שימוש:  python tools/asifa_review_upload.py [--label sign-tashpaz] [--layout <פריסה.json>] [--sheet <review_4800.jpg>]
הרצה חוזרת מעדכנת את אותו סשן: מוסיף מספרים חדשים, מרנדר מחדש רק תמונה שהמקור/חיתוך שלה השתנה,
מסיר מהרשימה מספרים שכבר לא בשלט (ומוחק את הקובץ שלהם), ולא נוגע בסימונים.
הקבצים נשמרים ב-Supabase Storage (bucket ציבורי asifa-review, תיקייה אקראית) ולא בריפו.
קורא רק מ-Z:/... ו-C:/projects/collage-asifa (בלי לכתוב אליהם). מטמון מקומי: ~/.cache/asifa_review.
"""
import argparse, hashlib, io, json, os, subprocess, sys, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
import _sb
from PIL import Image, ImageOps

DEF_DIR = 'Z:/מכינה - אסיפת הורים תשפז/באנר-ענק'
PAGE = 'https://6787012-max.github.io/beit-hatalmud/asifa-review.html'
CACHE = os.path.join(os.path.expanduser('~'), '.cache', 'asifa_review')
LONG = 900
QUAL = 78


def render_thumb(it, out):
    """חיתוך מהמקור לפי crop (שברים 0..1) וצמצום ל-900 בצלע הארוכה. פריים מסרטון: אותה שיטה כמו banner.hires_path."""
    src = it['source']
    if it['kind'] == 'still':
        im = Image.open(src)
        im = ImageOps.exif_transpose(im).convert('RGB')
    else:
        tmp = out + '.frame.jpg'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-noaccurate_seek', '-ss', '%.2f' % it['t'], '-i', src,
                        '-frames:v', '1', '-q:v', '2', tmp], capture_output=True)
        if not os.path.exists(tmp):
            raise RuntimeError('ffmpeg failed for num %s' % it['num'])
        im = Image.open(tmp).convert('RGB')
        im.load()
        os.remove(tmp)
    cx0, cy0, cx1, cy1 = it.get('crop') or [0, 0, 1, 1]
    w, h = im.size
    box = (int(round(cx0 * w)), int(round(cy0 * h)), int(round(cx1 * w)), int(round(cy1 * h)))
    if box[2] - box[0] > 8 and box[3] - box[1] > 8:
        im = im.crop(box)
    r = LONG / max(im.size)
    if r < 1:
        im = im.resize((max(1, round(im.size[0] * r)), max(1, round(im.size[1] * r))), Image.LANCZOS)
    im.save(out, 'JPEG', quality=QUAL, optimize=True)


def fingerprint(it):
    s = json.dumps([it['source'], it.get('t'), it.get('crop'), it['kind'], LONG, QUAL], ensure_ascii=False)
    return hashlib.md5(s.encode('utf-8')).hexdigest()[:12]


class Store:
    def __init__(self):
        self.key = _sb.service_key()

    def _req(self, method, path, data=None, ctype=None):
        h = {'Authorization': 'Bearer ' + self.key, 'apikey': self.key, 'User-Agent': 'x/1.0'}
        if ctype:
            h['Content-Type'] = ctype
        req = urllib.request.Request(_sb.BASE + '/storage/v1' + path, data=data, method=method, headers=h)
        return urllib.request.urlopen(req, timeout=180).read()

    def put(self, folder, name, path):
        body = open(path, 'rb').read()
        try:
            self._req('POST', '/object/asifa-review/%s/%s' % (folder, name), body, 'image/jpeg')
        except urllib.error.HTTPError as e:
            if e.code in (400, 409):
                self._req('PUT', '/object/asifa-review/%s/%s' % (folder, name), body, 'image/jpeg')
            else:
                raise

    def remove(self, folder, names):
        if names:
            self._req('DELETE', '/object/asifa-review',
                      json.dumps({'prefixes': ['%s/%s' % (folder, n) for n in names]}).encode(), 'application/json')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', default='sign-tashpaz')
    ap.add_argument('--title', default='שלט אסיפת ההורים: מעבר על התמונות')
    ap.add_argument('--layout', default=DEF_DIR + '/פריסה.json')
    ap.add_argument('--sheet', default=DEF_DIR + '/_work/review_4800.jpg')
    a = ap.parse_args()
    try:
        os.nice(0)
    except Exception:
        pass
    try:
        import psutil
        psutil.Process().nice(psutil.IDLE_PRIORITY_CLASS)
    except Exception:
        pass
    os.makedirs(CACHE, exist_ok=True)

    layout = json.load(open(a.layout, encoding='utf-8'))
    items = sorted(layout['images'], key=lambda i: i['num'])
    nums = [i['num'] for i in items]
    assert len(nums) == len(set(nums)), 'duplicate nums'

    rows = _sb.q("select key, folder, sheet, items from asifa_review_sessions where label=%s" % _sb.lit(a.label))
    if rows:
        s = rows[0]
    else:
        s = _sb.q("insert into asifa_review_sessions(label,title) values (%s,%s) returning key, folder, sheet, items"
                  % (_sb.lit(a.label), _sb.lit(a.title)))[0]
    folder, key = s['folder'], s['key']
    old = {int(i['num']): i['fp'] for i in (s['items'] or [])}
    st = Store()

    todo = [it for it in items if old.get(it['num']) != fingerprint(it)]
    print('images in layout:', len(items), '| to (re)upload:', len(todo))
    new_items = []
    fails = []
    for k, it in enumerate(items):
        fp = fingerprint(it)
        if old.get(it['num']) == fp:
            new_items.append({'num': it['num'], 'fp': fp})
            continue
        out = os.path.join(CACHE, '%s_%d.jpg' % (a.label, it['num']))
        try:
            render_thumb(it, out)
            st.put(folder, '%d.jpg' % it['num'], out)
            new_items.append({'num': it['num'], 'fp': fp})
        except Exception as e:
            fails.append((it['num'], str(e)[:120]))
            if it['num'] in old:                       # נשאר הקובץ הקודם
                new_items.append({'num': it['num'], 'fp': old[it['num']]})
        if (k + 1) % 20 == 0:
            print('  ...', k + 1, 'of', len(items), flush=True)

    removed = sorted(set(old) - set(nums))
    st.remove(folder, ['%d.jpg' % n for n in removed])

    # תצוגת השלט הממוספרת
    sheet_name = s['sheet']
    if os.path.exists(a.sheet):
        sh = open(a.sheet, 'rb').read()
        fp = hashlib.md5(sh).hexdigest()[:10]
        new_sheet = 'sheet-%s.jpg' % fp
        if sheet_name != new_sheet:
            st.put(folder, new_sheet, a.sheet)
            if sheet_name:
                st.remove(folder, [sheet_name])
            sheet_name = new_sheet
    else:
        print('WARNING: sheet file missing, keeping previous:', a.sheet)

    _sb.q("update asifa_review_sessions set items=%s::jsonb, sheet=%s where key=%s"
          % (_sb.lit(json.dumps(new_items)), _sb.lit(sheet_name) if sheet_name else 'null', _sb.lit(key)))
    print('uploaded/kept:', len(new_items), '| removed from list:', removed, '| failures:', fails)
    print('LINK:', PAGE + '?k=' + key)


if __name__ == '__main__':
    main()
