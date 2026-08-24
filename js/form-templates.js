// form-templates.js — טפסים מוכנים שנשלחים להורים (2026-08-24).
//
// במקום לבנות כל שנה מחדש טופס בן ארבעים שדות, התבניות יושבות כאן ונוצרות
// בלחיצה. כל תבנית מייצרת טופס אמיתי במודול הטפסים — עם קישור אישי לכל
// תלמיד, כך שהתשובה נשמרת תחת התלמיד הנכון ולא בגיליון נפרד.
//
// ⚠️ סוגי השדות מוגבלים למה ש-forms.js באמת יודע להציג:
//    text · textarea · select · checkbox · question · signature
//    אין "רדיו" ואין "תאריך" — select ממלא את מקומם.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const F = (label, type, options, required) =>
    ({ label: label, type: type || 'text', options: options || [], required: !!required });

  const TEMPLATES = {
    /* ── אישור הורים שנתי ליציאות ולפעילויות ── */
    outings: {
      name: 'אישור הורים שנתי ליציאות ולפעילויות',
      icon: 'bi-signpost-2',
      about: 'אישור אחד לכל השנה. ההורה קורא, ממלא הצהרת בריאות ואיש קשר, ומאשר הכל בסימון אחד.',
      title: function () { return 'אישור הורים שנתי ליציאות ולפעילויות — התשפ״ז'; },
      // ⚠️ לפי בקשת יוסף: **אין** אישור נפרד לכל סעיף. כל ההסכמות מפורטות
      // בגוף הטופס כטקסט קריא, וההורה מסמן בסוף אישור אחד על הכל.
      // מי שלא מסכים לחלק — פונה למכינה, ולא מגיש טופס חלקי.
      body: '## א. הודעת המכינה\nבמהלך שנת הלימודים מקיימת המכינה יציאות, סיורים, פעילויות ואירועים מחוץ לכותלי המכינה, כחלק בלתי נפרד מהמערך הלימודי, החינוכי והחברתי. הפעילויות מתקיימות על פי תכנית הפעילות והטיולים השנתית, בליווי אנשי צוות, ובכפוף לנהלי הבטיחות והביטחון החלים.\nאופי הפעילויות כולל, בין השאר:\n• יציאות ופעילויות בתחומי היישוב\n• סיורים לימודיים ופעילות ספורט\n• ביקורים במוסדות, באתרים ובמבני ציבור\n• אירועים, כינוסים, שבתות ארגון והתוועדויות\n• פעילות חסד והתנדבות\n• טיולים על פי התכנית השנתית, לרבות פעילות הכוללת לינה\nתכנית הפעילות והטיולים השנתית מצויה במשרד המכינה ופתוחה לעיון ההורים בכל עת, לפי פנייה למזכירות. הורה המבקש לקבל את התכנית בכתב — יקבלה ללא תנאי.\n\n## ב. מה כולל האישור\nהאישור הוא כללי לשנת הלימודים כולה, ואינו מצריך אישור נפרד לכל יציאה או פעילות בפני עצמה. הוא כולל:\n• השתתפות בכל היציאות, הסיורים, הפעילויות, האירועים והטיולים של המכינה\n• הסעה מאורגנת ברכב מורשה להסעת תלמידים\n• פנייה לטיפול רפואי דחוף ומתן עזרה ראשונה במקרה חירום, כאשר ההורים ייודעו מיד\n• יציאה עצמאית לצורך אישי בתחומי היישוב, בכפוף לאישור פרטני של הנהלת המכינה בכל פעם\n• צילום בפעילות ופרסום התמונה בפרסומי המכינה\n\n## ג. תוקף\nהטופס תקף לשנת לימודים אחת בלבד — התשפ״ז (2026–2027).\nבפעילות חריגה או מאתגרת, ולתלמיד שיש לו מגבלה רפואית, תבקש המכינה אישור רפואי ייעודי לאותה פעילות.\nהצהרת הבריאות שלהלן נלווית ואינה באה במקום \"הצהרת הורים על בריאות ילדם\" השנתית הנמסרת בפתיחת שנת הלימודים.\nיש להודיע למכינה בכתב, ובסמוך למועד, על כל שינוי במצב הבריאות או בפרטי הקשר במהלך השנה.',
      fields: [
        F('מצב בריאות', 'select',
          ['לבני אין מגבלה בריאותית המונעת או מגבילה השתתפות בפעילויות',
           'לבני יש מגבלה בריאותית / רגישות / מחלה כרונית / טיפול תרופתי'], true),
        F('פירוט המגבלה הבריאותית (אם יש)', 'textarea'),
        F('אלרגיות'),
        F('תרופות הניטלות בקביעות'),
        F('איש קשר לחירום — שם', 'text', [], true),
        F('איש קשר לחירום — קרבה'),
        F('איש קשר לחירום — טלפון נייד', 'text', [], true),
        F('איש קשר לחירום — טלפון נוסף'),
        F('קראתי את הטופס במלואו, ואני מאשר/ת את כל האמור בו — לרבות ההשתתפות בכל היציאות והפעילויות, ההסעות, הטיפול הרפואי בחירום, היציאה העצמאית והצילום', 'checkbox', [], true),
        F('הפרטים שמסרתי נכונים ומלאים, ואודיע למכינה בכתב על כל שינוי', 'checkbox', [], true),
        F('שם ההורה החותם', 'text', [], true),
        F('חתימת הורה', 'signature', [], true),
      ],
    },

    /* ── עדכון נטילת תרופות (חודשי) ── */
    meds: {
      name: 'עדכון נטילת תרופות',
      icon: 'bi-capsule',
      about: 'העדכון החודשי שההורים ממלאים. מזין את לשונית "נטילת תרופות" במסך הרפואי.',
      title: () => 'עדכון נטילת תרופות — ' +
        new Intl.DateTimeFormat('he-u-ca-hebrew', { month: 'long', year: 'numeric' }).format(new Date()),
      body: 'נא לעדכן את פרטי נטילת התרופות של בנכם. העדכון נדרש מדי חודש.',
      fields: [
        F('האם הבן נוטל תרופה כרגע?', 'select', ['כן', 'לא'], true),
        F('מטרת נטילת הכדור'),
        F('סוג הכדור'),
        F('מינון'),
        F('מספר שעות השפעה'),
        F('זמן נטילת הכדור'),
        F('אופן נטילת הכדור', 'select', ['עצמאי', 'נוכחות אחד ההורים', 'במכינה']),
        F('תופעות לוואי בזמן השפעת הכדור', 'textarea'),
        F('תופעות לוואי לאחר השפעת הכדור', 'textarea'),
        F('האם לוקח כדור נוסף בשעות הצהריים', 'select', ['לא', 'כן']),
        F('מינון הכדור השני'),
        F('הערות / בקשות', 'textarea'),
      ],
    },
  };

  const tok = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  /** יוצר את הטופס ומייצר קישור אישי לכל תלמיד שנבחר. */
  async function create(key, studentIds) {
    const t = TEMPLATES[key];
    if (!t) throw new Error('אין תבנית בשם ' + key);
    if (!studentIds || !studentIds.length) throw new Error('לא נבחרו תלמידים');
    const fr = await window.store.add('forms', {
      title: t.title(), body: t.body, fields: t.fields, created_at: today(),
    });
    const form = fr && fr.data && fr.data[0];
    if (!form) throw new Error('יצירת הטופס נכשלה');
    let n = 0;
    for (const sid of studentIds) {
      const r = await window.store.add('form_responses',
        { form_id: form.id, student_id: sid, token: tok(), status: 'pending' });
      if (r && r.ok !== false) n++;
    }
    return { form: form, sent: n };
  }

  /** דיאלוג בחירה: איזו תבנית, ולאילו תלמידים. */
  async function pick(onDone) {
    const [students, classes] = await Promise.all([
      window.cv3Students ? window.cv3Students.getStudents() : window.store.list('students'),
      window.store.list('classes'),
    ]);
    const keys = Object.keys(TEMPLATES);
    const m = window.UI.modal({
      title: 'טופס מוכן להורים', saveLabel: 'צור ושלח',
      bodyHTML:
        '<div class="form-grid">' +
          '<label class="fld fld-wide"><span>איזה טופס</span><select class="inp mb0" id="ft_tpl">' +
            keys.map(k => '<option value="' + k + '">' + esc(TEMPLATES[k].name) + '</option>').join('') +
          '</select></label>' +
          '<div class="fld fld-wide"><div class="tl-note" id="ft_about" style="font-size:.86rem"></div></div>' +
          '<label class="fld fld-wide"><span>נמענים</span><select class="inp mb0" id="ft_scope">' +
            '<option value="">כל התלמידים (' + students.length + ')</option>' +
            classes.map(c => '<option value="' + c.id + '">' +
              esc(c.name) + ' (' + students.filter(s => s.class_id == c.id).length + ')</option>').join('') +
          '</select></label>' +
          '<div class="fld fld-wide"><div class="tl-note" id="ft_prev" style="font-size:.82rem"></div></div>' +
        '</div>',
      onSave: async (el) => {
        const k = el.querySelector('#ft_tpl').value;
        const cid = el.querySelector('#ft_scope').value;
        const ids = students.filter(s => !cid || String(s.class_id) === cid).map(s => s.id);
        try {
          const r = await create(k, ids);
          window.UI.toast('נוצר טופס ל-' + r.sent + ' תלמידים');
          if (onDone) onDone(r);
          return true;
        } catch (e) {
          window.UI.toast(e.message || 'נכשל', 'err');
          return false;
        }
      },
    });
    const sync = () => {
      const k = m.el.querySelector('#ft_tpl').value;
      const t = TEMPLATES[k];
      m.el.querySelector('#ft_about').textContent = t.about;
      m.el.querySelector('#ft_prev').innerHTML =
        '<b>' + esc(t.title()) + '</b> · ' + t.fields.length + ' שדות · ' +
        esc(t.fields.slice(0, 5).map(f => f.label).join(' · ')) + '…';
    };
    m.el.querySelector('#ft_tpl').addEventListener('change', sync);
    sync();
  }

    // ── מעצב גוף הטופס ──────────────────────────────────────────────────
  // משותף לתצוגה המקדימה, להדפסה ולדף החתימה. שורה שמתחילה ב-## היא
  // כותרת, שורה שמתחילה בתבליט היא פריט רשימה, ושורה ריקה מפרידה
  // פסקאות. הכל עובר escape — אין הזרקת HTML מתוכן הטופס.
  function fmtBody(t) {
    if (!t) return '';
    const e2 = x => String(x == null ? '' : x).replace(/[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let out = '', list = [];
    const flush = () => { if (list.length) { out += '<ul class="fb-ul">' + list.join('') + '</ul>'; list = []; } };
    String(t).split('\n').forEach(ln => {
      const x = ln.trim();
      if (!x) { flush(); return; }
      if (x.indexOf('##') === 0) { flush(); out += '<h3 class="fb-h">' + e2(x.replace(/^#+\s*/, '')) + '</h3>'; return; }
      if (x.charAt(0) === '•' || x.charAt(0) === '-') {
        list.push('<li>' + e2(x.replace(/^[•-]\s*/, '')) + '</li>'); return;
      }
      flush(); out += '<p class="fb-p">' + e2(x) + '</p>';
    });
    flush();
    return '<div class="fb">' + out + '</div>';
  }
  window.cv3FormTemplates = { TEMPLATES: TEMPLATES, create: create, pick: pick, fmtBody: fmtBody };
})();
