'use strict';

/* Trang đăng nhập: gọi POST /api/auth/login, lưu JWT rồi điều hướng. */
(function () {
  const form = document.getElementById('login-form');
  const alertBox = document.getElementById('form-alert');
  const submitBtn = document.getElementById('login-submit');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const nextUrl = App.safeNextUrl('index.html');

  function landingPage(user) {
    // Admin vào trang index mặc định sẽ được đưa thẳng tới bảng điều khiển.
    if (user.role === 'admin' && nextUrl === 'index.html') return 'admin.html';
    return nextUrl;
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    App.hideAlert(alertBox);

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      App.showAlert(alertBox, 'Vui lòng nhập đầy đủ email và mật khẩu.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang đăng nhập…';

    try {
      const data = await App.api('/api/auth/login', {
        method: 'POST',
        body: { email: email, password: password },
      });
      App.setSession(data);
      App.toast('Xin chào ' + data.user.fullName + '!', 'success');
      window.location.replace(landingPage(data.user));
    } catch (error) {
      App.showAlert(alertBox, error.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Đăng nhập';
      passwordInput.value = '';
      passwordInput.focus();
    }
  });
})();
