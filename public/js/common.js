'use strict';

/* =====================================================================
 * Đề 40 - Hệ thống đặt lịch hẹn trực tuyến
 * File: public/js/common.js
 * Tiện ích dùng chung: gọi API, quản lý phiên đăng nhập, định dạng dữ liệu.
 * Toàn bộ script nằm trong file riêng để tuân thủ CSP script-src 'self'.
 * ===================================================================== */

(function () {
  const TOKEN_KEY = 'appointment.token';
  const USER_KEY = 'appointment.user';
  const TIMEZONE = 'Asia/Ho_Chi_Minh';

  const STATUS_LABELS = {
    pending: 'Chờ xác nhận',
    confirmed: 'Đã xác nhận',
    completed: 'Hoàn thành',
    cancelled: 'Đã huỷ',
    available: 'Còn trống',
    booked: 'Đã đặt',
    blocked: 'Bị khoá',
  };

  const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const moneyFormatter = new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  });

  function getUser() {
    try {
      const raw = window.localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function getToken() {
    return window.localStorage.getItem(TOKEN_KEY);
  }

  function setSession(payload) {
    if (payload.token) window.localStorage.setItem(TOKEN_KEY, payload.token);
    if (payload.user) window.localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
  }

  function clearSession() {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  }

  class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details || [];
    }
  }

  /**
   * Gọi API nội bộ. Tự gắn Bearer token và chuẩn hoá lỗi về ApiError
   * để các trang chỉ cần try/catch một dạng lỗi duy nhất.
   */
  async function api(path, options) {
    const opts = options || {};
    const headers = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    let body;
    if (opts.body !== undefined && opts.body !== null) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    let response;
    try {
      response = await fetch(path, {
        method: opts.method || 'GET',
        headers: headers,
        body: body,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch (error) {
      throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được tới máy chủ. Vui lòng kiểm tra kết nối.');
    }

    let payload = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = null;
      }
    }

    if (!response.ok) {
      const error = (payload && payload.error) || {};
      throw new ApiError(
        response.status,
        error.code || 'UNKNOWN_ERROR',
        error.message || 'Đã xảy ra lỗi, vui lòng thử lại.',
        error.details
      );
    }

    return payload;
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    return date ? dateTimeFormatter.format(date) : '—';
  }

  function formatDate(value) {
    const date = parseDate(value);
    return date ? dateFormatter.format(date) : '—';
  }

  function formatTime(value) {
    const date = parseDate(value);
    return date ? timeFormatter.format(date) : '—';
  }

  function formatMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? moneyFormatter.format(number) : '—';
  }

  function formatDuration(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value)) return '—';
    if (value < 60) return value + ' phút';
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return rest === 0 ? hours + ' giờ' : hours + ' giờ ' + rest + ' phút';
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || '—';
  }

  function statusBadge(status) {
    const cssClass = ['pending', 'confirmed', 'completed', 'cancelled'].includes(status)
      ? 'badge badge-' + status
      : 'badge badge-neutral';
    return '<span class="' + cssClass + '">' + escapeHtml(statusLabel(status)) + '</span>';
  }

  function toast(message, type) {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const item = document.createElement('div');
    item.className = 'toast toast-' + (type || 'info');
    item.textContent = message;
    stack.appendChild(item);
    window.setTimeout(function () {
      item.remove();
    }, 4500);
  }

  function showAlert(element, message, type) {
    if (!element) return;
    element.textContent = message;
    element.className = 'alert alert-' + (type || 'info');
    element.hidden = false;
  }

  function hideAlert(element) {
    if (!element) return;
    element.hidden = true;
    element.textContent = '';
  }

  function queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function safeNextUrl(fallback) {
    const next = queryParam('next');
    if (!next) return fallback;
    // Chỉ cho phép đường dẫn tương đối trong cùng ứng dụng (chống open redirect).
    if (/^[a-z0-9._-]+\.html(\?.*)?$/i.test(next)) return next;
    return fallback;
  }

  function currentPage() {
    const name = window.location.pathname.split('/').pop();
    return name && name.length > 0 ? name : 'index.html';
  }

  function goToLogin() {
    const next = encodeURIComponent(currentPage() + window.location.search);
    window.location.replace('login.html?next=' + next);
  }

  /**
   * Khởi tạo phần header: hiển thị người dùng, nút đăng xuất, liên kết admin.
   * Khi requireAuth = true, gọi /api/auth/me để kiểm tra token còn hiệu lực
   * (token hết hạn hoặc tài khoản bị khoá sẽ bị đẩy về trang đăng nhập).
   */
  async function initHeader(options) {
    const opts = options || {};
    const userSlot = document.getElementById('nav-user');
    const adminLink = document.getElementById('nav-admin');
    const loginLink = document.getElementById('nav-login');
    const registerLink = document.getElementById('nav-register');
    const logoutBtn = document.getElementById('nav-logout');

    let user = getUser();

    if (opts.requireAuth) {
      if (!getToken()) {
        goToLogin();
        return null;
      }
      try {
        const data = await api('/api/auth/me');
        user = data.user;
        setSession({ user: user });
      } catch (error) {
        clearSession();
        goToLogin();
        return null;
      }
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        clearSession();
        window.location.href = 'login.html';
      });
    }

    if (user) {
      if (userSlot) {
        userSlot.textContent = user.fullName + ' · ' + (user.role === 'admin' ? 'Quản trị' : 'Khách hàng');
        userSlot.hidden = false;
      }
      if (loginLink) loginLink.hidden = true;
      if (registerLink) registerLink.hidden = true;
      if (logoutBtn) logoutBtn.hidden = false;
      if (adminLink) adminLink.hidden = user.role !== 'admin';
    } else {
      if (logoutBtn) logoutBtn.hidden = true;
      if (adminLink) adminLink.hidden = true;
    }

    if (opts.adminOnly && (!user || user.role !== 'admin')) {
      toast('Trang này chỉ dành cho quản trị viên.', 'error');
      window.setTimeout(function () {
        window.location.replace('index.html');
      }, 900);
      return null;
    }

    return user;
  }

  window.App = {
    TIMEZONE: TIMEZONE,
    ApiError: ApiError,
    api: api,
    getToken: getToken,
    getUser: getUser,
    setSession: setSession,
    clearSession: clearSession,
    initHeader: initHeader,
    goToLogin: goToLogin,
    escapeHtml: escapeHtml,
    formatDateTime: formatDateTime,
    formatDate: formatDate,
    formatTime: formatTime,
    formatMoney: formatMoney,
    formatDuration: formatDuration,
    statusLabel: statusLabel,
    statusBadge: statusBadge,
    toast: toast,
    showAlert: showAlert,
    hideAlert: hideAlert,
    queryParam: queryParam,
    safeNextUrl: safeNextUrl,
  };
})();

