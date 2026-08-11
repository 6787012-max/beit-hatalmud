// help.js — כפתור עזרה בכל מסך. קורא מ-guide-data.js (מקור אמת יחיד),
// כך שהעזרה מסונכרנת עם עמוד ההדרכה ועם הסרטונים. מוסיף כפתור "?" צף
// בכל עמוד, ופותח מודאל עם ההסבר של המסך הנוכחי (שלבים + דגשים).
// כולל את ההסבר על החלפת סיסמה — הבקשה של יוסף שיהיה עזרה ליד החלפת סיסמה.
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const G = () => window.CV3_GUIDE || { screens: {}, common: {} };

  function currentScreen() {
    const active = document.querySelector('.page.active');
    if (!active) return null;
    const id = (active.id || '').replace('page-', '');
    return id === 'home' ? null : id;
  }

  function guideHtml(entry) {
    if (!entry) return '';
    let h = '<div style="margin-bottom:6px"><i class="bi ' + esc(entry.icon || 'bi-info-circle') + '" style="color:var(--primary)"></i> <b>' + esc(entry.title) + '</b></div>';
    if (entry.intro) h += '<p style="color:var(--muted);margin:0 0 12px">' + esc(entry.intro) + '</p>';
    if (entry.steps && entry.steps.length) {
      h += '<div style="font-weight:700;margin-bottom:6px">שלב אחר שלב:</div><ol style="margin:0 0 12px 0;padding-inline-start:22px;line-height:1.9">';
      h += entry.steps.map(s => '<li>' + esc(s) + '</li>').join('');
      h += '</ol>';
    }
    if (entry.tips && entry.tips.length) {
      h += '<div style="background:var(--accent-soft);border-radius:10px;padding:10px 14px"><div style="font-weight:700;margin-bottom:4px"><i class="bi bi-lightbulb"></i> חשוב לזכור:</div><ul style="margin:0;padding-inline-start:20px;line-height:1.8">';
      h += entry.tips.map(t => '<li>' + esc(t) + '</li>').join('');
      h += '</ul></div>';
    }
    return h;
  }

  function openHelp(screenId) {
    const g = G();
    const entry = screenId ? g.screens[screenId] : null;
    let body = '';
    if (entry) body = guideHtml(entry);
    else body = guideHtml(g.common) + '<p style="margin-top:14px"><a href="hadracha/" style="color:var(--primary);font-weight:700"><i class="bi bi-play-circle"></i> לצפייה בסרטוני ההדרכה ›</a></p>';
    // תמיד מוסיפים גישה מהירה לכל ההדרכה
    body += '<div style="margin-top:14px;text-align:center"><a href="hadracha/" class="btn-ghost sm" style="text-decoration:none"><i class="bi bi-collection-play"></i> כל ההדרכות והסרטונים</a></div>';
    window.UI.modal({ title: 'עזרה — ' + (entry ? entry.title : 'המערכת'), bodyHTML: body });
  }
  window.cv3Help = openHelp;

  function mountButton() {
    if (document.getElementById('helpFab')) return;
    const btn = document.createElement('button');
    btn.id = 'helpFab';
    btn.className = 'help-fab';
    btn.title = 'עזרה למסך הנוכחי';
    btn.setAttribute('aria-label', 'עזרה');
    btn.innerHTML = '<i class="bi bi-question-lg"></i>';
    btn.addEventListener('click', () => openHelp(currentScreen()));
    document.body.appendChild(btn);
  }

  // הכפתור מופיע רק אחרי כניסה (למשתמש מחובר)
  function sync() {
    const loggedIn = !!window.currentUser;
    const fab = document.getElementById('helpFab');
    if (loggedIn && !fab) mountButton();
    if (fab) fab.style.display = loggedIn ? '' : 'none';
  }
  document.addEventListener('DOMContentLoaded', () => { setInterval(sync, 800); });
})();
