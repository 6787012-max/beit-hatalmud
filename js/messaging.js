// messaging.js — פאנל שליחת דיוור להורים (מנהל/מזכירה בלבד).
// שלושה ערוצים: מייל (Apps Script), הודעה קולית לשלוחה בקו (ימות), צינתוק
// לנרשמים (חינם) / לרשימת נמענים (בתשלום). ניתן לשלב מייל+קול.
//
// אבטחה:
//   • הפעלה: מנהל/מזכירה בלבד (adminOnly בתפריט + בדיקת role בשרת ב-bridge).
//   • מייל: Apps Script bridge מוודא JWT + role לפני שליחה.
//   • קו ימות: משתמש בטוקן הקיים של פאנל הקו (js/yemot.js). אם אין — נדרש להתחבר.
//   • תבניות מוגדרות בטבלה message_templates (עריכה למנהל/מזכירה בלבד).
//   • כל שליחה נרשמת ב-message_log לצפייה/היסטוריה.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CATEGORIES = [
    { k: 'general',   lbl: 'כללי' },
    { k: 'meeting',   lbl: 'אסיפת הורים' },
    { k: 'event',     lbl: 'אירוע/דיווח' },
    { k: 'holiday',   lbl: 'ברכת חג' },
    { k: 'vacation',  lbl: 'חופש/יציאה' },
    { k: 'emergency', lbl: 'הודעה דחופה' },
    { k: 'thanks',    lbl: 'תודה' },
  ];
  const CHANNELS = [
    { k: 'mail',              lbl: 'מייל בלבד', ic: 'bi-envelope' },
    { k: 'voice',             lbl: 'הודעה קולית בלבד', ic: 'bi-mic' },
    { k: 'mail+voice',        lbl: 'מייל + הודעה קולית', ic: 'bi-broadcast' },
    { k: 'mail+tzintuk_free', lbl: 'מייל + צינתוק לנרשמים בלבד', ic: 'bi-bell' },
  ];

  // מצב הפאנל — נשמר בזיכרון בזמן ניווט בין הטאבים
  const state = { audience: 'all', classId: '', selectedIds: new Set(),
                  individual: { name: '', email: '' }, staffIds: new Set(),
                  channel: 'mail', tpl: null, audioBlob: null, audioName: '' };

  async function render(page) {
    // בדיקת הרשאה בסיסית — הגנה נוספת מעבר ל-adminOnly
    const u = window.Auth && window.Auth.currentUser;
    if (!u || (u.role !== 'מנהל' && u.role !== 'מזכירה')) {
      page.innerHTML = '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה</button><h2>שליחת דיוור</h2></div>' +
        '<div class="qr-card"><div class="empty-state" style="padding:24px"><i class="bi bi-shield-lock"></i><div>המסך זמין למנהל ולמזכירה בלבד.</div></div></div>';
      return;
    }
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button>' +
        '<h2>שליחת דיוור להורים</h2>' +
        '<div class="head-actions"><button class="btn-ghost sm" id="msgHistoryBtn"><i class="bi bi-clock-history"></i> היסטוריה</button></div></div>' +

      '<div class="qr-card"><p class="login-hint" style="margin:0">' +
        '<i class="bi bi-info-circle"></i> מסך מרכזי לשליחת מיילים והודעות קוליות להורים. ' +
        'בחרו תבנית, ערוץ, נמענים — ושלחו. כל שליחה נרשמת בהיסטוריה.</p></div>' +

      // תיבה 1: בחירת ערוץ
      '<div class="qr-card"><h3><i class="bi bi-broadcast-pin"></i> ערוץ השליחה</h3>' +
        '<div id="msgChannels" class="msg-chan-grid">' +
          CHANNELS.map(c => '<label class="msg-chan' + (state.channel === c.k ? ' on' : '') + '" data-c="' + c.k + '">' +
            '<input type="radio" name="msgCh" value="' + c.k + '"' + (state.channel === c.k ? ' checked' : '') + ' hidden>' +
            '<i class="bi ' + c.ic + '"></i><span>' + esc(c.lbl) + '</span></label>').join('') + '</div>' +
        '<p class="login-hint" id="msgChanHelp" style="margin-top:8px"></p></div>' +

      // תיבה 2: תבניות
      '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-file-earmark-text"></i> תבניות מוכנות</h3>' +
        '<button class="btn-ghost sm" id="msgTplNew"><i class="bi bi-plus-lg"></i> תבנית חדשה</button></div>' +
        '<div id="msgTpls"><div class="empty-state" style="padding:14px">טוען…</div></div></div>' +

      // תיבה 3: תוכן ההודעה (מייל)
      '<div class="qr-card" id="msgMailCard"><h3><i class="bi bi-envelope-paper"></i> תוכן המייל</h3>' +
        '<label class="lbl">נושא</label>' +
        '<input class="inp" id="msgSubject" placeholder="נושא המייל">' +
        '<label class="lbl">גוף ההודעה (HTML/טקסט) — <span style="color:var(--muted)">Placeholders: <code dir="ltr">{{student_name}}</code>, <code dir="ltr">{{class_name}}</code>, <code dir="ltr">{{parent_name}}</code></span></label>' +
        '<textarea class="inp" id="msgBody" rows="8" placeholder="שלום להורי {{student_name}},&#10;&#10;…"></textarea>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-top:6px">' +
          '<button class="btn-ghost sm" id="msgAiSuggest" title="שיפור ההודעה עם AI"><i class="bi bi-stars"></i> שיפור בעזרת AI</button>' +
          '<button class="btn-ghost sm" id="msgPreview"><i class="bi bi-eye"></i> תצוגה מקדימה</button>' +
        '</div></div>' +

      // תיבה 4: תוכן הודעה קולית
      '<div class="qr-card" id="msgVoiceCard"><h3><i class="bi bi-mic-fill"></i> תוכן ההודעה הקולית</h3>' +
        '<div class="ym-tabs"><button class="ym-tab on" data-vt="text"><i class="bi bi-body-text"></i> טקסט לשמע</button>' +
          '<button class="ym-tab" data-vt="rec"><i class="bi bi-mic"></i> הקלטה</button>' +
          '<button class="ym-tab" data-vt="file"><i class="bi bi-file-earmark-music"></i> קובץ מוכן</button></div>' +
        '<div class="ym-pane" data-vp="text">' +
          '<textarea class="inp" id="msgVoiceText" rows="3" placeholder="הטקסט שיוקרא בקול…"></textarea>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">' +
            '<button class="btn-ghost sm" id="msgTtsGen"><i class="bi bi-soundwave"></i> צור קול</button>' +
            '<audio id="msgTtsPrev" controls style="display:none;height:36px"></audio>' +
            '<span id="msgTtsMsg" class="count-line"></span></div></div>' +
        '<div class="ym-pane" data-vp="rec" hidden>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
            '<button class="btn-primary sm" id="msgRecStart"><i class="bi bi-record-circle"></i> התחל הקלטה</button>' +
            '<button class="btn-ghost sm" id="msgRecStop" disabled><i class="bi bi-stop-circle"></i> עצור</button>' +
            '<span id="msgRecTime" class="count-line"></span></div>' +
          '<audio id="msgRecPrev" controls style="display:none;width:100%;margin-top:8px"></audio></div>' +
        '<div class="ym-pane" data-vp="file" hidden>' +
          '<input class="inp mb0" id="msgFile" type="file" accept="audio/*"></div>' +
        '<label class="lbl" style="margin-top:10px">שלוחה בקו שההודעה תועלה אליה (ברירת מחדל: 20 — לא בשימוש בתפריט)</label>' +
        '<input class="inp mb0" id="msgExt" value="20" style="width:120px" inputmode="numeric">' +
        '<p class="login-hint" style="margin-top:6px">' +
          'הצינתוק (חינם/בתשלום) מפנה את הנמענים לשלוחה זו — הם ישמעו את ההודעה בהתקשרות חזרה.</p></div>' +

      // תיבה 5: נמענים
      '<div class="qr-card"><h3><i class="bi bi-people-fill"></i> נמענים</h3>' +
        '<div class="msg-aud"><label><input type="radio" name="msgAud" value="all"' + (state.audience === 'all' ? ' checked' : '') + '> ' +
          '<span>כל התלמידים</span></label>' +
          '<label><input type="radio" name="msgAud" value="class"' + (state.audience === 'class' ? ' checked' : '') + '> ' +
          '<span>לפי כיתה</span></label>' +
          '<label><input type="radio" name="msgAud" value="custom"' + (state.audience === 'custom' ? ' checked' : '') + '> ' +
          '<span>בחירה ידנית (תלמידים)</span></label>' +
          '<label><input type="radio" name="msgAud" value="staff"' + (state.audience === 'staff' ? ' checked' : '') + '> ' +
          '<span>צוות</span></label>' +
          '<label><input type="radio" name="msgAud" value="individual"' + (state.audience === 'individual' ? ' checked' : '') + '> ' +
          '<span>אדם פרטי</span></label></div>' +
        '<div id="msgAudCls" hidden style="margin-top:8px"><label class="lbl">כיתה</label>' +
          '<select class="inp mb0" id="msgClassSel"></select></div>' +
        '<div id="msgAudList" hidden style="margin-top:8px">' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<input class="inp mb0" id="msgStuFilter" placeholder="חיפוש תלמיד…" style="flex:1;min-width:180px">' +
            '<button class="btn-ghost sm" id="msgSelAll"><i class="bi bi-check2-square"></i> בחר הכל בסינון</button>' +
            '<button class="btn-ghost sm" id="msgSelNone"><i class="bi bi-square"></i> נקה הכל</button></div>' +
          '<div id="msgStuList" class="msg-stu-list"></div></div>' +
        '<div id="msgAudStaff" hidden style="margin-top:8px">' +
          '<div id="msgStaffList" class="msg-stu-list"><div class="empty-state" style="padding:14px">טוען…</div></div></div>' +
        '<div id="msgAudIndividual" hidden style="margin-top:8px">' +
          '<label class="lbl">שם הנמען</label><input class="inp mb0" id="msgIndName" placeholder="שם (רשות)" style="margin-bottom:8px">' +
          '<label class="lbl">כתובת מייל</label><input class="inp mb0" id="msgIndEmail" type="email" dir="ltr" placeholder="name@example.com" style="text-align:left">' +
          '<p class="login-hint" style="margin-top:6px"><i class="bi bi-info-circle"></i> לאדם פרטי אפשר לשלוח רק מייל — ערוץ קולי/צינתוק זמין רק להורי תלמידים הרשומים בקו.</p></div>' +
        '<div id="msgAudSum" class="msg-aud-sum">…</div></div>' +

      // תיבה 6: שליחה
      '<div class="qr-card"><h3><i class="bi bi-send-fill"></i> שליחה</h3>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
          '<button class="btn-primary" id="msgSend"><i class="bi bi-send"></i> שלח דיוור</button>' +
          '<span id="msgSendMsg" class="count-line"></span></div>' +
        '<p class="login-hint" style="margin-top:8px">' +
          '<i class="bi bi-exclamation-triangle"></i> פעולת שליחה — לא ניתן לבטל לאחר לחיצה. יופיע אישור סופי.</p></div>';

    injectCss();
    wireChannels(page);
    wireTemplates(page);
    wireVoice(page);
    wireAudience(page);
    page.querySelector('#msgSend').addEventListener('click', () => confirmAndSend(page));
    page.querySelector('#msgHistoryBtn').addEventListener('click', () => openHistory());
    page.querySelector('#msgAiSuggest').addEventListener('click', () => aiSuggest(page));
    page.querySelector('#msgPreview').addEventListener('click', () => previewMail(page));
    await loadTemplates(page);
    await loadStudents(page);
    updateChannelUi(page);
  }

  // ---------- CSS פנימי (בלי לפזר בגודל main.css) ----------
  function injectCss() {
    if (document.getElementById('msgStyle')) return;
    const s = document.createElement('style'); s.id = 'msgStyle';
    s.textContent = `
      .msg-chan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
      .msg-chan{border:1px solid var(--line);border-radius:10px;padding:12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;transition:.15s}
      .msg-chan i{font-size:26px;color:var(--muted)}
      .msg-chan:hover{background:var(--bg-elev)}
      .msg-chan.on{border-color:var(--brand);background:color-mix(in srgb,var(--brand) 8%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 18%,transparent) inset}
      .msg-chan.on i{color:var(--brand)}
      .msg-chan.disabled{opacity:.45;cursor:not-allowed;pointer-events:none}
      .msg-tpls{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
      .msg-tpl{border:1px solid var(--line);border-radius:10px;padding:10px;cursor:pointer;position:relative}
      .msg-tpl:hover{background:var(--bg-elev)}
      .msg-tpl.on{border-color:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 18%,transparent) inset}
      .msg-tpl h4{margin:0 0 4px;font-size:14px}
      .msg-tpl .msg-tpl-cat{font-size:11px;color:var(--muted)}
      .msg-tpl .msg-tpl-snip{font-size:12px;color:var(--muted);margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .msg-tpl-actions{position:absolute;top:6px;left:6px;display:none;gap:4px}
      .msg-tpl:hover .msg-tpl-actions{display:flex}
      .msg-aud{display:flex;gap:14px;flex-wrap:wrap;padding:4px 0}
      .msg-aud label{display:flex;align-items:center;gap:6px;cursor:pointer}
      .msg-aud-sum{margin-top:10px;padding:8px 12px;background:var(--bg-elev);border-radius:8px;font-size:14px}
      .msg-stu-list{max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-top:8px}
      .msg-stu-list .row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line)}
      .msg-stu-list .row:last-child{border-bottom:none}
      .msg-stu-list .row:hover{background:var(--bg-elev)}
      .msg-hist-item{border-bottom:1px solid var(--line);padding:8px 0}
      .msg-hist-item:last-child{border-bottom:none}
    `;
    document.head.appendChild(s);
  }

  function wireChannels(page) {
    page.querySelectorAll('.msg-chan').forEach(el => el.addEventListener('click', () => {
      state.channel = el.dataset.c;
      page.querySelectorAll('.msg-chan').forEach(x => x.classList.toggle('on', x === el));
      updateChannelUi(page);
    }));
  }
  function updateChannelUi(page) {
    const mailOn = /mail/.test(state.channel);
    const voiceOn = /voice/.test(state.channel);
    const tzintukOn = /tzintuk|voice/.test(state.channel);
    const mc = page.querySelector('#msgMailCard'); if (mc) mc.style.display = mailOn ? '' : 'none';
    const vc = page.querySelector('#msgVoiceCard'); if (vc) vc.style.display = voiceOn ? '' : 'none';
    const help = page.querySelector('#msgChanHelp');
    if (help) {
      const m = {
        'mail': 'שליחת מייל מחשבון המכינה לכל ההורים שנבחרו (אבא + אמא). אם אין מייל להורה — הוא לא נכלל.',
        'voice': 'ההודעה הקולית תועלה לשלוחה בקו + צינתוק חינמי לנרשמים בקו (שלוחה 7). מי שלא נרשם — לא יקבל.',
        'mail+voice': 'משלב את שני הערוצים: מייל לכולם + הודעה קולית לנרשמים בקו.',
        'mail+tzintuk_free': 'מייל לכולם + צינתוק חינמי לנרשמים בלבד (בלי חיוב יחידות).'
      };
      help.innerHTML = '<i class="bi bi-info-circle"></i> ' + esc(m[state.channel] || '');
    }
  }

  // ---------- תבניות ----------
  async function loadTemplates(page) {
    const box = page.querySelector('#msgTpls');
    const r = await window.db.list('message_templates', { eq: { is_active: true }, order: 'name', asc: true });
    if (!r.ok) { box.innerHTML = '<div class="empty-state" style="padding:14px">' + esc(r.error || 'שגיאה בטעינת תבניות. ודאו שהוזנה migration_messaging.sql') + '</div>'; return; }
    const list = r.data || [];
    if (!list.length) { box.innerHTML = '<div class="empty-state" style="padding:14px">אין תבניות. הוסיפו תבנית חדשה.</div>'; return; }
    box.innerHTML = '<div class="msg-tpls">' + list.map(t => {
      const cat = (CATEGORIES.find(c => c.k === t.category) || {}).lbl || t.category;
      const snip = String(t.subject || t.html_body || t.voice_text || '').replace(/<[^>]+>/g, ' ').trim();
      const isMine = state.tpl && state.tpl.id === t.id;
      return '<div class="msg-tpl' + (isMine ? ' on' : '') + '" data-tid="' + t.id + '">' +
        '<div class="msg-tpl-actions"><button class="mini" data-tpledit="' + t.id + '" title="עריכה"><i class="bi bi-pencil"></i></button>' +
        '<button class="mini danger" data-tpldel="' + t.id + '" title="מחיקה"><i class="bi bi-trash"></i></button></div>' +
        '<div class="msg-tpl-cat">' + esc(cat) + '</div>' +
        '<h4>' + esc(t.name) + '</h4>' +
        '<div class="msg-tpl-snip">' + esc(snip.slice(0, 120)) + '</div></div>';
    }).join('') + '</div>';
    box.querySelectorAll('[data-tid]').forEach(el => el.addEventListener('click', ev => {
      if (ev.target.closest('[data-tpledit],[data-tpldel]')) return;
      const t = list.find(x => String(x.id) === el.dataset.tid);
      if (t) applyTemplate(page, t);
    }));
    box.querySelectorAll('[data-tpledit]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      const t = list.find(x => String(x.id) === b.dataset.tpledit);
      if (t) openTplForm(page, t);
    }));
    box.querySelectorAll('[data-tpldel]').forEach(b => b.addEventListener('click', async ev => {
      ev.stopPropagation();
      const t = list.find(x => String(x.id) === b.dataset.tpldel);
      if (!t) return;
      const ok = await window.UI.confirm('למחוק את התבנית "' + t.name + '"?');
      if (!ok) return;
      const r2 = await window.db.remove('message_templates', t.id);
      if (r2.ok) { window.UI.toast('התבנית נמחקה', 'ok'); loadTemplates(page); }
      else window.UI.toast('המחיקה נכשלה', 'err');
    }));
  }

  function applyTemplate(page, t) {
    state.tpl = t;
    page.querySelector('#msgSubject').value = t.subject || '';
    page.querySelector('#msgBody').value = t.html_body || '';
    page.querySelector('#msgVoiceText').value = t.voice_text || '';
    page.querySelectorAll('.msg-tpl').forEach(x => x.classList.toggle('on', x.dataset.tid === String(t.id)));
  }

  function wireTemplates(page) {
    page.querySelector('#msgTplNew').addEventListener('click', () => openTplForm(page, null));
  }
  function openTplForm(page, existing) {
    const isEdit = !!existing;
    const t = existing || {};
    window.UI.modal({
      title: isEdit ? 'עריכת תבנית' : 'תבנית חדשה',
      bodyHTML:
        '<label class="lbl">שם התבנית</label><input class="inp" id="tf_name" value="' + esc(t.name || '') + '">' +
        '<label class="lbl">קטגוריה</label><select class="inp" id="tf_cat">' +
          CATEGORIES.map(c => '<option value="' + c.k + '"' + (c.k === (t.category || 'general') ? ' selected' : '') + '>' + c.lbl + '</option>').join('') + '</select>' +
        '<label class="lbl">נושא המייל</label><input class="inp" id="tf_subj" value="' + esc(t.subject || '') + '">' +
        '<label class="lbl">גוף המייל (HTML)</label><textarea class="inp" id="tf_body" rows="6">' + esc(t.html_body || '') + '</textarea>' +
        '<label class="lbl">טקסט להקראה (הודעה קולית)</label><textarea class="inp" id="tf_voice" rows="3">' + esc(t.voice_text || '') + '</textarea>',
      saveLabel: isEdit ? 'שמור' : 'צור',
      onSave: async (card) => {
        const row = {
          name: card.querySelector('#tf_name').value.trim(),
          category: card.querySelector('#tf_cat').value,
          subject: card.querySelector('#tf_subj').value.trim(),
          html_body: card.querySelector('#tf_body').value,
          voice_text: card.querySelector('#tf_voice').value.trim(),
          is_active: true,
          updated_at: new Date().toISOString(),
        };
        if (!row.name) { window.UI.toast('חסר שם', 'err'); return false; }
        const r = isEdit
          ? await window.db.update('message_templates', existing.id, row)
          : await window.db.insert('message_templates', row);
        if (!r.ok) { window.UI.toast('שמירה נכשלה: ' + (r.error || ''), 'err'); return false; }
        window.UI.toast('התבנית נשמרה', 'ok');
        loadTemplates(page);
        return true;
      }
    });
  }

  // ---------- TTS + הקלטה ----------
  function wireVoice(page) {
    // טאבים
    page.querySelectorAll('#msgVoiceCard .ym-tab').forEach(t => t.addEventListener('click', () => {
      page.querySelectorAll('#msgVoiceCard .ym-tab').forEach(x => x.classList.toggle('on', x === t));
      page.querySelectorAll('#msgVoiceCard .ym-pane').forEach(p => p.hidden = p.dataset.vp !== t.dataset.vt);
    }));
    // TTS דרך geminiSpeak (חשוף ע"י yemot.js)
    page.querySelector('#msgTtsGen').addEventListener('click', async () => {
      const txt = page.querySelector('#msgVoiceText').value.trim();
      const msg = page.querySelector('#msgTtsMsg'), prev = page.querySelector('#msgTtsPrev');
      if (!txt) { msg.textContent = 'כתבו טקסט קודם'; return; }
      if (!window.geminiSpeak) { msg.textContent = 'רכיב TTS לא זמין (רענן/נקה cache)'; return; }
      msg.textContent = 'יוצר קול…';
      try {
        state.audioBlob = await window.geminiSpeak(txt); state.audioName = 'tts.wav';
        prev.src = URL.createObjectURL(state.audioBlob); prev.style.display = '';
        msg.textContent = '✓ הקול מוכן';
      } catch (e) { msg.textContent = 'יצירת קול נכשלה: ' + String(e && e.message || e); }
    });
    // הקלטה
    let rec = null, chunks = [], timer = null, t0 = 0;
    const startB = page.querySelector('#msgRecStart'), stopB = page.querySelector('#msgRecStop');
    const timeEl = page.querySelector('#msgRecTime'), prev = page.querySelector('#msgRecPrev');
    startB.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = []; rec = new MediaRecorder(stream);
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          state.audioBlob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          state.audioName = 'rec.webm';
          prev.src = URL.createObjectURL(state.audioBlob); prev.style.display = '';
          stream.getTracks().forEach(t => t.stop());
        };
        rec.start(); t0 = Date.now();
        timer = setInterval(() => timeEl.textContent = '● מקליט… ' + Math.floor((Date.now() - t0) / 1000) + 'ש', 300);
        startB.disabled = true; stopB.disabled = false;
      } catch (_) { timeEl.textContent = 'אין גישה למיקרופון'; }
    });
    stopB.addEventListener('click', () => {
      if (rec && rec.state !== 'inactive') rec.stop();
      clearInterval(timer); timeEl.textContent = '✓ ההקלטה מוכנה';
      startB.disabled = false; stopB.disabled = true;
    });
    // קובץ מוכן
    page.querySelector('#msgFile').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      state.audioBlob = f; state.audioName = f.name;
    });
  }

  // ---------- נמענים ----------
  let students = [], classes = [], staff = [];
  // profiles חסום ב-RLS למנהל/בעל-הרשומה בלבד (prof_self_read) — מזכירה
  // (שהפאנל הזה גם פתוח לה) לא הייתה רואה אף איש צוות חוץ מעצמה. ה-RPC
  // staff_directory_with_email גדור לשני התפקידים האלה בדיוק ומחזיר email.
  async function loadStaffDirectory() {
    if (window.sb) {
      try {
        const { data, error } = await window.sb.rpc('staff_directory_with_email');
        if (!error && data) return data;
      } catch (_) {}
    }
    const r = await window.db.list('profiles', { eq: { active: true }, order: 'name' });
    return (r.ok && r.data) || [];
  }
  async function loadStudents(page) {
    const [rs, rc, rp] = await Promise.all([
      window.db.list('students', { eq: { status: 'פעיל' }, order: 'name' }),
      window.db.list('classes', { order: 'name' }),
      loadStaffDirectory()
    ]);
    students = (rs.ok && rs.data) || [];
    classes = (rc.ok && rc.data) || [];
    staff = rp || [];
    // מלא סלקטור כיתה
    const csel = page.querySelector('#msgClassSel');
    csel.innerHTML = classes.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    if (state.classId) csel.value = state.classId;
    renderStuList(page);
    renderStaffList(page);
    updateAudSum(page);
  }
  function wireAudience(page) {
    // ערוץ קולי/צינתוק תלוי בהורים הרשומים בקו — לא קיים ל"צוות"/"אדם פרטי".
    // עוברים אוטומטית ל"מייל בלבד" כדי לא להציע פעולה שלא באמת עובדת.
    const syncChannelForAudience = () => {
      if ((state.audience === 'staff' || state.audience === 'individual') && state.channel !== 'mail') {
        state.channel = 'mail';
        page.querySelectorAll('.msg-chan').forEach(x => x.classList.toggle('on', x.dataset.c === 'mail'));
        updateChannelUi(page);
      }
      page.querySelectorAll('.msg-chan').forEach(x => {
        const disable = x.dataset.c !== 'mail' && (state.audience === 'staff' || state.audience === 'individual');
        x.classList.toggle('disabled', disable);
        x.querySelector('input').disabled = disable;
      });
    };
    page.querySelectorAll('input[name="msgAud"]').forEach(r => r.addEventListener('change', () => {
      state.audience = r.value;
      page.querySelector('#msgAudCls').hidden = state.audience !== 'class';
      page.querySelector('#msgAudList').hidden = state.audience !== 'custom';
      page.querySelector('#msgAudStaff').hidden = state.audience !== 'staff';
      page.querySelector('#msgAudIndividual').hidden = state.audience !== 'individual';
      syncChannelForAudience();
      updateAudSum(page);
    }));
    // מפעיל UI התחלתי לפי state
    page.querySelector('#msgAudCls').hidden = state.audience !== 'class';
    page.querySelector('#msgAudList').hidden = state.audience !== 'custom';
    page.querySelector('#msgAudStaff').hidden = state.audience !== 'staff';
    page.querySelector('#msgAudIndividual').hidden = state.audience !== 'individual';
    syncChannelForAudience();
    page.querySelector('#msgClassSel').addEventListener('change', e => { state.classId = e.target.value; updateAudSum(page); });
    page.querySelector('#msgStuFilter').addEventListener('input', () => renderStuList(page));
    page.querySelector('#msgSelAll').addEventListener('click', () => {
      const q = page.querySelector('#msgStuFilter').value.trim();
      filteredStudents(q).forEach(s => state.selectedIds.add(s.id));
      renderStuList(page); updateAudSum(page);
    });
    page.querySelector('#msgSelNone').addEventListener('click', () => {
      state.selectedIds.clear(); renderStuList(page); updateAudSum(page);
    });
    page.querySelector('#msgIndName').addEventListener('input', e => { state.individual.name = e.target.value; });
    page.querySelector('#msgIndEmail').addEventListener('input', e => { state.individual.email = e.target.value; updateAudSum(page); });
  }
  function filteredStudents(q) {
    const qq = (q || '').trim();
    if (!qq) return students;
    return students.filter(s => (s.name || '').indexOf(qq) >= 0 || (s.parent_name || '').indexOf(qq) >= 0);
  }
  function renderStuList(page) {
    const box = page.querySelector('#msgStuList'); if (!box) return;
    const q = page.querySelector('#msgStuFilter').value.trim();
    const list = filteredStudents(q);
    box.innerHTML = list.map(s => {
      const cls = classes.find(c => c.id === s.class_id);
      const on = state.selectedIds.has(s.id);
      return '<label class="row"><input type="checkbox" data-sid="' + s.id + '"' + (on ? ' checked' : '') + '> ' +
        '<b>' + esc(s.name) + '</b>' + (cls ? ' <span class="chip">' + esc(cls.name) + '</span>' : '') + '</label>';
    }).join('');
    box.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
      const id = Number(cb.dataset.sid);
      if (cb.checked) state.selectedIds.add(id); else state.selectedIds.delete(id);
      updateAudSum(page);
    }));
  }
  // אנשי צוות עם מייל בלבד — בלי מייל אין למה לשלוח.
  function staffWithEmail() { return staff.filter(p => (p.email || '').trim()); }
  function renderStaffList(page) {
    const box = page.querySelector('#msgStaffList'); if (!box) return;
    const list = staffWithEmail();
    box.innerHTML = list.length ? list.map(p => {
      const on = state.staffIds.has(p.id);
      return '<label class="row"><input type="checkbox" data-pid="' + esc(p.id) + '"' + (on ? ' checked' : '') + '> ' +
        '<b>' + esc(p.name || p.email) + '</b>' + (p.role ? ' <span class="chip">' + esc(p.role) + '</span>' : '') + '</label>';
    }).join('') : '<div class="empty-state" style="padding:14px">אין אנשי צוות עם כתובת מייל רשומה</div>';
    box.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
      const id = cb.dataset.pid;
      if (cb.checked) state.staffIds.add(id); else state.staffIds.delete(id);
      updateAudSum(page);
    }));
  }
  function recipientsForSend() {
    let list = [];
    if (state.audience === 'all') list = students;
    else if (state.audience === 'class') list = students.filter(s => String(s.class_id) === String(state.classId));
    else if (state.audience === 'custom') list = students.filter(s => state.selectedIds.has(s.id));
    return list;
  }
  // רשימת נמעני המייל בפועל — לכל סוגי הקהל, כולל צוות/אדם פרטי שאינם
  // "תלמידים" ולכן לא עוברים דרך recipientsForSend/reg (מבנה הרישום).
  function mailRecipientsForSend() {
    if (state.audience === 'individual') {
      const email = (state.individual.email || '').trim();
      if (!email) return [];
      const name = state.individual.name.trim();
      return [{ email, student_name: '', class_name: '', parent_name: name }];
    }
    if (state.audience === 'staff') {
      return staffWithEmail().filter(p => state.staffIds.has(p.id))
        .map(p => ({ email: p.email, student_name: '', class_name: '', parent_name: p.name || '' }));
    }
    const out = [];
    recipientsForSend().forEach(s => {
      const reg = s.reg || {};
      const cls = classes.find(c => c.id === s.class_id);
      const emailFather = (reg['אימייל אב'] || '').trim();
      const emailMother = (reg['אימייל אם'] || '').trim();
      if (emailFather) out.push({ email: emailFather, student_name: s.name, class_name: cls && cls.name, parent_name: reg['שם האב'] || s.parent_name });
      if (emailMother) out.push({ email: emailMother, student_name: s.name, class_name: cls && cls.name, parent_name: reg['שם האם'] || s.parent_name });
    });
    return out;
  }
  function updateAudSum(page) {
    const box = page.querySelector('#msgAudSum');
    if (state.audience === 'individual') {
      const email = (state.individual.email || '').trim();
      box.innerHTML = '<i class="bi bi-person"></i> ' + (email ? '<b>' + esc(state.individual.name.trim() || email) + '</b> · ' + esc(email) : 'הזינו כתובת מייל');
      return;
    }
    if (state.audience === 'staff') {
      const n = staffWithEmail().filter(p => state.staffIds.has(p.id)).length;
      box.innerHTML = '<i class="bi bi-person-badge"></i> אנשי צוות נבחרו: <b>' + n + '</b>';
      return;
    }
    const list = recipientsForSend();
    let mails = 0;
    list.forEach(s => {
      const reg = s.reg || {};
      if ((reg['אימייל אב'] || '').trim()) mails++;
      if ((reg['אימייל אם'] || '').trim()) mails++;
    });
    box.innerHTML = '<i class="bi bi-people"></i> תלמידים נבחרו: <b>' + list.length + '</b>' +
      ' · <i class="bi bi-envelope"></i> כתובות מייל: <b>' + mails + '</b>';
  }

  // ---------- שיפור AI ----------
  async function aiSuggest(page) {
    const body = page.querySelector('#msgBody').value.trim();
    const subj = page.querySelector('#msgSubject').value.trim();
    if (!body && !subj) { window.UI.toast('כתבו טקסט כלשהו קודם', 'err'); return; }
    if (!window.cv3call) { window.UI.toast('רכיב AI לא זמין', 'err'); return; }
    window.UI.toast('משפר טקסט…');
    try {
      const prompt =
        'שפר את המייל הבא לניסוח מקצועי, ידידותי ומכובד להורים במכינה חרדית.\n' +
        'שמור על placeholders (כמו {{student_name}}). החזר JSON: {"subject":"…","body":"…"}.\n\n' +
        'נושא: ' + subj + '\n\nגוף:\n' + body;
      const r = await window.cv3call('gemini-2.5-flash', {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.5 }
      });
      const j = await r.json();
      const txt = j.candidates && j.candidates[0] && j.candidates[0].content
        && j.candidates[0].content.parts && j.candidates[0].content.parts[0]
        && j.candidates[0].content.parts[0].text;
      if (!txt) throw new Error('לא התקבל טקסט');
      const parsed = JSON.parse(txt);
      if (parsed.subject) page.querySelector('#msgSubject').value = parsed.subject;
      if (parsed.body) page.querySelector('#msgBody').value = parsed.body;
      window.UI.toast('שופר בעזרת AI', 'ok');
    } catch (e) { window.UI.toast('שיפור נכשל: ' + (e && e.message || e), 'err'); }
  }

  function previewMail(page) {
    const subj = page.querySelector('#msgSubject').value.trim();
    const body = page.querySelector('#msgBody').value;
    const sample = { student_name: 'ישראל ישראלי', class_name: 'שיעור א', parent_name: 'הרב ישראלי' };
    const render = s => String(s || '').replace(/\{\{(\w+)\}\}/g, (_, k) => sample[k] || '');
    window.UI.modal({
      title: 'תצוגה מקדימה',
      bodyHTML:
        '<div style="border:1px solid var(--line);border-radius:8px;padding:12px">' +
        '<div style="border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:8px"><b>נושא:</b> ' + esc(render(subj)) + '</div>' +
        '<div>' + render(body) + '</div></div>' +
        '<p class="login-hint" style="margin-top:8px">Placeholders הודגמו על תלמיד לדוגמה.</p>'
    });
  }

  // ---------- שליחה ----------
  async function confirmAndSend(page) {
    // "אדם פרטי"/"צוות" לא עוברים דרך רשימת התלמידים — הספירה/הקיום נבדקים
    // לפי נמעני המייל בפועל, לא לפי recipientsForSend (שמחזירה [] עבורם).
    const isStudentAud = state.audience === 'all' || state.audience === 'class' || state.audience === 'custom';
    const audienceCount = isStudentAud ? recipientsForSend().length
      : state.audience === 'staff' ? staffWithEmail().filter(p => state.staffIds.has(p.id)).length
      : (state.individual.email || '').trim() ? 1 : 0;
    const mailRecipients = mailRecipientsForSend();
    if (!audienceCount) { window.UI.toast('אין נמענים', 'err'); return; }
    const mailOn = /mail/.test(state.channel);
    const voiceOn = /voice/.test(state.channel);
    const subj = page.querySelector('#msgSubject') ? page.querySelector('#msgSubject').value.trim() : '';
    const body = page.querySelector('#msgBody') ? page.querySelector('#msgBody').value : '';
    if (mailOn && !subj) { window.UI.toast('חסר נושא למייל', 'err'); return; }
    if (mailOn && !body) { window.UI.toast('חסר גוף המייל', 'err'); return; }
    if (voiceOn && !state.audioBlob) { window.UI.toast('חסר קובץ שמע להודעה הקולית', 'err'); return; }

    const mailCount = mailRecipients.length;
    const parts = [];
    if (mailOn) parts.push('מייל: ' + mailCount + ' כתובות');
    if (voiceOn && state.channel === 'voice') parts.push('העלאה לשלוחה + צינתוק לנרשמים');
    if (state.channel === 'mail+voice') parts.push('העלאה לשלוחה + צינתוק לנרשמים');
    if (state.channel === 'mail+tzintuk_free') parts.push('צינתוק חינמי לנרשמים בלבד');

    const ok = await window.UI.confirm('לשלוח דיוור?\n\n' + parts.join('\n') + '\n\nלא ניתן לבטל.');
    if (!ok) return;

    const outEl = page.querySelector('#msgSendMsg');
    outEl.textContent = 'שולח…';

    // ── לוג התחלה ──
    const logRow = {
      sender_id: window.Auth && window.Auth.currentUser && window.Auth.currentUser.id,
      template_id: state.tpl ? state.tpl.id : null,
      channel: state.channel,
      subject: subj || null,
      audience_kind: state.audience,
      audience_class_id: state.audience === 'class' ? Number(state.classId) || null : null,
      audience_count: audienceCount,
    };

    let mailSent = 0, mailFailed = 0, voiceMsg = 'none', audioPath = null, notesArr = [];

    // ── מייל ──
    if (mailOn) {
      try {
        const recipients = mailRecipients;
        if (!recipients.length) { notesArr.push('אין כתובות מייל בקרב הנמענים'); }
        else {
          const gasUrl = window.CV3 && window.CV3.GAS_URL;
          if (!gasUrl) { notesArr.push('GAS_URL לא הוגדר'); }
          else {
            const sess = window.sb && window.sb.auth && await window.sb.auth.getSession();
            const jwt = sess && sess.data && sess.data.session && sess.data.session.access_token;
            if (!jwt) { notesArr.push('חסר טוקן משתמש'); }
            else {
              const r = await fetch(gasUrl, {
                method: 'POST',
                // text/plain כדי להימנע מ-CORS preflight (Apps Script חוסם OPTIONS)
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                  action: 'sendMail',
                  token: jwt,
                  payload: { subject: subj, html_body: body, sender_name: 'מכינה בית התלמוד', recipients: recipients }
                })
              });
              const j = await r.json();
              if (j.error) { notesArr.push('שגיאת מייל: ' + j.error); }
              else { mailSent = j.sent || 0; mailFailed = j.failed || 0; if (j.errors && j.errors.length) notesArr.push('כשלים: ' + j.errors.slice(0,5).join('; ')); }
            }
          }
        }
      } catch (e) { notesArr.push('חריגה בשליחת מייל: ' + (e && e.message || e)); }
    }

    // ── שמע / צינתוק ──
    if (voiceOn && state.audioBlob) {
      const ext = (page.querySelector('#msgExt') && page.querySelector('#msgExt').value.trim()) || '20';
      try {
        if (!window.Yemot || !window.Yemot.token()) {
          notesArr.push('לא מחובר לקו — היכנס למסך "קו ימות המשיח" והתחבר, ואז שלח שוב');
        } else {
          const up = await window.Yemot.uploadBlob(ext, state.audioBlob, state.audioName || 'msg.wav');
          if (up.responseStatus !== 'OK') { notesArr.push('העלאה לקו נכשלה: ' + (up.message || '')); }
          else {
            audioPath = 'ivr2:/' + ext;
            // צינתוק לפי סוג הערוץ
            if (state.channel === 'voice' || state.channel === 'mail+voice' || state.channel === 'mail+tzintuk_free') {
              // צינתוק לנרשמים בקו (חינם) — מפנה לשלוחה
              const tz = await window.Yemot.call('SendFreeTzintuk', { path: audioPath });
              if (tz.responseStatus === 'OK') voiceMsg = 'free_only';
              else { voiceMsg = 'failed'; notesArr.push('צינתוק חינמי נכשל: ' + (tz.message || '')); }
            }
          }
        }
      } catch (e) { notesArr.push('חריגה בשליחה קולית: ' + (e && e.message || e)); }
    }

    // ── שמירה ליומן ──
    logRow.mail_sent = mailSent;
    logRow.mail_failed = mailFailed;
    logRow.voice_ext = voiceOn ? ((page.querySelector('#msgExt') && page.querySelector('#msgExt').value.trim()) || '20') : null;
    logRow.voice_tzintuk = voiceMsg;
    logRow.audio_path = audioPath;
    logRow.notes = notesArr.join('\n') || null;
    try { await window.db.insert('message_log', logRow); } catch (_) {}

    // ── סיכום ──
    const parts2 = [];
    if (mailOn) parts2.push('מייל: נשלחו ' + mailSent + (mailFailed ? ' · נכשלו ' + mailFailed : ''));
    if (voiceOn) parts2.push('שמע: ' + (audioPath ? 'הועלה' : 'לא הועלה') + ' · צינתוק: ' + voiceMsg);
    outEl.textContent = '✓ ' + parts2.join(' · ');
    window.UI.toast('הדיוור נשלח: ' + parts2.join(' · '), 'ok');
    if (notesArr.length) window.UI.toast('הערות: ' + notesArr.join('; '), 'warn');
  }

  // ---------- היסטוריה ----------
  async function openHistory() {
    const r = await window.db.list('message_log', { order: 'sent_at', asc: false });
    if (!r.ok) { window.UI.toast('שגיאה בטעינת היסטוריה: ' + (r.error || ''), 'err'); return; }
    const items = (r.data || []).slice(0, 200);
    const body = items.length ? items.map(x => {
      const ch = (CHANNELS.find(c => c.k === x.channel) || {}).lbl || x.channel;
      const cls = x.audience_class_id ? (classes.find(c => c.id === x.audience_class_id) || {}).name || ('#' + x.audience_class_id) : '';
      return '<div class="msg-hist-item">' +
        '<div><b>' + esc(x.subject || '(ללא נושא)') + '</b> · <span class="chip">' + esc(ch) + '</span></div>' +
        '<div class="count-line"><i class="bi bi-clock"></i> ' + esc((x.sent_at || '').replace('T',' ').slice(0,16)) +
          ' · נמענים: ' + (x.audience_count || 0) + (cls ? ' · כיתה: ' + esc(cls) : '') +
          ' · מיילים נשלחו: ' + (x.mail_sent || 0) + (x.mail_failed ? ' (' + x.mail_failed + ' נכשלו)' : '') +
          (x.voice_tzintuk && x.voice_tzintuk !== 'none' ? ' · שמע: ' + esc(x.voice_tzintuk) : '') +
          '</div>' +
        (x.notes ? '<div class="count-line" style="color:var(--warn)">' + esc(x.notes) + '</div>' : '') +
        '</div>';
    }).join('') : '<div class="empty-state" style="padding:14px">אין רשומות</div>';
    window.UI.modal({
      title: 'היסטוריית שליחות',
      bodyHTML: body
    });
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.messaging = render;
})();
