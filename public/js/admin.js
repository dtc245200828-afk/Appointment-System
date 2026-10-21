'use strict';

/* =====================================================================
 * Trang quản trị (admin.html)
 * Chỉ tài khoản role = admin (kiểm tra lại ở server mỗi request) mới dùng được.
 * ===================================================================== */

(function () {
  const els = {
    pageAlert: document.getElementById('page-alert'),
    refreshAll: document.getElementById('refresh-all'),
    list: document.getElementById('appointments-list'),
    listSummary: document.getElementById('list-summary'),
    filterForm: document.getElementById('filter-form'),
    filterStatus: document.getElementById('filter-status'),
    filterDate: document.getElementById('filter-date'),
    filterQ: document.getElementById('filter-q'),
    clearFilters: document.getElementById('clear-filters'),
    pageInfo: document.getElementById('page-info'),
    pagePrev: document.getElementById('page-prev'),
    pageNext: document.getElementById('page-next'),
    stats: {
      pending: document.getElementById('stat-pending'),
      confirmed: document.getElementById('stat-confirmed'),
      completed: document.getElementById('stat-completed'),
      cancelled: document.getElementById('stat-cancelled'),
      today: document.getElementById('stat-today'),
      total: document.getElementById('stat-total'),
      customers: document.getElementById('stat-customers'),
      slots: document.getElementById('stat-slots'),
    },
  };

  const state = {
    status: '',
    date: '',
    q: '',
    page: 1,
    limit: 20,
    total: 0,
  };

  function handleAuthError(error) {
    if (error.status === 401) {
      App.clearSession();
      App.goToLogin();
      return true;
    }
    if (error.status === 403) {
      App.toast('Bạn không có quyền truy cập chức năng này.', 'error');
      window.setTimeout(function () {
        window.location.replace('index.html');
      }, 900);
      return true;
    }
    return false;
  }

  async function loadStats() {
    try {
      const data = await App.api('/api/admin/stats');
      const appointments = data.appointments || {};
      const users = data.users || {};
      const slots = data.slots || {};

      els.stats.pending.textContent = appointments.pending ?? 0;
      els.stats.confirmed.textContent = appointments.confirmed ?? 0;
      els.stats.completed.textContent = appointments.completed ?? 0;
      els.stats.cancelled.textContent = appointments.cancelled ?? 0;
      els.stats.today.textContent = appointments.today ?? 0;
      els.stats.total.textContent = appointments.total ?? 0;
      els.stats.customers.textContent = users.customers ?? 0;
      els.stats.slots.textContent = slots.available ?? 0;
    } catch (error) {
      if (handleAuthError(error)) return;
      App.showAlert(els.pageAlert, 'Không tải được số liệu tổng quan: ' + error.message, 'error');
    }
  }

  function buildQuery() {
    const params = new URLSearchParams();
    if (state.status) params.set('status', state.status);
    if (state.date) params.set('date', state.date);
    if (state.q) params.set('q', state.q);
    params.set('page', String(state.page));
    params.set('limit', String(state.limit));
    return params.toString();
  }

  function renderAppointments(appointments) {
    if (!appointments || appointments.length === 0) {
      els.list.innerHTML = '<div class="empty">Không có lịch hẹn nào khớp điều kiện lọc.</div>';
      return;
    }

    const rows = appointments
      .map(function (item) {
        const slot = item.slot || {};
        const user = item.user || {};
        const contact = [user.email, user.phone].filter(Boolean).join(' · ');

        let actions = '<span class="muted small">—</span>';
        if (item.status === 'pending') {
          actions =
            '<button type="button" class="btn btn-success btn-sm" data-action="confirm" data-id="' +
            item.id + '">Xác nhận</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-action="cancel" data-id="' +
            item.id + '">Huỷ</button>';
        } else if (item.status === 'confirmed') {
          actions =
            '<button type="button" class="btn btn-danger btn-sm" data-action="cancel" data-id="' +
            item.id + '">Huỷ</button>';
        }

        const noteHtml = item.note ? App.escapeHtml(item.note) : '<span class="muted">—</span>';
        const reasonHtml = item.cancelReason
          ? '<div class="muted small">Lý do huỷ: ' + App.escapeHtml(item.cancelReason) + '</div>'
          : '';

        return (
          '<tr>' +
          '<td><strong>' + App.escapeHtml(user.fullName || 'Không xác định') + '</strong>' +
          '<div class="muted small">' + App.escapeHtml(contact) + '</div></td>' +
          '<td>' + App.escapeHtml(slot.serviceName) +
          '<div class="muted small">' + App.formatDuration(slot.durationMinutes) + ' · ' +
          App.formatMoney(slot.price) + '</div></td>' +
          '<td>' + App.formatTime(slot.startTime) + ' - ' + App.formatTime(slot.endTime) +
          '<div class="muted small">' + App.formatDate(slot.startTime) + '</div></td>' +
          '<td>' + App.statusBadge(item.status) + '</td>' +
          '<td>' + noteHtml + reasonHtml + '</td>' +
          '<td class="cell-actions">' + actions + '</td>' +
          '</tr>'
        );
      })
      .join('');

    els.list.innerHTML =
      '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>Khách hàng</th><th>Dịch vụ</th><th>Thời gian</th><th>Trạng thái</th><th>Ghi chú</th><th>Thao tác</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderPagination(total) {
    const totalPages = Math.max(1, Math.ceil(total / state.limit));
    if (state.page > totalPages) {
      state.page = totalPages;
    }
    const first = total === 0 ? 0 : (state.page - 1) * state.limit + 1;
    const last = Math.min(state.page * state.limit, total);

    els.pageInfo.textContent =
      'Trang ' + state.page + '/' + totalPages + ' · Hiển thị ' + first + '–' + last + ' trên ' + total + ' lịch hẹn';
    els.listSummary.textContent = total + ' kết quả';
    els.pagePrev.disabled = state.page <= 1;
    els.pageNext.disabled = state.page >= totalPages;
  }

  async function loadAppointments() {
    els.list.innerHTML = '<div class="loading">Đang tải lịch hẹn…</div>';
    try {
      const data = await App.api('/api/admin/appointments?' + buildQuery());
      state.total = data.total || 0;
      renderAppointments(data.appointments || []);
      renderPagination(state.total);
    } catch (error) {
      if (handleAuthError(error)) return;
      els.list.innerHTML = '<div class="empty">Không tải được danh sách lịch hẹn.</div>';
      App.showAlert(els.pageAlert, error.message, 'error');
    }
  }

  async function refreshAll() {
    App.hideAlert(els.pageAlert);
    await Promise.all([loadStats(), loadAppointments()]);
  }

  els.list.addEventListener('click', async function (event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const appointmentId = Number(button.dataset.id);
    let body = null;

    if (action === 'cancel') {
      const answer = window.prompt('Lý do huỷ lịch hẹn:', 'Quản trị viên huỷ lịch');
      if (answer === null) return;
      body = { reason: answer.trim().slice(0, 500) || 'Quản trị viên huỷ lịch' };
    }

    button.disabled = true;
    try {
      const data = await App.api('/api/admin/appointments/' + appointmentId + '/' + action, {
        method: 'PATCH',
        body: body,
      });
      App.toast(data.message || 'Đã cập nhật lịch hẹn.', 'success');
      await refreshAll();
    } catch (error) {
      if (handleAuthError(error)) return;
      App.toast(error.message, 'error');
      button.disabled = false;
    }
  });

  els.filterForm.addEventListener('submit', function (event) {
    event.preventDefault();
    state.status = els.filterStatus.value;
    state.date = els.filterDate.value;
    state.q = els.filterQ.value.trim();
    state.page = 1;
    loadAppointments();
  });

  els.clearFilters.addEventListener('click', function () {
    els.filterForm.reset();
    state.status = '';
    state.date = '';
    state.q = '';
    state.page = 1;
    loadAppointments();
  });

  els.pagePrev.addEventListener('click', function () {
    if (state.page <= 1) return;
    state.page -= 1;
    loadAppointments();
  });

  els.pageNext.addEventListener('click', function () {
    state.page += 1;
    loadAppointments();
  });

  els.refreshAll.addEventListener('click', refreshAll);

  (async function init() {
    const user = await App.initHeader({ requireAuth: true, adminOnly: true });
    if (!user) return;
    await refreshAll();
  })();
})();

