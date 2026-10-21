'use strict';

/* Trang đăng ký: kiểm tra dữ liệu phía client rồi gọi POST /api/auth/register. */
(function () {
  const form = document.getElementById('register-form');
  const alertBox = document.getElementById('form-alert');
  const submitBtn = document.getElementById('register-submit');
  const fullNameInput = document.getElementById('fullName');
  const emailInput = document.getElementById('email');
  const phoneInput = document.getElementById('phone');
  const passwordInput = document.getElementById('password');
  const confirmInput = document.getElementById('passwordConfirm');
  const nextUrl = App.safeNextUrl('index.html');

  function validate() {
    const fullName = fullNameInput.value.trim().replace(/\s+/g, ' ');
    const email = emailInput.value.trim().toLowerCase();
    const phone = phoneInput.value.trim();
    const password = passwordInput.value;

    if (fullName.length < 2 || fullName.length > 120) {
      return { field: fullNameInput, message: 'Họ tên phải dài 2-120 ký tự.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) {
      return { field: emailInput, message: 'Email không hợp lệ.' };
    }
    if (phone !== '' && !/^[0-9+\s().-]{8,20}$/.test(phone)) {
      return { field: phoneInput, message: 'Số điện thoại không hợp lệ.' };
    }
    if (password.length < 8 || password.length > 72 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return {
        field: passwordInput,
        message: 'Mật khẩu phải dài 8-72 ký tự, gồm chữ thường, chữ hoa và chữ số.',
      };
    }
    if (password !== confirmInput.value) {
      return { field: confirmInput, message: 'Mật khẩu nhập lại không khớp.' };
    }
    return { payload: { fullName: fullName, email: email, phone: phone === '' ? null : phone, password: password } };
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    App.hideAlert(alertBox);

    const result = validate();
    if (result.message) {
      App.showAlert(alertBox, result.message, 'error');
      result.field.setAttribute('aria-invalid', 'true');
      result.field.focus();
      return;
    }

    [fullNameInput, emailInput, phoneInput, passwordInput, confirmInput].forEach(function (input) {
      input.removeAttribute('aria-invalid');
    });

    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang tạo tài khoản…';

    try {
      const data = await App.api('/api/auth/register', { method: 'POST', body: result.payload });
      App.setSession(data);
      App.toast('Đăng ký thành công. Chào mừng ' + data.user.fullName + '!', 'success');
      window.location.replace(nextUrl);
    } catch (error) {
      let message = error.message;
      if (error.details && error.details.length > 0) {
        message = error.details.map(function (item) {
          return item.message;
        }).join(' ');
      }
      App.showAlert(alertBox, message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Đăng ký';
    }
  });
})();
