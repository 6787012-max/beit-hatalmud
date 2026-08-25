# -*- coding: utf-8 -*-
"""ייבוא נתוני דרכון שבוע 1 (פרשת כי תצא) מהגיליון של יוסף — 25/08/2026.
עמודות: ימי שחרית בזמן · דקות לימוד בשב"ק · מבחן בכתב · מבחן בע"פ."""
import json, subprocess

TOK = "sbp_v0_b24ad112fd08a96637216b05da11604258830e78"
REF = "jpcepdbhouuwpjdidqfo"

# student_id: (shacharit, study_min, test_written, test_oral)
DATA = {
    # שיעור א
    48: (6, None,  97, 100), 42: (6, None,  90, 100), 45: (4, None,  92, 100),
    43: (5, None,  97, 100), 46: (6, None,  96, 100), 47: (6, None,  92, 100),
    50: (6, None, 100, 100), 51: (6, None,  97, 100), 44: (5, None,  93, 100),
    49: (6, None,  90, 100),
    # שיעור ב
    63: (5, None,  80,  90), 55: (4, None, 100,  85), 57: (5,   80,  96,  94),
    54: (0, None,  98,  83), 52: (6, None,  83,  80), 60: (4, None,  97,  91),
    53: (3, None,  96,  80), 56: (4, None, 100,  90), 58: (6, None,  94,  95),
    59: (6,   25, 100,  92), 62: (1, None,  90,  80), 61: (3, None, 100,  95),
    # שיעור ג1
    73: (6, None, 100, 100), 68: (2, None,  93,  89), 74: (5, None,  99, 100),
    64: (3,   40, 100, 100), 75: (6,   80,  99, 100), 76: (3, None,  99, 100),
    72: (6,   40, 100, 100), 70: (6,   60, 100, 100),
    # שיעור ג2 (מבחן בע"פ עוד לא נמסר)
    65: (4, None, None, None), 66: (5,   70, 100, None), 67: (2, None, 100, None),
    77: (0, None, None, None), 69: (4,  120,  90, None), 78: (4, None, 100, None),
}

def lit(v):
    return 'null' if v is None else str(int(v))

vals = ",\n  ".join(
    "(%d,1,'כי תצא','ט׳ אלול',%s,%s,%s,%s)" % (sid, lit(a), lit(b), lit(c), lit(d))
    for sid, (a, b, c, d) in sorted(DATA.items()))

sql = """
insert into public.passport (student_id, week_no, parasha, heb_date, shacharit, study_min, test_written, test_oral)
values
  %s
on conflict (student_id, week_no) do update set
  shacharit    = excluded.shacharit,
  study_min    = excluded.study_min,
  test_written = excluded.test_written,
  test_oral    = excluded.test_oral;
""" % vals

open('_q.json', 'w', encoding='utf-8').write(json.dumps({'query': sql}))
out = subprocess.run(['curl.exe', '-s', '-X', 'POST',
    'https://api.supabase.com/v1/projects/%s/database/query' % REF,
    '-H', 'Authorization: Bearer ' + TOK, '-H', 'Content-Type: application/json',
    '-d', '@_q.json'], capture_output=True, text=True, encoding='utf-8')
print('RESULT:', out.stdout, out.stderr)
