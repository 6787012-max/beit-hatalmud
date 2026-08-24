# -*- coding: utf-8 -*-
"""בונה אינדקס מקומי (JSON) של כותרות ההודעות מתאריך מסוים, בכל התיבות הרלוונטיות.
מאפשר לחפש מקומית בלי לשאוב גופי הודעות."""
import email
import io
import json
import os
import sys
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime

sys.path.insert(0, r'C:\phone-line')
from mail_creds import imap_connect  # noqa: E402

ACC = sys.argv[1] if len(sys.argv) > 1 else 'mechina'
SINCE = sys.argv[2] if len(sys.argv) > 2 else '01-Jun-2026'
BOX = sys.argv[3] if len(sys.argv) > 3 else 'INBOX'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   '_mail_index_%s.json' % ACC)


def dec(v):
    try:
        return str(make_header(decode_header(v or '')))
    except Exception:
        return v or ''


M = imap_connect(ACC)
st, _ = M.select(BOX, readonly=True)
st, data = M.search(None, 'SINCE', SINCE)
ids = data[0].split()
print('%d הודעות מאז %s' % (len(ids), SINCE))
rows = []
CHUNK = 200
for k in range(0, len(ids), CHUNK):
    part = b','.join(ids[k:k + CHUNK])
    st, d = M.fetch(part, '(BODY.PEEK[HEADER.FIELDS (DATE FROM TO SUBJECT MESSAGE-ID)])')
    for item in d:
        if not isinstance(item, tuple):
            continue
        msg = email.message_from_bytes(item[1])
        try:
            when = parsedate_to_datetime(msg.get('Date')).isoformat()
        except Exception:
            when = msg.get('Date') or ''
        rows.append({'date': when, 'from': dec(msg.get('From')),
                     'subject': dec(msg.get('Subject')),
                     'mid': (msg.get('Message-ID') or '').strip()})
    print('  ... %d' % len(rows))
M.logout()
rows.sort(key=lambda r: r['date'])
io.open(OUT, 'w', encoding='utf-8').write(json.dumps(rows, ensure_ascii=False, indent=1))
print('נשמר: %s (%d)' % (OUT, len(rows)))
