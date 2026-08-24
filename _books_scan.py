# -*- coding: utf-8 -*-
"""סורק את תיבות המייל ומאתר הודעות שקשורות להזמנת ספרים.
מדפיס רק מטא-דאטה (תאריך/שולח/נושא) — לא גוף ההודעה."""
import sys
import email
from email.header import decode_header, make_header

sys.path.insert(0, r'C:\phone-line')
from mail_creds import imap_connect  # noqa: E402

TERMS = ['ספרים', 'ספרי', 'הזמנת ספרים', 'רשימת ספרים']
ACCOUNTS = sys.argv[1].split(',') if len(sys.argv) > 1 else ['mechina', 'private']
SINCE = sys.argv[2] if len(sys.argv) > 2 else '01-Jun-2026'


def dec(v):
    try:
        return str(make_header(decode_header(v or '')))
    except Exception:
        return v or ''


for acc in ACCOUNTS:
    try:
        M = imap_connect(acc)
    except Exception as e:
        print('[%s] חיבור נכשל: %s' % (acc, e))
        continue
    for box in ['INBOX', '"[Gmail]/&BdEF6QXVBdA-"', '"[Gmail]/All Mail"']:
        try:
            st, _ = M.select(box, readonly=True)
            if st != 'OK':
                continue
        except Exception:
            continue
        ids = set()
        for t in TERMS:
            for field in ('SUBJECT', 'BODY'):
                try:
                    st, data = M.search('UTF-8', 'SINCE', SINCE, field, t.encode('utf-8'))
                    if st == 'OK' and data and data[0]:
                        ids.update(data[0].split())
                except Exception:
                    pass
        if not ids:
            continue
        print('=== %s / %s : %d הודעות ===' % (acc, box, len(ids)))
        for i in sorted(ids, key=lambda x: int(x))[-60:]:
            try:
                st, d = M.fetch(i, '(BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT)])')
                msg = email.message_from_bytes(d[0][1])
                print('  %-32s | %-42s | %s' % (
                    (msg.get('Date') or '')[:31],
                    dec(msg.get('From'))[:41],
                    dec(msg.get('Subject'))[:70]))
            except Exception as e:
                print('  fetch err', e)
        break
    try:
        M.logout()
    except Exception:
        pass
