# -*- coding: utf-8 -*-
"""קריינות עברית ב-Gemini TTS (קול Algieba) לסרטוני ההדרכה.

למה לא edge-tts: הקול שם תקין אבל שטוח. Gemini נשמע טבעי יותר, ואפשר
לכוון לו סגנון דיבור בטקסט עצמו — לא רק מהירות.

שתי שכבות למהירות:
  1. הנחיית סגנון בפרומפט ("רהוט, זורם, בקצב נעים") — משפיעה על ההגייה
     והפיסוק, לא רק על הקצב.
  2. atempo ב-ffmpeg לכוונון עדין. atempo שומר על גובה הצליל,
     בניגוד לשינוי sample-rate שהופך את הקול לצפצוף.

מטמון: הקובץ נקבע לפי גיבוב הטקסט+הקול+הקצב, כך שהרצה חוזרת לא משלמת
שוב על אותו משפט.
"""
import io, os, re, sys, json, base64, ssl, struct, hashlib, subprocess, urllib.request

CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
URL = ('https://generativelanguage.googleapis.com/v1beta/models/'
       'gemini-2.5-flash-preview-tts:generateContent')
VOICE = 'Algieba'
TEMPO = 1.12                      # 12% מהיר יותר — נבחר באוזן, לא שרירותי
STYLE = ('קרא בעברית בקול חם ונעים, רהוט וזורם, בקצב טבעי ומעט מהיר, '
         'כמדריך שמסביר בביטחון ובלי לגרור מילים. הקפד על פיסוק ברור: ')
_HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(_HERE, '_tts')
os.makedirs(CACHE, exist_ok=True)


def _key():
    """המפתח נלקח ממשתנה הסביבה GEMINI_KEY — לא מוטמע בקוד ולא ב-repo.
    זהו אותו סוד ששמור בשרת (Supabase secret). לבנייה מקומית: set GEMINI_KEY=..."""
    k = os.environ.get('GEMINI_KEY', '').strip()
    if not re.match(r'^AIza[\w-]{20,}$', k):
        raise SystemExit('חסר מפתח Gemini. הגדירו משתנה סביבה GEMINI_KEY לפני ההרצה.')
    return k


_KEY = None


def _wav(pcm_b64, rate):
    d = base64.b64decode(pcm_b64)
    return (b'RIFF' + struct.pack('<I', 36 + len(d)) + b'WAVEfmt ' +
            struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16) +
            b'data' + struct.pack('<I', len(d)) + d)


def say(text, out_mp3, voice=VOICE, tempo=TEMPO):
    """מייצר קריינות לקובץ mp3. מחזיר את הנתיב."""
    global _KEY
    h = hashlib.sha1(('%s|%s|%s|%s' % (text, voice, tempo, STYLE)).encode('utf-8')).hexdigest()[:16]
    cached = os.path.join(CACHE, h + '.mp3')
    if os.path.exists(cached) and os.path.getsize(cached) > 2000:
        if os.path.abspath(cached) != os.path.abspath(out_mp3):
            io.open(out_mp3, 'wb').write(io.open(cached, 'rb').read())
        return out_mp3

    if _KEY is None:
        _KEY = _key()
    body = {'contents': [{'parts': [{'text': STYLE + text}]}],
            'generationConfig': {'responseModalities': ['AUDIO'],
                                 'speechConfig': {'voiceConfig': {
                                     'prebuiltVoiceConfig': {'voiceName': voice}}}}}
    req = urllib.request.Request(URL + '?key=' + _KEY, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    j = json.loads(urllib.request.urlopen(req, context=CTX, timeout=240).read().decode())
    inl = j['candidates'][0]['content']['parts'][0]['inlineData']
    mt = inl.get('mimeType', '')
    rate = int(re.search(r'rate=(\d+)', mt).group(1)) if 'rate=' in mt else 24000
    tmp = os.path.join(CACHE, h + '.wav')
    io.open(tmp, 'wb').write(_wav(inl['data'], rate))
    subprocess.check_call(
        ['ffmpeg', '-y', '-i', tmp, '-filter:a', 'atempo=%.3f' % tempo,
         '-c:a', 'libmp3lame', '-b:a', '160k', cached],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.remove(tmp)
    if os.path.abspath(cached) != os.path.abspath(out_mp3):
        io.open(out_mp3, 'wb').write(io.open(cached, 'rb').read())
    return out_mp3


if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    t = sys.argv[1] if len(sys.argv) > 1 else 'זה המסך של הנוכחות. רשימת כל התלמידים, כבר ממוינת לפי שם משפחה.'
    p = say(t, os.path.join(CACHE, '_demo.mp3'))
    print('נוצר:', p)
