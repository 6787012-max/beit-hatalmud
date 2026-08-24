# -*- coding: utf-8 -*-
"""חיפוש בסגנון Gmail (X-GM-RAW) על כל התיבה, ושמירת ההודעות לקבצים מקומיים."""
import email
import io
import os
import re
import sys
from email.header import decode_header, make_header

sys.path.insert(0, r'C:\phone-line')
from mail_creds import imap_connect  # noqa: E402

QUERY = sys.argv[1]
TAG = sys.argv[2] if len(sys.argv) > 2 else re.sub(r'\W+', '_', QUERY)[:40]
ACC = sys.argv[3] if len(sys.argv) > 3 else 'mechina'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_books_mail', TAG)
os.makedirs(OUT, exist_ok=True)


def dec(v):
    try:
        return str(make_header(decode_header(v or '')))
    except Exception:
        return v or ''


def body_text(msg):
    chunks = []
    for part in msg.walk():
        ct = part.get_content_type()
        disp = str(part.get('Content-Disposition') or '')
        if ct in ('text/plain', 'text/html') and 'attachment' not in disp:
            try:
                raw = part.get_payload(decode=True) or b''
                t = raw.decode(part.get_content_charset() or 'utf-8', 'replace')
            except Exception:
                continue
            if ct == 'text/html':
                t = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', t, flags=re.S | re.I)
                t = re.sub(r'<br\s*/?>|</p>|</tr>|</div>|</li>', '\n', t, flags=re.I)
                t = re.sub(r'<[^>]+>', ' ', t)
                for a, b in (('&nbsp;', ' '), ('&amp;', '&'), ('&quot;', '"'),
                             ('&#39;', "'"), ('&lt;', '<'), ('&gt;', '>')):
                    t = t.replace(a, b)
            t = re.sub(r'[ \t\xa0]+', ' ', t)
            t = re.sub(r'\n{3,}', '\n\n', t)
            if t.strip():
                chunks.append(t.strip())
    return chunks[0] if chunks else ''


M = imap_connect(ACC)
M.select('"[Gmail]/All Mail"', readonly=True)
st, data = M.search('UTF-8', 'X-GM-RAW', ('"%s"' % QUERY).encode('utf-8'))
ids = data[0].split() if data and data[0] else []
print('%s → %d הודעות' % (QUERY, len(ids)))
for n, i in enumerate(sorted(ids, key=lambda x: int(x)), 1):
    st, raw = M.fetch(i, '(RFC822)')
    if not raw or not isinstance(raw[0], tuple):
        continue
    msg = email.message_from_bytes(raw[0][1])
    atts = [dec(p.get_filename()) for p in msg.walk() if p.get_filename()]
    txt = ('DATE: %s\nFROM: %s\nTO: %s\nCC: %s\nSUBJECT: %s\nATTACH: %s\n\n%s\n' % (
        msg.get('Date'), dec(msg.get('From')), dec(msg.get('To')),
        dec(msg.get('Cc')), dec(msg.get('Subject')), '; '.join(atts),
        body_text(msg)))
    io.open(os.path.join(OUT, '%03d.txt' % n), 'w', encoding='utf-8').write(txt)
M.logout()
print('נשמר ב-%s' % OUT)
