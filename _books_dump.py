# -*- coding: utf-8 -*-
"""מוריד את ההודעות מהתוויות של הזמנת הספרים לקבצי טקסט מקומיים,
כדי לעבד אותן בלי להזרים את כל הגוף להקשר."""
import base64
import email
import imaplib
import io
import os
import re
import sys
from email.header import decode_header, make_header

sys.path.insert(0, r'C:\phone-line')
from mail_creds import imap_connect  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_books_mail')
os.makedirs(OUT, exist_ok=True)


def enc_mutf7(s):
    out, buf = '', ''

    def flush():
        nonlocal buf
        if buf:
            b = base64.b64encode(buf.encode('utf-16-be')).decode().rstrip('=')
            return '&' + b.replace('/', ',') + '-'
        return ''
    for ch in s:
        if 0x20 <= ord(ch) <= 0x7e:
            out += flush()
            buf = ''
            out += '&-' if ch == '&' else ch
        else:
            buf += ch
    out += flush()
    return out


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
                p = part.get_payload(decode=True) or b''
                t = p.decode(part.get_content_charset() or 'utf-8', 'replace')
            except Exception:
                continue
            if ct == 'text/html':
                t = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', t, flags=re.S | re.I)
                t = re.sub(r'<br\s*/?>|</p>|</tr>|</div>', '\n', t, flags=re.I)
                t = re.sub(r'<[^>]+>', ' ', t)
                t = (t.replace('&nbsp;', ' ').replace('&amp;', '&')
                      .replace('&quot;', '"').replace('&#39;', "'")
                      .replace('&lt;', '<').replace('&gt;', '>'))
            t = re.sub(r'[ \t\xa0]+', ' ', t)
            t = re.sub(r'\n{3,}', '\n\n', t)
            chunks.append(t.strip())
    return '\n\n----\n\n'.join(c for c in chunks if c)


LABELS = sys.argv[1:] or ['אישור תשלום הזמנת ספרים', 'הזמנת ספרים שיעור א', 'וינברג לטיפול']
M = imap_connect('mechina')
total = 0
for lab in LABELS:
    box = '"%s"' % enc_mutf7(lab)
    st, d = M.select(box, readonly=True)
    if st != 'OK':
        print('דילוג (לא נמצא): %s' % lab)
        continue
    st, data = M.search(None, 'ALL')
    ids = data[0].split()
    safe = re.sub(r'[^\w\u0590-\u05FF]+', '_', lab)
    d2 = os.path.join(OUT, safe)
    os.makedirs(d2, exist_ok=True)
    print('%s : %d הודעות' % (lab, len(ids)))
    for n, i in enumerate(ids, 1):
        st, raw = M.fetch(i, '(RFC822)')
        msg = email.message_from_bytes(raw[0][1])
        atts = [dec(p.get_filename()) for p in msg.walk() if p.get_filename()]
        txt = ('DATE: %s\nFROM: %s\nTO: %s\nSUBJECT: %s\nATTACH: %s\n\n%s\n' % (
            msg.get('Date'), dec(msg.get('From')), dec(msg.get('To')),
            dec(msg.get('Subject')), '; '.join(atts), body_text(msg)))
        io.open(os.path.join(d2, '%03d.txt' % n), 'w', encoding='utf-8').write(txt)
        total += 1
M.logout()
print('נשמרו %d הודעות תחת %s' % (total, OUT))
