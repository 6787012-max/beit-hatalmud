// voicereports.js — דיווחים קוליים ממורים (מנהל בלבד).
// מורה משאיר הודעה קולית בקו → תמלול AI (Gemini) → טיוטת דיווח → עריכה ואישור מנהל.
// הכל מקוון: מוריד את ההקלטה מימות בדפדפן, מתמלל ומנסח מול Gemini, שומר ב-Supabase.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DEFAULT_FOLDER = 'ivr2:/4';   // שלוחת "דיווח מורים" הייעודית
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  let students = [];

  // אחסון טיוטות: Supabase אם הטבלה קיימת, אחרת נפילה חלקה ל-localStorage
  // (כדי שהפיצ'ר יעבוד מיד גם לפני הרצת מיגרציית ה-SQL).
  let useLocal = false;
  const LS = 'cv3_voice_reports_local';
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (_) { return []; } };
  const lsSet = a => { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (_) {} };
  const vr = {
    async probe() {
      if (window.db.DEMO) { useLocal = true; return; }
      const r = await window.db.list('voice_reports', {});
      useLocal = !r.ok;   // הטבלה חסרה → אחסון מקומי
    },
    async list() {
      if (useLocal) return { ok: true, data: lsGet().filter(x => x.status === 'draft').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')) };
      return window.db.list('voice_reports', { eq: { status: 'draft' }, order: 'created_at', asc: false });
    },
    async insert(row) {
      if (useLocal) { const a = lsGet(); a.push(Object.assign({ id: 'L' + Date.now() + Math.random().toString(36).slice(2, 6), created_at: new Date().toISOString() }, row)); lsSet(a); return { ok: true }; }
      return window.db.insert('voice_reports', row);
    },
    async update(id, patch) {
      if (useLocal) { const a = lsGet(); const i = a.findIndex(x => String(x.id) === String(id)); if (i >= 0) { Object.assign(a[i], patch); lsSet(a); } return { ok: true }; }
      return window.db.update('voice_reports', id, patch);
    },
    async remove(id) {
      if (useLocal) { lsSet(lsGet().filter(x => String(x.id) !== String(id))); return { ok: true }; }
      return window.db.remove('voice_reports', id);
    }
  };

  async function render(page) {
    page.innerHTML =
      '<div class="page-head"><button class="back" onclick="showPage(\'home\')">→ חזרה לתפריט</button><h2>דיווחים קוליים ממורים</h2></div>' +
      '<div class="qr-card"><p class="login-hint" style="margin:0">מורה משאיר הודעה קולית בקו ימות (שם + דיווח). המערכת מתמללת, יוצרת טיוטת דיווח מקצועית — ואתם עורכים ומאשרים לפני שהיא נכנסת לתיק התלמיד.</p></div>' +

      '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-soundwave"></i> הקלטות חדשות בקו</h3>' +
        '<button class="btn-ghost sm" id="vrRefresh"><i class="bi bi-arrow-clockwise"></i> רענון</button></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
          '<label style="display:flex;align-items:center;gap:6px">תיקיית הקלטות ' +
          '<input class="inp mb0" id="vrFolder" value="' + DEFAULT_FOLDER + '" style="width:200px;direction:ltr;text-align:left"></label></div>' +
        '<div id="vrRecs"><div class="empty-state" style="padding:14px">טוען…</div></div></div>' +

      '<div class="qr-card"><div class="card-h-row"><h3><i class="bi bi-pencil-square"></i> טיוטות ממתינות לאישור</h3>' +
        '<button class="btn-ghost sm" id="vrRefreshDrafts"><i class="bi bi-arrow-clockwise"></i> רענון</button></div>' +
        '<div id="vrDrafts"><div class="empty-state" style="padding:14px">טוען…</div></div></div>';

    page.querySelector('#vrRefresh').addEventListener('click', () => loadRecs(page));
    page.querySelector('#vrRefreshDrafts').addEventListener('click', () => loadDrafts(page));
    // רשימת תלמידים לקישור
    try { const r = await window.db.list('students', { order: 'name' }); students = r.ok ? r.data : []; } catch (_) { students = []; }
    await vr.probe();
    loadRecs(page); loadDrafts(page);
  }

  // ---------- הקלטות חדשות בקו ----------
  async function loadRecs(page) {
    const box = page.querySelector('#vrRecs');
    if (!window.Yemot || !window.Yemot.token()) {
      box.innerHTML = '<div class="empty-state" style="padding:14px">כדי לטעון הקלטות, התחברו קודם לקו בעמוד ' +
        '<a href="#" onclick="showPage(\'yemot\');return false" style="color:var(--accent)">קו ימות המשיח</a>.</div>';
      return;
    }
    const folder = page.querySelector('#vrFolder').value.trim() || DEFAULT_FOLDER;
    box.innerHTML = '<div class="empty-state" style="padding:14px">טוען הקלטות…</div>';
    try {
      const d = await window.Yemot.call('GetIVR2Dir', { path: folder });
      if (d.responseStatus !== 'OK') { box.innerHTML = '<div class="empty-state" style="padding:14px">' + esc(d.message || 'לא ניתן לטעון') + '</div>'; return; }
      // הקלטות אמיתיות בלבד — מדלגים על הודעת הפתיחה (000) וקבצי מערכת
      const wavs = (d.files || []).filter(f => (f.name || '').match(/\.(wav|mp3)$/i) && !/^000\./.test(f.name || ''));
      if (!wavs.length) { box.innerHTML = '<div class="empty-state" style="padding:14px">אין הקלטות חדשות בתיקייה זו.</div>'; return; }
      box.innerHTML = wavs.map(f => {
        const full = folder.replace(/\/$/, '') + '/' + f.name;
        return '<div class="ym-row"><span class="ym-ic"><i class="bi bi-mic"></i></span>' +
          '<div class="ym-main"><b>' + esc(f.name) + '</b></div>' +
          '<audio controls preload="none" src="' + esc(window.Yemot.downloadUrl(full)) + '" style="height:34px;max-width:180px"></audio>' +
          '<button class="btn-primary sm" data-tx="' + esc(full) + '"><i class="bi bi-magic"></i> תמלל וצור טיוטה</button></div>';
      }).join('');
      box.querySelectorAll('[data-tx]').forEach(b => b.addEventListener('click', () => transcribe(page, b)));
    } catch (e) { box.innerHTML = '<div class="empty-state" style="padding:14px">שגיאת רשת בטעינת הקלטות.</div>'; }
  }

  async function blobToB64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  }

  async function transcribe(page, btn) {
    const path = btn.dataset.tx;
    const key = window.geminiKey && window.geminiKey();
    if (!key) { window.UI.toast('מפתח Gemini חסר — הגדירו בעמוד קו ימות', 'err'); return; }
    btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> מתמלל…';
    try {
      const res = await fetch(window.Yemot.downloadUrl(path));
      const blob = await res.blob();
      const b64 = await blobToB64(blob);
      const mime = /\.mp3$/i.test(path) ? 'audio/mp3' : 'audio/wav';
      const prompt = 'קיבלת הקלטה קולית של מורה שמדווח על תלמידים. החזר JSON בלבד עם: ' +
        'transcript (תמלול מדויק של ההקלטה), teacher_name (שם המורה/רב שמדבר), ' +
        'reports (מערך — אחד לכל תלמיד שהוזכר, כל אחד עם: student_name, severity (חיובי/שלילי/ניטרלי), ' +
        'report_type (behavior/functioning/general), report_text — ניסוח מקצועי, מכובד ומדויק בגוף שלישי, מתאים לתיק תלמיד).';
      const body = { contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }] }],
        generationConfig: { responseMimeType: 'application/json' } };
      const r = await fetch(GEMINI + '?key=' + encodeURIComponent(key),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || 'שגיאת תמלול');
      const out = JSON.parse(j.candidates[0].content.parts[0].text);
      const reports = Array.isArray(out.reports) && out.reports.length ? out.reports : [{ report_text: out.transcript, severity: 'ניטרלי', report_type: 'general' }];
      let saved = 0;
      for (const rep of reports) {
        const match = students.find(s => rep.student_name && (s.name || '').trim() === String(rep.student_name).trim());
        const ins = await vr.insert({
          audio_path: path, audio_name: path.split('/').pop(),
          teacher_name: out.teacher_name || '', student_id: match ? match.id : null,
          transcript: out.transcript || '', report_text: rep.report_text || '',
          report_type: rep.report_type || 'general', severity: rep.severity || '',
          status: 'draft', created_by: (window.currentUser && window.currentUser.id) || null
        });
        if (ins.ok) saved++;
      }
      window.UI.toast('נוצרו ' + saved + ' טיוטות מההקלטה', 'ok');
      loadDrafts(page);
    } catch (e) {
      window.UI.toast('התמלול נכשל: ' + (e.message || e), 'err');
    } finally { btn.disabled = false; btn.innerHTML = orig; }
  }

  // ---------- טיוטות ממתינות לאישור ----------
  async function loadDrafts(page) {
    const box = page.querySelector('#vrDrafts');
    box.innerHTML = '<div class="empty-state" style="padding:14px">טוען…</div>';
    const r = await vr.list();
    if (!r.ok) { box.innerHTML = '<div class="empty-state" style="padding:14px">שגיאה בטעינת טיוטות: ' + esc(r.error || '') + '</div>'; return; }
    if (useLocal && r.data.length) box.dataset.local = '1';
    const localNote = useLocal ? '<p class="login-hint" style="margin:0 0 10px"><i class="bi bi-hdd"></i> הטיוטות נשמרות כרגע במכשיר זה בלבד. להפעלת שמירה משותפת בענן — יש להריץ פעם אחת את מיגרציית ה-SQL.</p>' : '';
    if (!r.data.length) { box.innerHTML = localNote + '<div class="empty-state" style="padding:14px">אין טיוטות ממתינות.</div>'; return; }
    box.innerHTML = localNote + r.data.map(d => draftCard(d)).join('');
    box.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => approve(page, b.closest('.vr-draft'), b.dataset.approve)));
    box.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => setStatus(page, b.dataset.reject, 'rejected')));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => del(page, b.dataset.del)));
  }

  function draftCard(d) {
    const opts = '<option value="">— ללא קישור לתלמיד —</option>' +
      students.map(s => '<option value="' + s.id + '"' + (s.id === d.student_id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
    const sevColor = d.severity === 'חיובי' ? '#1f8a5b' : (d.severity === 'שלילי' ? '#c0392b' : '#7f8c8d');
    return '<div class="vr-draft" data-id="' + d.id + '" style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px">' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
        '<span class="ym-badge"><i class="bi bi-person-badge"></i> ' + esc(d.teacher_name || 'מורה') + '</span>' +
        '<span class="chip" style="background:' + sevColor + '22;color:' + sevColor + '">' + esc(d.severity || 'ניטרלי') + '</span>' +
        '<span class="ym-note">' + esc((d.created_at || '').slice(0, 16).replace('T', ' ')) + '</span></div>' +
      (d.transcript ? '<details style="margin-bottom:8px"><summary style="cursor:pointer;color:var(--muted)">תמלול מקורי</summary>' +
        '<p style="white-space:pre-wrap;color:var(--muted);font-size:.92em">' + esc(d.transcript) + '</p></details>' : '') +
      '<label class="lbl">טיוטת הדיווח (ניתן לערוך)</label>' +
      '<textarea class="inp vr-text" rows="3">' + esc(d.report_text) + '</textarea>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
        '<label style="display:flex;align-items:center;gap:6px">תלמיד <select class="inp mb0 vr-student" style="width:auto">' + opts + '</select></label>' +
        '<button class="btn-primary sm" data-approve="' + d.id + '"><i class="bi bi-check-lg"></i> אשר והכנס לתיק</button>' +
        '<button class="btn-ghost sm" data-reject="' + d.id + '"><i class="bi bi-x-circle"></i> דחה</button>' +
        '<button class="mini danger" data-del="' + d.id + '" title="מחק"><i class="bi bi-trash"></i></button></div></div>';
  }

  async function approve(page, card, id) {
    const text = card.querySelector('.vr-text').value.trim();
    const studentId = card.querySelector('.vr-student').value;
    if (!text) { window.UI.toast('הדיווח ריק', 'err'); return; }
    const uid = (window.currentUser && window.currentUser.id) || null;
    // עדכון הטיוטה למאושרת
    const up = await vr.update(id, {
      report_text: text, student_id: studentId || null, status: 'approved',
      approved_by: uid, approved_at: new Date().toISOString()
    });
    if (!up.ok) { window.UI.toast('האישור נכשל: ' + (up.error || ''), 'err'); return; }
    // אם קושר לתלמיד — כותב גם רשומת מעקב אמיתית בתיק
    if (studentId) {
      await window.db.insert('behavior_events', {
        student_id: Number(studentId), note: text,
        event_date: new Date().toISOString().slice(0, 10), created_by: uid
      });
    }
    window.UI.toast('הדיווח אושר' + (studentId ? ' ונכנס לתיק התלמיד' : ''), 'ok');
    loadDrafts(page);
  }

  async function setStatus(page, id, status) {
    const up = await vr.update(id, { status });
    window.UI.toast(up.ok ? 'הטיוטה נדחתה' : 'שגיאה', up.ok ? 'ok' : 'err');
    loadDrafts(page);
  }
  async function del(page, id) {
    if (!(await window.UI.confirm('למחוק את הטיוטה לצמיתות?'))) return;
    const r = await vr.remove(id);
    window.UI.toast(r.ok ? 'נמחק' : 'שגיאה', r.ok ? 'ok' : 'err');
    loadDrafts(page);
  }

  window.PAGE_RENDERERS = window.PAGE_RENDERERS || {};
  window.PAGE_RENDERERS.voicereports = render;
})();
