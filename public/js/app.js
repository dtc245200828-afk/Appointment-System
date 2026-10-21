'use strict';

/* =====================================================================
 * Trang đặt lịch (index.html)
 * Luồng: chọn dịch vụ -> chọn khung giờ -> gửi yêu cầu -> xem/duyệt lịch hẹn.
 * ===================================================================== */

(function () {
  const els = {
    pageAlert: document.getElementById('page-alert'),
    tzBadge: document.getElementById('tz-badge'),
    serviceList: document.getElementById('service-list'),
    reloadServices: document.getElementById('reload-services'),
    date: document.getElementById('slot-date'),
    slotArea: document.getElementById('slot-area'),
    summary: document.getElementById('selected-summary'),
    form: document.getElementById('booking-form'),
    note: document.getElementById('booking-note'),
    submit: document.getElementById('booking-submit'),
    reset: document.getElementById('booking-reset'),
    mine: document.getElementById('my-appointments'),
    reloadMine: document.getElementById('reload-mine'),
  };

  const state = {
    services: [],
    serviceId: null,
    date: null,
    slots: [],
    selectedSlot: null,
  };

  const hourFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: App.TIMEZONE,
    hour: '2-digit',
    hour12: false,
  });

  // Lấy ngày hiện tại theo múi giờ Việt Nam, không phụ thuộc timezone máy khách.
  function todayInTimezone() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: App.TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(function (part) {
      map[part.type] = part.value;
    });
    return map.year + '-' + map.month + '-' + map.day;
  }

  function findService(id) {
    return state.services.find(function (item) {
      return item.id === id;
    }) || null;
  }

  function findSlot(id) {
    return state.slots.find(function (item) {
      return item.id === id;
    }) || null;
  }

  function renderServices() {
    if (state.services.length === 0) {
      els.serviceList.innerHTML = '<div class="empty">Hiện chưa có dịch vụ nào đang hoạt động.</div>';
      return;
    }

    const html = state.services
      .map(function (service) {
        const checked = service.id === state.serviceId ? ' checked' : '';
        const selectedClass = service.id === state.serviceId ? ' is-selected' : '';
        const slotsText = service.available_slots > 0
          ? service.available_slots + ' khung giờ trống'
          : 'Tạm hết khung giờ trống';
        const badgeClass = service.available_slots > 0 ? 'badge badge-confirmed' : 'badge badge-neutral';
        return (
          '<label class="service-option' + selectedClass + '">' +
          '<input type="radio" name="service" value="' + service.id + '"' + checked + ' />' +
          '<span class="service-body">' +
          '<span class="service-title">' + App.escapeHtml(service.name) +
          '<span class="' + badgeClass + '">' + App.escapeHtml(slotsText) + '</span></span>' +
          '<span class="service-meta">' + App.formatDuration(service.duration_minutes) +
          ' · ' + App.formatMoney(service.price) + '</span>' +
          (service.description
            ? '<span class="service-meta">' + App.escapeHtml(service.description) + '</span>'
            : '') +
          '</span></label>'
        );
      })
      .join('');

    els.serviceList.innerHTML = html;
  }

  async function loadServices() {
    els.serviceList.innerHTML = '<div class="loading">Đang tải danh sách dịch vụ…</div>';
    try {
      const data = await App.api('/api/services');
      state.services = data.services || [];
      if (data.timezone) els.tzBadge.textContent = 'Múi giờ: ' + data.timezone;

      if (!findService(state.serviceId)) {
        const firstWithSlots = state.services.find(function (item) {
          return item.available_slots > 0;
        });
        state.serviceId = firstWithSlots ? firstWithSlots.id : (state.services[0] ? state.services[0].id : null);
      }

      renderServices();
      await loadSlots();
    } catch (error) {
      els.serviceList.innerHTML = '<div class="empty">Không tải được danh sách dịch vụ.</div>';
      App.showAlert(els.pageAlert, error.message, 'error');
    }
  }

  function groupByPeriod(slots) {
    const morning = [];
    const afternoon = [];
    const evening = [];
    slots.forEach(function (slot) {
      const hour = Number(hourFormatter.format(new Date(slot.start_time)));
      if (hour < 12) morning.push(slot);
      else if (hour < 17) afternoon.push(slot);
      else evening.push(slot);
    });
    return [
      ['Buổi sáng', morning],
      ['Buổi chiều', afternoon],
      ['Buổi tối', evening],
    ].filter(function (pair) {
      return pair[1].length > 0;
    });
  }

  function renderSlots() {
    if (!state.serviceId) {
      els.slotArea.innerHTML = '<div class="empty">Vui lòng chọn một dịch vụ để xem khung giờ còn trống.</div>';
      return;
    }
    if (state.slots.length === 0) {
      els.slotArea.innerHTML =
        '<div class="empty">Không còn khung giờ trống cho ngày đã chọn. Vui lòng chọn ngày khác.</div>';
      return;
    }

    const groups = groupByPeriod(state.slots);
    els.slotArea.innerHTML = groups
      .map(function (pair) {
        const buttons = pair[1]
          .map(function (slot) {
            const selected = state.selectedSlot && state.selectedSlot.id === slot.id;
            const title = slot.start_local + ' - ' + slot.end_local + ' · ' + App.formatMoney(slot.price);
            return (
              '<button type="button" class="slot-btn' + (selected ? ' is-selected' : '') +
              '" data-slot-id="' + slot.id + '" title="' + App.escapeHtml(title) + '">' +
              App.escapeHtml(slot.start_local) + '</button>'
            );
          })
          .join('');
        return (
          '<div class="slot-group"><div class="slot-group-title">' + pair[0] + '</div>' +
          '<div class="slot-grid">' + buttons + '</div></div>'
        );
      })
      .join('');
  }

  function refreshSummary() {
    const slot = state.selectedSlot;
    if (!slot) {
      els.summary.hidden = true;
      els.summary.textContent = '';
      els.submit.disabled = true;
      els.reset.disabled = true;
      return;
    }
    els.summary.hidden = false;
    els.summary.className = 'alert alert-info';
    els.summary.textContent =
      slot.service_name + ' · ' + slot.start_local + ' - ' + slot.end_local +
      ' ngày ' + App.formatDate(slot.start_time) + ' · ' + App.formatMoney(slot.price);
    els.submit.disabled = false;
    els.reset.disabled = false;
  }

  function clearSelection() {
    state.selectedSlot = null;
    refreshSummary();
    renderSlots();
  }

  async function loadSlots() {
    if (!state.serviceId) {
      state.slots = [];
      renderSlots();
      return;
    }

    els.slotArea.innerHTML = '<div class="loading">Đang tải khung giờ…</div>';
    try {
      const query =
        '/api/slots?serviceId=' + encodeURIComponent(state.serviceId) +
        '&date=' + encodeURIComponent(state.date) + '&days=1';
      const data = await App.api(query);
      state.slots = data.slots || [];

      if (state.selectedSlot) {
        const stillAvailable = findSlot(state.selectedSlot.id);
        state.selectedSlot = stillAvailable || null;
      }

      renderSlots();
      refreshSummary();
    } catch (error) {
      state.slots = [];
      els.slotArea.innerHTML = '<div class="empty">Không tải được khung giờ.</div>';
      App.showAlert(els.pageAlert, error.message, 'error');
    }
  }

  els.serviceList.addEventListener('change', function (event) {
    const input = event.target.closest('input[name="service"]');
    if (!input) return;
    state.serviceId = Number(input.value);
    state.selectedSlot = null;
    renderServices();
    refreshSummary();
    loadSlots();
  });

  els.slotArea.addEventListener('click', function (event) {
    const button = event.target.closest('.slot-btn');
    if (!button) return;
    const slot = findSlot(Number(button.dataset.slotId));
    if (!slot) return;
    state.selectedSlot = slot;
    renderSlots();
    refreshSummary();
  });

  els.date.addEventListener('change', function () {
    state.date = els.date.value || todayInTimezone();
    els.date.value = state.date;
    state.selectedSlot = null;
    refreshSummary();
    loadSlots();
  });

  els.reset.addEventListener('click', clearSelection);

  els.form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!state.selectedSlot) {
      App.showAlert(els.pageAlert, 'Vui lòng chọn khung giờ trước khi đặt lịch.', 'error');
      return;
    }

    App.hideAlert(els.pageAlert);
    els.submit.disabled = true;
    els.submit.textContent = 'Đang gửi yêu cầu…';

    try {
      const data = await App.api('/api/appointments', {
        method: 'POST',
        body: {
          slotId: state.selectedSlot.id,
          note: els.note.value.trim() || null,
        },
      });
      App.showAlert(els.pageAlert, data.message || 'Đặt lịch hẹn thành công.', 'success');
      App.toast('Đã gửi yêu cầu đặt lịch.', 'success');
      els.note.value = '';
      state.selectedSlot = null;
      refreshSummary();
      await Promise.all([loadServices(), loadMyAppointments()]);
    } catch (error) {
      App.showAlert(els.pageAlert, error.message, 'error');
      if (error.status === 409) {
        // Khung giờ vừa bị người khác đặt -> tải lại danh sách mới nhất.
        await loadSlots();
      }
    } finally {
      els.submit.textContent = 'Xác nhận đặt lịch';
      els.submit.disabled = !state.selectedSlot;
    }
  });

  function renderMyAppointments(appointments) {
    if (!appointments || appointments.length === 0) {
      els.mine.innerHTML =
        '<div class="empty">Bạn chưa có lịch hẹn nào. Hãy chọn dịch vụ và khung giờ ở trên để đặt lịch.</div>';
      return;
    }

    const rows = appointments
      .map(function (item) {
        const slot = item.slot || {};
        const canCancel =
          (item.status === 'pending' || item.status === 'confirmed') &&
          new Date(slot.startTime).getTime() > Date.now();
        const actions = canCancel
          ? '<button type="button" class="btn btn-danger btn-sm" data-action="cancel" data-id="' +
            item.id + '">Huỷ lịch</button>'
          : '<span class="muted small">—</span>';

        const noteHtml = item.note
          ? App.escapeHtml(item.note)
          : '<span class="muted">—</span>';
        const reasonHtml = item.cancelReason
          ? '<div class="muted small">Lý do huỷ: ' + App.escapeHtml(item.cancelReason) + '</div>'
          : '';

        return (
          '<tr>' +
          '<td><strong>' + App.escapeHtml(slot.serviceName) + '</strong>' +
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

    els.mine.innerHTML =
      '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>Dịch vụ</th><th>Thời gian</th><th>Trạng thái</th><th>Ghi chú</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  async function loadMyAppointments() {
    els.mine.innerHTML = '<div class="loading">Đang tải lịch hẹn…</div>';
    try {
      const data = await App.api('/api/appointments/me');
      renderMyAppointments(data.appointments || []);
    } catch (error) {
      els.mine.innerHTML = '<div class="empty">Không tải được danh sách lịch hẹn.</div>';
      App.showAlert(els.pageAlert, error.message, 'error');
    }
  }

  els.mine.addEventListener('click', async function (event) {
    const button = event.target.closest('button[data-action="cancel"]');
    if (!button) return;

    const appointmentId = Number(button.dataset.id);
    const answer = window.prompt('Lý do huỷ lịch hẹn (không bắt buộc):', '');
    if (answer === null) return;

    button.disabled = true;
    try {
      const data = await App.api('/api/appointments/' + appointmentId + '/cancel', {
        method: 'POST',
        body: { reason: answer.trim().slice(0, 500) || null },
      });
      App.toast(data.message || 'Đã huỷ lịch hẹn.', 'success');
      App.showAlert(els.pageAlert, data.message || 'Đã huỷ lịch hẹn.', 'success');
      await Promise.all([loadMyAppointments(), loadServices()]);
    } catch (error) {
      App.toast(error.message, 'error');
      button.disabled = false;
    }
  });

  els.reloadServices.addEventListener('click', function () {
    loadServices();
  });

  els.reloadMine.addEventListener('click', function () {
    loadMyAppointments();
  });

  (async function init() {
    const user = await App.initHeader({ requireAuth: true });
    if (!user) return;

    state.date = todayInTimezone();
    els.date.value = state.date;
    els.date.min = state.date;

    await Promise.all([loadServices(), loadMyAppointments()]);
  })();
})();

