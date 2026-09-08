// edu-sources.js — מקורות טקסט חינוכיים שמנהל מעלה, ומוזנים ל-AI (2026-09-08, בקשת יוסף).
//
// בנוסף ל-METHOD_PROMPT הקבוע (שיטת "לא ניתן החינוך למלאכי השרת") — מנהל יכול להדביק
// כאן קטעי טקסט (מכתבים, שיעורים, ספרים, "שיטת הרב X") וה-AI ילמד וישלב אותם בניתוחים.
// טבלה: edu_sources (RLS: קריאה לכל מחובר, כתיבה למנהל בלבד — ראה migration_edu_sources.sql).
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Gemini flash סובל הקשר גדול בהרבה, אבל אין טעם לנפח כל קריאה — תקרה סבירה לכמה מקורות מצטברים.
  const MAXLEN = 6000;

  async function list() {
    try { return await window.store.list('edu_sources'); } catch (_) { return []; }
  }

  // טקסט מאוחד לצירוף לפרומפט — רק מקורות פעילים. sig נגזר ממספר המקורות ומאורכם
  // הכולל, כדי שהוספה/עריכה/כיבוי של מקור תפסול את מטמון סיכומי ה-AI הקיימים.
  async function sourcesText() {
    const rows = (await list()).filter(r => r.active !== false);
    if (!rows.length) return { text: '', sig: 'es0' };
    let text = rows.map(r => '### ' + (r.title || 'מקור') + '\n' + (r.content || '')).join('\n\n');
    if (text.length > MAXLEN) text = text.slice(0, MAXLEN) + '…';
    const sig = 'es' + rows.length + '-' + rows.reduce((s, r) => s + (r.content || '').length, 0);
    return { text, sig };
  }

  // פאנל ניהול — להטמיע בתוך מסך ההגדרות (מנהל בלבד; ה-RLS ממילא חוסם כתיבה מאחרים).
  function renderPanel(host) {
    if (!host) return;
    let rows = [];
    async function draw() {
      rows = await list();
      host.innerHTML =
        '<p class="login-hint" style="margin:0 0 8px">קטעי טקסט חינוכיים (ספר, שיעור, מכתב, "שיטת הרב...") שה-AI ' +
        'ילמד מהם וישלב בחוות הדעת והניתוחים — בנוסף לשיטת "לא ניתן החינוך למלאכי השרת" שכבר מוטמעת תמיד. ' +
        'אפשר לכבות מקור זמנית בלי למחוק.</p>' +
        '<div id="esList"></div>' +
        '<div class="qr-grid" style="grid-template-columns:1fr;margin-top:10px">' +
          '<input class="inp mb0" id="esTitle" placeholder="כותרת המקור (למשל: פרק ג, מכתב לצוות)">' +
          '<textarea class="inp mb0" id="esBody" rows="4" placeholder="הדבק כאן את הטקסט…" style="margin-top:6px;resize:vertical"></textarea>' +
          '<button class="btn-primary sm" id="esAdd" style="margin-top:6px;justify-self:start"><i class="bi bi-plus-lg"></i> הוסף מקור</button>' +
        '</div>';
      host.querySelector('#esList').innerHTML = rows.length ? rows.map(r =>
        '<div class="tl-item" style="align-items:flex-start">' +
          '<span class="sev-dot ' + (r.active === false ? 'lo' : 'mid') + '"></span>' +
          '<div class="tl-main"><b>' + esc(r.title || 'ללא כותרת') + '</b>' + (r.active === false ? ' <span class="det-badge">כבוי</span>' : '') +
            '<div class="tl-note" style="margin-top:2px;white-space:pre-wrap">' + esc((r.content || '').slice(0, 200)) + ((r.content || '').length > 200 ? '…' : '') + '</div></div>' +
          '<button class="mini" data-estoggle="' + r.id + '" title="' + (r.active === false ? 'הפעלה' : 'כיבוי') + '"><i class="bi bi-toggle-' + (r.active === false ? 'off' : 'on') + '"></i></button>' +
          '<button class="mini danger" data-esdel="' + r.id + '" title="מחיקה"><i class="bi bi-trash"></i></button>' +
        '</div>').join('') : '<div class="tl-note" style="padding:8px">אין מקורות עדיין — ה-AI פועל רק לפי השיטה המובנית</div>';
      host.querySelectorAll('[data-estoggle]').forEach(b => b.addEventListener('click', async () => {
        const r = rows.find(x => String(x.id) === b.dataset.estoggle); if (!r) return;
        const r2 = await window.store.update('edu_sources', r.id, { active: r.active === false });
        if (r2 && r2.ok === false) { window.UI.toast('שגיאה: ' + (r2.error || ''), 'err'); return; }
        draw();
      }));
      host.querySelectorAll('[data-esdel]').forEach(b => b.addEventListener('click', async () => {
        const r = rows.find(x => String(x.id) === b.dataset.esdel); if (!r) return;
        if (!(await window.UI.confirm('למחוק את המקור "' + esc(r.title || '') + '"?'))) return;
        const r2 = await window.store.remove('edu_sources', r.id);
        if (r2 && r2.ok === false) { window.UI.toast('שגיאה במחיקה: ' + (r2.error || ''), 'err'); return; }
        draw(); window.UI.toast('נמחק');
      }));
      host.querySelector('#esAdd').addEventListener('click', async () => {
        const titleEl = host.querySelector('#esTitle'), bodyEl = host.querySelector('#esBody');
        const title = titleEl.value.trim(), content = bodyEl.value.trim();
        if (!content) { window.UI.toast('נא להדביק טקסט', 'err'); return; }
        const r = await window.store.add('edu_sources', { title: title || 'ללא כותרת', content, active: true });
        if (!r || r.ok === false) { window.UI.toast('שגיאה בשמירה: ' + ((r && r.error) || ''), 'err'); return; }
        window.UI.toast('המקור נוסף');
        draw();
      });
    }
    draw();
  }

  window.cv3EduSources = { sourcesText, renderPanel };
})();
