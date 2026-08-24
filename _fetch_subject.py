# -*- coding: utf-8 -*-
"""מאתר בכל התיבה (All Mail) הודעות שהנושא שלהן מכיל מחרוזת, ושומר אותן לקבצים.
סינון מקומי — כי חיפוש IMAP בעברית נשבר מול Gmail."""
import email
import io
import os
import re
import sys
from email.header import decode_header, make_header

sys.path.insert(0, r'C:\phone-line')
from mail_creds import imap_connect  # noqa: E402

TERM = sys.argv[1]
TAG = sys.argv[2] if len(sys.argv) > 2 else re.sub(r'\W+', '_', TERM)[:40]
SINCE = sys.argv[3] if len(sys.argv) > 3 else '01-Jun-2026'
ACC = sys.argv[4] if len(sys.argv) > 4 else 'mechina'
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
        if ct in ('text/plain', 'text/html') and 'attachment' not in str(part.get('Content-Disposition') or ''):
            try:
                t = (part.get_payload(decode=True) or b'').decode(
                    part.get_content_charset() or 'utf-8', 'replace')
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
st, data = M.search(None, 'SINCE', SINCE)
ids = data[0].split()
print('סורק %d הודעות מאז %s' % (len(ids), SINCE))
match = []
CH = 300
for k in range(0, len(ids), CH):
    st, d = M.fetch(b','.join(ids[k:k + CH]), '(BODY.PEEK[HEADER.FIELDS (SUBJECT)])')
    seq = [x for x in d if isinstance(x, tuple)]
    for item in seq:
        num = re.match(rb'(\d+)', item[0]).group(1).decode()
        subj = dec(email.message_from_bytes(item[1]).get('Subject'))
        if TERM in subj:
            match.append((num, subj))
print('התאמות: %d' % len(match))
for n, (num, subj) in enumerate(match, 1):
    st, raw = M.fetch(num.encode(), '(RFC822)')
    if not raw or not isinstance(raw[0], tuple):
        continue
    msg = email.message_from_bytes(raw[0][1])
    atts = [dec(p.get_filename()) for p in msg.walk() if p.get_filename()]
    io.open(os.path.join(OUT, '%03d.txt' % n), 'w', encoding='utf-8').write(
        'DATE: %s\nFROM: %s\nTO: %s\nCC: %s\nSUBJECT: %s\nATTACH: %s\n\n%s\n' % (
            msg.get('Date'), dec(msg.get('From')), dec(msg.get('To')),
            dec(msg.get('Cc')), dec(msg.get('Subject')), '; '.join(atts),
            body_text(msg)))
M.logout()
print('נשמר ב-%s' % OUT)
