# -*- coding: utf-8 -*-
"""בדיקת פונקציות אסיפת הישיבה דרך ה-RPC הציבורי (מפתח anon הציבורי מ-js/config.js), ומחיקת נתוני הבדיקה בסוף."""
import io, os, re, sys, json, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _sb
here = os.path.dirname(os.path.abspath(__file__))
cfg = io.open(os.path.join(here, '..', 'js', 'config.js'), encoding='utf-8').read()
ANON = re.search(r"SUPABASE_ANON_KEY:'([^']+)'", cfg).group(1)
row = _sb.q("select public_token g, results_key k from public.yeshiva_asifa_settings where code='yeshiva-2026-11-25'")[0]
G, K = row['g'], row['k']

def rpc(fn, args):
    req = urllib.request.Request(_sb.BASE + '/rest/v1/rpc/' + fn, data=json.dumps(args).encode(), method='POST',
        headers={'apikey': ANON, 'Authorization': 'Bearer ' + ANON, 'Content-Type': 'application/json'})
    try:
        return 200, json.loads(urllib.request.urlopen(req, timeout=60).read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read()).get('message')
        except Exception: return e.code, '?'

def book(phone, stu, rav, slot, parent='הורה בדיקה', cls='שיעור א׳'):
    return rpc('yeshiva_asifa_book', dict(p_token=G, p_parent=parent, p_student=stu, p_class=cls, p_phone=phone, p_rav=rav, p_slot=slot))

ok = True
def check(name, cond, info=''):
    global ok
    ok = ok and cond
    print(('PASS ' if cond else 'FAIL ') + name, info)

try:
    c, pub = rpc('yeshiva_asifa_public', dict(p_token=G))
    check('public ok', c == 200 and pub and len(pub['rabbis']) == 4 and pub['classes'] == ['שיעור א׳', 'שיעור ב׳'], str(pub['classes']))
    check('public bad token -> null', rpc('yeshiva_asifa_public', dict(p_token='x'))[1] is None)
    c, r = book('050-1234567', 'בחור בדיקה', 'lintzner', '21:15')
    check('book', c == 200 and r.get('ok'), str(r))
    c, r = book('052-9999999', 'אחר בדיקה', 'lintzner', '21:15')
    check('double slot rejected', c != 200, str(r))
    c, r = book('050-1234567', 'בחור   בדיקה', 'lintzner', '21:30')
    check('same boy same rabbi rejected', c != 200, str(r))
    c, r = book('050-1234567', 'בחור בדיקה', 'heinman', '21:15')
    check('same parent same time rejected', c != 200, str(r))
    c, r = book('050-1234567', 'בחור בדיקה', 'heinman', '21:30')
    check('other rabbi other time ok', c == 200, str(r))
    c, r = book('050-1234567', 'בחור בדיקה', 'zvi-weinberg', '21:20')
    check('off-grid slot rejected', c != 200, str(r))
    c, r = book('050-1234567', 'בחור בדיקה', 'zvi-weinberg', '23:00')
    check('slot after end rejected', c != 200, str(r))
    c, r = book('050-1234567', 'בחור בדיקה', 'zvi-weinberg', '22:00', cls='אחר')
    check('class not in list rejected', c != 200, str(r))
    c, r = book('12345', 'בחור בדיקה', 'zvi-weinberg', '22:00')
    check('bad phone rejected', c != 200, str(r))
    c, pub = rpc('yeshiva_asifa_public', dict(p_token=G))
    check('public shows occupied without names', pub['occupied'] == {'lintzner': ['21:15'], 'heinman': ['21:30']} and 'בחור' not in json.dumps(pub, ensure_ascii=False), str(pub['occupied']))
    c, mine = rpc('yeshiva_asifa_mine', dict(p_token=G, p_phone='0501234567'))
    check('mine finds 2 by phone', len(mine) == 2, str(len(mine)))
    check('mine other phone empty', rpc('yeshiva_asifa_mine', dict(p_token=G, p_phone='0509999999'))[1] == [])
    bid = [b['id'] for b in mine if b['rav_id'] == 'heinman'][0]
    c, r = rpc('yeshiva_asifa_move', dict(p_token=G, p_phone='0501234567', p_booking_id=bid, p_slot='21:15'))
    check('move onto own other-rabbi time rejected', c != 200, str(r))
    c, r = rpc('yeshiva_asifa_move', dict(p_token=G, p_phone='0501234567', p_booking_id=bid, p_slot='21:45'))
    check('move ok', c == 200 and r['slot'] == '21:45', str(r))
    c, r = rpc('yeshiva_asifa_cancel', dict(p_token=G, p_phone='0529999999', p_booking_id=bid))
    check('cancel with wrong phone rejected', c != 200, str(r))
    c, res = rpc('yeshiva_asifa_results', dict(p_key=K))
    n = sum(len(x['bookings']) for x in res['rabbis'])
    check('results with key shows 2', c == 200 and n == 2, str(n))
    check('results no key -> null', rpc('yeshiva_asifa_results', dict(p_key=None))[1] is None)
    check('results wrong key -> null', rpc('yeshiva_asifa_results', dict(p_key='a' * 64))[1] is None)
    check('results with parent token -> null', rpc('yeshiva_asifa_results', dict(p_key=G))[1] is None)
    c, r = rpc('yeshiva_asifa_cancel', dict(p_token=G, p_phone='0501234567', p_booking_id=bid))
    check('cancel ok', c == 200 and r.get('deleted') == 1, str(r))
    # הפרדה מהמכינה
    code, _ = rpc('yeshiva_asifa_settings', {})
    req = urllib.request.Request(_sb.BASE + '/rest/v1/yeshiva_asifa_bookings?select=*', headers={'apikey': ANON, 'Authorization': 'Bearer ' + ANON})
    try: body = urllib.request.urlopen(req, timeout=60).read().decode()
    except urllib.error.HTTPError as e: body = 'HTTP%d' % e.code
    check('anon direct table read returns nothing', body in ('[]',) or body.startswith('HTTP'), body[:80])
    mech = _sb.q("select (select count(*) from asifa_bookings) b, (select count(*) from asifa_meetings) m")[0]
    print('mechina counts (untouched by test):', mech)
finally:
    _sb.q("delete from public.yeshiva_asifa_bookings")
    left = _sb.q("select count(*) c from public.yeshiva_asifa_bookings")[0]['c']
    print('bookings left after cleanup:', left)
print('ALL PASS' if ok else 'SOME FAILED')
