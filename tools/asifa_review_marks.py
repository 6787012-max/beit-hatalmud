# -*- coding: utf-8 -*-
"""asifa_review_marks.py — מדפיס את הסימונים של סשן ביקורת התמונות: מספרים להורדה, הערות, והאם נלחץ "סיימתי".
שימוש:  python tools/asifa_review_marks.py [--label sign-tashpaz] [--clear]   (--clear מוחק את כל הסימונים, לבדיקות)
"""
import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
import _sb

ap = argparse.ArgumentParser()
ap.add_argument('--label', default='sign-tashpaz')
ap.add_argument('--clear', action='store_true')
a = ap.parse_args()
L = _sb.lit(a.label)
if a.clear:
    _sb.q("delete from asifa_review_marks where session_key=(select key from asifa_review_sessions where label=%s); "
          "update asifa_review_sessions set done_at=null where label=%s" % (L, L))
    print('cleared')
s = _sb.q("select key, done_at, items from asifa_review_sessions where label=%s" % L)
if not s:
    raise SystemExit('no such session')
s = s[0]
cur = {int(i['num']) for i in s['items']}
m = _sb.q("select num, remove, note, updated_at from asifa_review_marks where session_key=%s and (remove or note<>'') order by num" % _sb.lit(s['key']))
rem = [r for r in m if r['remove']]
print('סיימתי נלחץ:', ('כן, ב-' + s['done_at']) if s['done_at'] else 'עדיין לא')
print('תמונות בשלט:', len(cur), '| סומנו להורדה:', len(rem))
print('להורדה:', ' '.join(str(r['num']) for r in rem if r['num'] in cur) or '(אין)')
gone = [r['num'] for r in rem if r['num'] not in cur]
if gone:
    print('סומנו אבל כבר לא בשלט:', ' '.join(map(str, gone)))
for r in m:
    if r['note']:
        print('הערה %d%s: %s' % (r['num'], '' if r['remove'] else ' (לא מסומנת להורדה)', r['note']))
