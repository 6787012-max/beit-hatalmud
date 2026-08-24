# -*- coding: utf-8 -*-
"""מחולל סרטוני ההדרכה של מכינת בית התלמוד.

השיטה זהה לזו שעבדה בעבר (_video/make_video2.py): שקופיות ממותגות עם צילומי
מסך אמיתיים + קריינות, ולא הקלטת וידאו. Playwright מקליט וידאו דרך ffmpeg
משלו שלא מותקן כאן, וגם טקסט עברי יוצא חד יותר מצילום מלא-רזולוציה.

מה נוסף הפעם, לפי בקשת יוסף:
  • סרטון נפרד לכל מסך, פיצ'ר-פיצ'ר — לא סרטון אחד כללי.
  • כתוביות על המסך בנוסף לקריינות.
  • סרטון מאוחד וערוך שמשלב את כולם, עם שקופית פרק לכל מסך.

הרצה:  python video/make_videos.py [שם-מסך]     (בלי שם = הכל)
"""
import io, os, sys, json, asyncio, subprocess, textwrap
from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display
import edge_tts

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

W, H = 1920, 1080
ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(ROOT, 'shots')
WORK = os.path.join(ROOT, '_build')
OUT = os.path.join(ROOT, 'out')
LOGO = os.path.join(os.path.dirname(ROOT), 'img', 'logo.png')
FR = 'C:/Windows/Fonts/'
VOICE = 'he-IL-AvriNeural'

NAVY, NAVY2 = (0, 35, 56), (12, 74, 99)
GOLD, WHITE, MUTE = (214, 164, 74), (238, 244, 248), (150, 178, 196)
CAP_BG = (0, 0, 0)

os.makedirs(WORK, exist_ok=True)
os.makedirs(OUT, exist_ok=True)


def ff(cands, size):
    for f in cands:
        if os.path.exists(FR + f):
            return ImageFont.truetype(FR + f, size)
    return ImageFont.load_default()


F_BIG = ff(['DavidLibre-Bold.ttf', 'arialbd.ttf'], 92)
F_TITLE = ff(['DavidLibre-Bold.ttf', 'arialbd.ttf'], 58)
F_CAP = ff(['arial.ttf'], 40)
F_FOOT = ff(['arial.ttf'], 32)
heb = lambda t: get_display(str(t))
_logo = Image.open(LOGO).convert('RGBA')


def logo_h(h):
    return _logo.resize((int(_logo.width * h / _logo.height), h), Image.LANCZOS)


def base_bg():
    img = Image.new('RGB', (W, H), NAVY)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(NAVY[i] + (NAVY2[i] - NAVY[i]) * t) for i in range(3)))
    return img


