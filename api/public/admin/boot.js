(function () {
  try {
    var raw = localStorage.getItem('platformAdminSession');
    if (raw) {
      var session = JSON.parse(raw);
      if (session && session.password) {
        document.documentElement.classList.add('has-admin-session');
      }
    }
  } catch (e) {}
  document.documentElement.classList.add('admin-boot-done');
})();
