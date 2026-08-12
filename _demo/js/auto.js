(function () {
  var q = new URLSearchParams(location.search);
  var page = q.get('auto'); if (!page) return;
  var openCard = q.get('card');
  function waitFor(sel, cb, tries) {
    tries = tries || 0; var el = document.querySelector(sel);
    if (el) return cb(el);
    if (tries > 80) return;
    setTimeout(function () { waitFor(sel, cb, tries + 1); }, 120);
  }
  waitFor('#loginTz', function () {
    document.querySelector('#loginTz').value = 'עמנואל רקובסקי';
    document.querySelector('#loginPw').value = '0548451402';
    document.querySelector('#loginBtn').click();
    setTimeout(function () {
      if (page !== 'home') window.showPage(page);
      if (openCard) setTimeout(function () { var b = document.querySelector('[data-view="' + openCard + '"]'); if (b) b.click(); }, 1100);
    }, 1000);
  });
})();