def center(d, text, font, y, fill):
    t = heb(text)
    w = d.textbbox((0, 0), t, font=font)[2]
    d.text(((W - w) // 2, y), t, font=font, fill=fill)


def rtl_right(d, text, font, y, fill, right=W - 70):
    t = heb(text)
    w = d.textbbox((0, 0), t, font=font)[2]
    d.text((right - w, y), t, font=font, fill=fill)


def caption(img, text):
    """כתובית בתחתית — מה שנאמר, גם למי שצופה בלי קול."""
    if not text:
        return
    d = ImageDraw.Draw(img, 'RGBA')
    lines = textwrap.wrap(text, width=62) or ['']
    lh = 52
    box_h = lh * len(lines) + 26
    y0 = H - box_h - 34
    d.rectangle([70, y0, W - 70, y0 + box_h], fill=(0, 0, 0, 165))
    for i, ln in enumerate(lines):
        center(d, ln, F_CAP, y0 + 13 + i * lh, WHITE)


def slide_title(path, big, sub):
    img = base_bg()
    d = ImageDraw.Draw(img)
    lg = logo_h(300)
    img.paste(lg, ((W - lg.width) // 2, 190), lg)
    center(d, big, F_BIG, 560, WHITE)
    d.line([(W // 2 - 250, 690), (W // 2 + 250, 690)], fill=GOLD, width=5)
    center(d, sub, F_CAP, 726, GOLD)
    img.save(path)


def slide_shot(path, title, shot_png, cap):
    img = base_bg()
    d = ImageDraw.Draw(img)
    lg = logo_h(96)
    img.paste(lg, (W - lg.width - 56, 40), lg)
    rtl_right(d, title, F_TITLE, 52, GOLD, right=W - lg.width - 96)
    d.line([(W - 70, 146), (W - 700, 146)], fill=GOLD, width=3)
    shot = Image.open(shot_png).convert('RGB')
    # אזור התמונה: מתחת לכותרת ומעל הכתובית.
    top, bottom = 180, H - 250
    maxw, maxh = 1580, bottom - top
    r = min(maxw / shot.width, maxh / shot.height)
    # צילום ממוקד (רצועה קצרה ורחבה) מוגדל עד פי 1.6 — אחרת הוא נראה זעיר
    # במרכז מסך ריק, וכל הרעיון של "מבט מקרוב" הולך לאיבוד.
    r = min(r, 1.6) if shot.height < 500 else min(r, 1.0)
    shot = shot.resize((int(shot.width * r), int(shot.height * r)), Image.LANCZOS)
    # מרכוז אנכי באזור הפנוי, לא הצמדה לראש
    x = (W - shot.width) // 2
    y = top + (maxh - shot.height) // 2
    d.rectangle([x - 4, y - 4, x + shot.width + 4, y + shot.height + 4], fill=GOLD)
    img.paste(shot, (x, y))
    caption(img, cap)
    img.save(path)


async def synth(text, path):
    await edge_tts.Communicate(text, VOICE, rate='-4%').save(path)


def dur(p):
    o = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                                 'format=duration', '-of', 'json', p])
    return float(json.loads(o)['format']['duration'])


def clip(png, mp3, out, fade=True):
    d = dur(mp3) + 0.9
    vf = 'fade=t=in:st=0:d=0.35,fade=t=out:st=%.2f:d=0.4' % (d - 0.45) if fade else 'null'
    subprocess.check_call(
        ['ffmpeg', '-y', '-loop', '1', '-i', png, '-i', mp3,
         '-c:v', 'libx264', '-t', '%.2f' % d, '-r', '30', '-tune', 'stillimage',
         '-vf', vf, '-c:a', 'aac', '-b:a', '192k', '-af', 'apad',
         '-pix_fmt', 'yuv420p', '-shortest', out],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return d


def concat(clips, out):
    lst = os.path.join(WORK, 'list_%s.txt' % os.path.basename(out).replace('.mp4', ''))
    with open(lst, 'w', encoding='utf-8') as f:
        for c in clips:
            f.write("file '%s'\n" % c.replace('\\', '/'))
    subprocess.check_call(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', lst,
                           '-c', 'copy', out], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def build(key, spec, idx):
    """בונה סרטון אחד למסך. מחזיר את רשימת הקליפים, לשימוש בסרטון המאוחד."""
    print('\n=== %s ===' % spec['title'])
    clips = []
    tp = os.path.join(WORK, '%s_title.png' % key)
    tm = os.path.join(WORK, '%s_title.mp3' % key)
    slide_title(tp, spec['title'], spec['sub'])
    asyncio.run(synth(spec['intro'], tm))
    clips.append(os.path.join(WORK, '%s_00.mp4' % key))
    clip(tp, tm, clips[-1])
    print('  פתיח')

    for i, sc in enumerate(spec['scenes'], 1):
        shot = os.path.join(SHOTS, sc['shot'] + '.png')
        if not os.path.exists(shot):
            print('  (חסר צילום: %s — מדלג)' % sc['shot'])
            continue
        png = os.path.join(WORK, '%s_%02d.png' % (key, i))
        mp3 = os.path.join(WORK, '%s_%02d.mp3' % (key, i))
        mp4 = os.path.join(WORK, '%s_%02d.mp4' % (key, i))
        slide_shot(png, sc.get('head', spec['title']), shot, sc['say'])
        asyncio.run(synth(sc['say'], mp3))
        d = clip(png, mp3, mp4)
        clips.append(mp4)
        print('  %2d. %-22s %4.1f שנ׳' % (i, sc['shot'], d))

    out = os.path.join(OUT, '%02d-%s.mp4' % (idx, spec['file']))
    concat(clips, out)
    print('  ✓ %s · %.0f שניות · %.1f MB'
          % (os.path.basename(out), dur(out), os.path.getsize(out) / 1024 / 1024))
    return clips, out


def main():
    spec_all = json.load(io.open(os.path.join(ROOT, 'videos.json'), encoding='utf-8'))
    only = sys.argv[1] if len(sys.argv) > 1 else None
    all_clips = []
    for idx, (key, spec) in enumerate(spec_all.items(), 1):
        if only and key != only:
            continue
        cl, _ = build(key, spec, idx)
        all_clips += cl
    if only:
        return
    # ── הסרטון המאוחד ──
    print('\n=== סרטון מאוחד ===')
    op = os.path.join(WORK, 'z_open.png')
    om = os.path.join(WORK, 'z_open.mp3')
    slide_title(op, 'מערכת מעקב תלמידים', 'מכינת בית התלמוד · מדריך מלא')
    asyncio.run(synth('שלום וברוכים הבאים. לפניכם המדריך המלא למערכת המעקב של מכינת בית התלמוד. '
                      'נעבור מסך אחר מסך, ונראה כל אפשרות בפירוט.', om))
    oc = os.path.join(WORK, 'z_open.mp4')
    clip(op, om, oc)
    ep = os.path.join(WORK, 'z_end.png')
    em = os.path.join(WORK, 'z_end.mp3')
    slide_title(ep, 'בהצלחה!', '6787012-max.github.io/beit-hatalmud')
    asyncio.run(synth('זהו המדריך. אם משהו לא ברור, אפשר לשאול את העוזר האישי בתוך המערכת, '
                      'או לפנות להנהלה. בהצלחה רבה!', em))
    ec = os.path.join(WORK, 'z_end.mp4')
    clip(ep, em, ec)
    full = os.path.join(OUT, '00-מדריך-מלא.mp4')
    concat([oc] + all_clips + [ec], full)
    print('  ✓ %s · %.0f שניות · %.1f MB'
          % (os.path.basename(full), dur(full), os.path.getsize(full) / 1024 / 1024))


if __name__ == '__main__':
    main()
