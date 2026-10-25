(function () {
  try {
    var saved = localStorage.getItem('dnsmgr_theme');
    var theme = saved === 'dark' || saved === 'light' ? saved : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
})();
