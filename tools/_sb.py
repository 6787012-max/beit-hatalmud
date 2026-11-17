# -*- coding: utf-8 -*-
"""עזר משותף לסקריפטי asifa_review: SQL דרך Management API ומפתח service מהמסד. אף מפתח לא נשמר ולא מודפס."""
import re, io, os, sys, json, urllib.request, urllib.error
REF = 'jpcepdbhouuwpjdidqfo'
BASE = 'https://%s.supabase.co' % REF
_cred = os.path.join(os.path.expanduser('~'), '.secrets', 'credentials-index.md')
_KEYS = list(dict.fromkeys(re.findall(r'sbp_(?:v0_)?[0-9a-f]{40}', io.open(_cred, encoding='utf-8').read())))
_good = [None]

def _api(method, path, body=None):
    last = None
    for k in ([_good[0]] if _good[0] else []) + [x for x in _KEYS if x != _good[0]]:
        req = urllib.request.Request('https://api.supabase.com/v1/projects/%s%s' % (REF, path),
            data=None if body is None else json.dumps(body).encode(), method=method,
            headers={'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json', 'User-Agent': 'x/1.0'})
        try:
            r = json.loads(urllib.request.urlopen(req, timeout=120).read() or b'null')
            _good[0] = k
            return r
        except urllib.error.HTTPError as e:
            last = '%s %s' % (e.code, e.read()[:300])
            if e.code not in (401, 403):
                break
    raise SystemExit('Management API failed: ' + str(last))

def q(sql):
    return _api('POST', '/database/query', {'query': sql})

def lit(s):
    return "'" + str(s).replace("'", "''") + "'"

def service_key():
    for k in _api('GET', '/api-keys?reveal=true'):
        if k.get('name') == 'service_role':
            return k['api_key']
    raise SystemExit('no service_role key')
