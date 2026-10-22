(function () {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const pageSize = Number((window.SITE_CONFIG || {}).pageSize) || 5;
  const today = new Date();
  const state = {
    role: localStorage.getItem("wu-jin-qi-yong:role") || "user",
    page: 1, category: "全部", search: "", devices: [], totalDevices: 0,
    selectedDeviceId: "", selectedDate: "", currentYear: today.getFullYear(),
    currentMonth: today.getMonth() + 1, calendarEvents: [], calendarReady: false,
    usageStatus: "used", usagePage: 1, usageTotal: 0, bookingMode: false, bookingDates: [], statsSelection: [],
    statsPeriod: "month", currentHistoryDevice: null, stale: false, searchTimer: null
  };

  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const unwrap = (value) => value && value.data !== undefined ? value.data : value;
  const listFrom = (value, keys) => {
    const data = unwrap(value);
    if (Array.isArray(data)) return data;
    for (const key of keys || ["items", "list", "results", "records", "devices", "rows", "days"]) {
      if (data && Array.isArray(data[key])) return data[key];
    }
    return [];
  };
  const field = (obj, keys, fallback = "") => {
    for (const key of keys) if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
    return fallback;
  };
  const dateKey = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  };
  const prettyDate = (value) => {
    if (!value) return "请选择日期";
    const d = new Date(value + "T00:00:00");
    if (Number.isNaN(d.getTime())) return value;
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 · 使用登记";
  };
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  function notify(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 2800);
  }
  function setStatus(label, kind, detail) {
    const node = $("#serverStatus");
    node.className = "server-status " + (kind || "");
    $(".status-label", node).textContent = label;
    node.title = detail || label;
    $("#offlineNote").textContent = kind === "offline"
      ? "离线只读：显示此前成功读取并缓存的数据"
      : "数据由课程模拟服务端提供";
  }
  function showError(message) {
    setStatus("连接异常", "offline", message);
  }
  function updateConnection(result) {
    if (result && result.stale) {
      state.stale = true;
      setStatus("离线 · 只读", "offline", "当前显示的是上次读取的缓存数据");
    } else if (window.Service.online) {
      state.stale = false;
      setStatus("服务端在线", "online", "已连接课程模拟服务端");
    }
    $("#reserveButton").disabled = state.stale || !window.Service.online || !state.selectedDeviceId || !state.selectedDate;
    $("#bookingHint").textContent = state.stale
      ? "离线状态下仅可查看缓存，连接服务端后才能提交预约"
      : (!state.selectedDeviceId || !state.selectedDate ? "选择设备和日期后，可以提交预约" : "已选日期：" + state.selectedDate);
  }
  const deviceId = (device) => String(field(device, ["id", "deviceId", "device_id", "code", "deviceCode"]));
  const deviceName = (device) => String(field(device, ["name", "deviceName", "device_name", "title"], "未命名设备"));
  const deviceCode = (device) => String(field(device, ["code", "deviceCode", "device_id", "deviceId", "id"], "—"));
  const deviceCategory = (device) => String(field(device, ["category", "type", "kind", "categoryName"], "其他"));
  const deviceCount = (device) => num(field(device, ["usageCount", "useCount", "usage_count", "usedCount", "count"], 0));
  const deviceDescription = (device) => String(field(device, ["description", "purpose", "intro", "remark"], "查看设备详情与可预约日期。"));
  const isAvailable = (device) => field(device, ["available", "isAvailable", "is_available"], null);

  function deviceIllustration(category, index) {
    const kind = /相机|影像|摄像|摄影/i.test(category) ? "camera" : /电工|工具|电子/i.test(category) ? "tools" : "printer";
    if (kind === "camera") return '<svg viewBox="0 0 180 120" aria-hidden="true"><path fill="#c5a684" d="M25 43h28l9-13h50l10 13h27a8 8 0 0 1 8 8v47a9 9 0 0 1-9 9H28a9 9 0 0 1-9-9V51a8 8 0 0 1 6-8Z"/><path fill="#41433d" d="M27 47h27l9-12h49l10 12h27v50H27Z"/><circle cx="90" cy="71" r="28" fill="#252822"/><circle cx="90" cy="71" r="21" fill="#66899a"/><circle cx="90" cy="71" r="13" fill="#1d2427"/><circle cx="84" cy="65" r="5" fill="#bad1cd"/><rect x="34" y="52" width="21" height="7" rx="2" fill="#eed39e"/><circle cx="143" cy="54" r="3" fill="#d98d60"/></svg>';
    if (kind === "tools") return '<svg viewBox="0 0 180 120" aria-hidden="true"><path fill="#799487" d="M25 44h130l-9 57a10 10 0 0 1-10 8H44a10 10 0 0 1-10-8Z"/><path fill="#465b55" d="M19 39h142v15H19z"/><path d="M69 39v-9a9 9 0 0 1 9-9h25a9 9 0 0 1 9 9v9" fill="none" stroke="#465b55" stroke-width="7"/><path d="m51 61 12 21m0-21L51 82m40-23v29m28-27-11 22m0-22 11 22" fill="none" stroke="#f3d18a" stroke-width="5" stroke-linecap="round"/><path fill="#d27653" d="M71 60h10v28H71z"/><circle cx="135" cy="68" r="7" fill="#e6d4b3"/><path d="M61 89h59" stroke="#d9c69d" stroke-width="3"/></svg>';
    return '<svg viewBox="0 0 180 120" aria-hidden="true"><path d="M39 25h102v76H39z" fill="#596c65"/><path d="M49 34h82v56H49z" fill="#d9d0bb"/><path d="M57 40h66v44H57z" fill="#b9d4cf"/><path d="M68 48h44v5H68zm0 12h44v5H68zm0 12h25v5H68z" fill="#879c8d"/><path d="M30 101h120l-12 9H42z" fill="#796b56"/><circle cx="133" cy="96" r="2" fill="#ffd47f"/><path d="M87 89v12" stroke="#6a665c" stroke-width="4"/><path d="M71 24v-8h39v8" fill="none" stroke="#9b7959" stroke-width="5"/></svg>';
  }

  function renderDevices() {
    const container = $("#deviceList");
    const visible = state.devices;
    $("#deviceCount").textContent = state.totalDevices + " 件设备";
    if (!visible.length) {
      container.innerHTML = '<div class="empty-state"><span class="empty-illustration">⌕</span><span>' +
        (state.stale ? "没有可用的缓存设备记录" : "服务端暂未返回设备记录") + "</span></div>";
      return;
    }
    container.innerHTML = visible.map((device, index) => {
      const id = deviceId(device);
      const available = isAvailable(device);
      const status = available === null ? "状态待确认" : (available ? "当前可预约" : "今日已占用");
      const statusClass = available === null ? "unknown" : (available ? "" : "busy");
      const palette = ["#e6ede4", "#f6e5d8", "#f4e8bc", "#dce9e8", "#e8e3d5"];
      return '<article class="device-card ' + (id === state.selectedDeviceId ? "selected" : "") + '" data-device="' + escapeHtml(id) + '" tabindex="0" role="button" aria-pressed="' + (id === state.selectedDeviceId) + '">' +
        '<div class="device-visual" style="--visual-bg:' + palette[((state.page - 1) * pageSize + index) % palette.length] + '"><span class="device-number">' + String((state.page - 1) * pageSize + index + 1).padStart(2, "0") + "</span>" + deviceIllustration(deviceCategory(device), index) + "</div>" +
        '<div class="device-info"><span class="device-kind">' + escapeHtml(deviceCategory(device)) + '</span><div class="device-title-row"><h3 class="device-title">' + escapeHtml(deviceName(device)) + '</h3><span class="device-code">' + escapeHtml(deviceCode(device)) + '</span></div>' +
        '<p class="device-description">' + escapeHtml(deviceDescription(device)) + '</p><div class="device-meta"><span class="usage-count">' + deviceCount(device) + " 次使用</span><span class=\"availability " + statusClass + '">' + status + '</span></div><button type="button" class="device-history" data-history="' + escapeHtml(id) + '">查看预约历史</button></div></article>';
    }).join("");
    $$(".device-card").forEach((card) => {
      const select = () => selectDevice(card.dataset.device);
      card.addEventListener("click", (event) => {
        if (!event.target.closest("[data-history]")) select();
      });
      card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
    });
    $$("[data-history]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const device = state.devices.find((item) => deviceId(item) === button.dataset.history);
      if (device) loadHistory(device);
    }));
    $("#pageLabel").textContent = "第 " + state.page + " 页";
    $("#prevPage").disabled = state.page <= 1;
    $("#nextPage").disabled = state.page * pageSize >= state.totalDevices;
    populateBookingDevices();
    renderStatsDeviceOptions();
  }

  async function loadDevices() {
    const params = { page: state.page, pageSize, category: state.category === "全部" ? "" : state.category, search: state.search };
    try {
      const result = await window.Service.getDevices(params);
      const payload = unwrap(result.data);
      state.devices = listFrom(payload, ["items", "devices", "list", "results", "rows"]);
      state.totalDevices = num(field(payload, ["total", "totalCount", "totalElements", "count"], state.devices.length));
      state.stale = !!result.stale;
      updateConnection(result);
      if (state.selectedDeviceId && !state.devices.some((d) => deviceId(d) === state.selectedDeviceId)) {
        state.selectedDeviceId = "";
      }
      renderDevices();
      if (!state.selectedDeviceId && state.devices.length) {
        state.selectedDeviceId = deviceId(state.devices[0]);
        renderDevices();
      }
      if (state.selectedDeviceId) await loadCalendar();
      else renderCalendar();
    } catch (error) {
      state.devices = [];
      state.totalDevices = 0;
      renderDevices();
      showError(error.message);
    }
  }

  async function selectDevice(id) {
    state.selectedDeviceId = id;
    state.currentHistoryDevice = null;
    state.usagePage = 1;
    renderDevices();
    const selected = state.devices.find((device) => deviceId(device) === id);
    $("#selectedDeviceLabel").textContent = selected ? deviceName(selected) + " · " + deviceCode(selected) : "选择设备查看使用日期";
    await loadCalendar();
    if (selected) await loadHistory(selected);
  }

  function normalizeEvents(result) {
    const payload = unwrap(result);
    const list = listFrom(payload, ["items", "events", "days", "records", "reservations", "dates"]);
    if (list.length) return list.map((item) => ({
      date: String(field(item, ["date", "day", "useDate", "usageDate", "startDate"], "" )).slice(0, 10),
      mine: !!field(item, ["mine", "isMine", "myReservation", "is_mine"], false),
      booked: !!field(item, ["booked", "isBooked", "reserved", "hasBooking", "busy"], true),
      raw: item
    })).filter((item) => item.date);
    if (payload && payload.dates && typeof payload.dates === "object") {
      return Object.entries(payload.dates).map(([date, value]) => ({
        date, mine: !!(value && (value.mine || value.isMine)),
        booked: !!(value && (value.booked || value.isBooked || value.count)),
        raw: value
      }));
    }
    return [];
  }

  async function loadCalendar() {
    if (!state.selectedDeviceId) { state.calendarEvents = []; state.calendarReady = true; renderCalendar(); return; }
    try {
      const result = await window.Service.getCalendar({
        year: state.currentYear, month: state.currentMonth, deviceId: state.selectedDeviceId
      });
      state.calendarEvents = normalizeEvents(result.data);
      state.calendarReady = true;
      updateConnection(result);
      renderCalendar();
    } catch (error) {
      state.calendarEvents = [];
      state.calendarReady = false;
      renderCalendar(error.message);
      showError(error.message);
    }
  }

  function renderCalendar(error) {
    $("#monthTitle").textContent = state.currentYear + "年" + String(state.currentMonth).padStart(2, "0") + "月";
    const grid = $("#calendarDays");
    const first = new Date(state.currentYear, state.currentMonth - 1, 1);
    const firstOffset = (first.getDay() + 6) % 7;
    let start = new Date(state.currentYear, state.currentMonth - 1, 1 - firstOffset);
    const events = new Map(state.calendarEvents.map((event) => [event.date, event]));
    const shown = [];
    let dayCount = 42;
    if ((state.currentView === "week" || state.currentView === "day") && state.selectedDate) {
      const selected = new Date(state.selectedDate + "T00:00:00");
      if (state.currentView === "week") {
        start = new Date(selected);
        start.setDate(selected.getDate() - ((selected.getDay() + 6) % 7));
        dayCount = 7;
      } else {
        start = selected;
        dayCount = 1;
      }
    }
    $("#calendarGrid").classList.toggle("is-day-view", state.currentView === "day");
    grid.classList.toggle("is-day-view", state.currentView === "day");
    for (let i = 0; i < dayCount; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = dateKey(date);
      const event = events.get(key);
      const inMonth = date.getMonth() === state.currentMonth - 1;
      const classes = ["calendar-day"];
      if (!inMonth) classes.push("other-month");
      if (key === dateKey(today)) classes.push("is-today");
      if (key === state.selectedDate) classes.push("is-selected");
      if (event && event.booked) classes.push("has-booking");
      if (event && event.mine) classes.push("is-mine");
      if (event && !event.booked) classes.push("is-idle");
      const disabled = !inMonth && state.currentView === "month";
      shown.push('<button class="' + classes.join(" ") + '" data-date="' + key + '" ' + (disabled ? "disabled" : "") + ' aria-label="' + key + '">' +
        '<span class="day-number">' + date.getDate() + "</span></button>");
    }
    if (error) grid.innerHTML = '<div class="empty-calendar" style="grid-column:1/-1;padding:36px 12px;text-align:center;color:#9b654e">' + escapeHtml(error) + "</div>";
    else if (!state.calendarReady) grid.innerHTML = '<div class="empty-calendar" style="grid-column:1/-1;padding:36px 12px;text-align:center;color:#918d83">连接服务端后显示可预约日期</div>';
    else {
      grid.innerHTML = shown.join("");
      $$(".calendar-day", grid).forEach((button) => button.addEventListener("click", () => handleDateSelection(button.dataset.date)));
    }
  }

  async function handleDateSelection(date) {
    state.selectedDate = date;
    state.usagePage = 1;
    state.currentView = state.currentView || "month";
    $("#usageDate").textContent = prettyDate(date);
    renderCalendar();
    if (state.currentHistoryDevice) state.currentHistoryDevice = null;
    await loadDailyUsage();
  }

  function recordFields(record) {
    return {
      time: String(field(record, ["timeRange", "time", "period", "slot"], "时段未提供")),
      device: String(field(record, ["deviceName", "name", "device_name"], "设备")),
      id: String(field(record, ["deviceCode", "deviceId", "device_id", "code"], "—")),
      user: String(field(record, ["userName", "user", "borrower", "operator"], "—")),
      purpose: String(field(record, ["purpose", "usage", "description", "remark"], "—")),
      status: String(field(record, ["statusText", "status", "state"], "")),
      registration: String(field(record, ["registeredAt", "registrationTime", "createdAt", "registerTime"], ""))
    };
  }
  function renderUsage(records, mode, total) {
    const tbody = $("#usageRows");
    const thead = $(".usage-table thead");
    if (mode === "history") {
      thead.innerHTML = "<tr><th>使用日期</th><th>设备</th><th>使用者</th><th>用途</th><th>状态</th></tr>";
      $("#usageTitle").textContent = "设备预约历史";
    } else {
      thead.innerHTML = "<tr><th>时段</th><th>设备</th><th>使用者</th><th>用途</th><th>状态</th></tr>";
      $("#usageTitle").textContent = "当日使用登记";
    }
    state.usageTotal = Number.isFinite(Number(total)) ? Number(total) : records.length;
    const maxPages = Math.max(1, Math.ceil(state.usageTotal / pageSize));
    $("#usagePageLabel").textContent = "第 " + state.usagePage + " / " + maxPages + " 页";
    $("#usagePrev").disabled = state.usagePage <= 1;
    $("#usageNext").disabled = state.usagePage >= maxPages;
    if (!records.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty">' + (state.stale ? "缓存中没有这组记录" : (mode === "idle" ? "该日期暂无空闲设备记录" : "该日期暂无使用登记")) + "</td></tr>";
      return;
    }
    let entries = records.slice();
    if (mode === "history") entries.sort((a, b) => String(field(a, ["registeredAt", "registrationTime", "createdAt", "registerTime"], "")).localeCompare(String(field(b, ["registeredAt", "registrationTime", "createdAt", "registerTime"], ""))));
    let previousRegistration = "";
    tbody.innerHTML = entries.map((record) => {
      const row = recordFields(record);
      const status = row.status || (mode === "idle" ? "空闲" : "已登记");
      const statusClass = /中|进行/i.test(status) ? "in-use" : (mode === "idle" ? "idle" : "");
      const first = mode === "history" ? String(field(record, ["useDate", "date", "usageDate", "startDate"], "—")).slice(0, 10) : row.time;
      let group = "";
      if (mode === "history" && row.registration && row.registration !== previousRegistration) {
        previousRegistration = row.registration;
        group = '<tr class="history-group"><td colspan="5">登记时间 · ' + escapeHtml(row.registration) + "</td></tr>";
      }
      return group + "<tr><td>" + escapeHtml(first) + "</td><td>" + escapeHtml(row.device) + ' <span class="device-code">' + escapeHtml(row.id) + "</span></td><td>" + escapeHtml(row.user) + "</td><td>" + escapeHtml(row.purpose) + '</td><td><span class="table-status ' + statusClass + '">' + escapeHtml(status) + "</span></td></tr>";
    }).join("");
  }
  async function loadDailyUsage() {
    if (!state.selectedDate) { renderUsage([], "used"); return; }
    try {
      const result = await window.Service.getDailyUsage({
        date: state.selectedDate,
        status: state.usageStatus,
        page: state.usagePage,
        pageSize
      });
      updateConnection(result);
      const payload = unwrap(result.data);
      renderUsage(listFrom(payload), state.usageStatus, field(payload, ["total", "totalCount", "count"], undefined));
    } catch (error) {
      renderUsage([], state.usageStatus);
      showError(error.message);
    }
  }
  async function loadHistory(device = state.currentHistoryDevice) {
    if (!device) return;
    state.currentHistoryDevice = device;
    state.usagePage = Math.max(1, state.usagePage);
    state.selectedDeviceId = deviceId(device);
    $("#selectedDeviceLabel").textContent = deviceName(device) + " · " + deviceCode(device);
    $("#usageDate").textContent = "按登记时间排列";
    try {
      const result = await window.Service.getDeviceHistory(deviceId(device), { page: state.usagePage, pageSize });
      updateConnection(result);
      const payload = unwrap(result.data);
      renderUsage(listFrom(payload), "history", field(payload, ["total", "totalCount", "count"], undefined));
      $("#usagePanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      renderUsage([], "history");
      showError(error.message);
    }
  }

  function populateBookingDevices() {
    const select = $("#bookingDevice");
    if (!select) return;
    select.innerHTML = state.devices.map((device) => '<option value="' + escapeHtml(deviceId(device)) + '">' +
      escapeHtml(deviceName(device) + " · " + deviceCode(device)) + "</option>").join("");
    if (state.selectedDeviceId) select.value = state.selectedDeviceId;
  }
  function renderBookingDates() {
    $("#selectedDates").innerHTML = state.bookingDates.map((date) => '<button class="date-chip" type="button" data-remove-date="' + escapeHtml(date) + '" title="移除日期">' + escapeHtml(date) + " ×</button>").join("");
    $$("[data-remove-date]").forEach((button) => button.addEventListener("click", () => {
      state.bookingDates = state.bookingDates.filter((date) => date !== button.dataset.removeDate);
      renderBookingDates();
    }));
  }
  function openBooking() {
    if (!window.Service.online || state.stale) { notify("离线只读状态下不能提交预约"); return; }
    if (!state.selectedDeviceId || !state.selectedDate) { notify("请先选择设备和日期"); return; }
    state.bookingDates = [state.selectedDate];
    populateBookingDevices();
    renderBookingDates();
    $("#bookingDatePicker").value = state.selectedDate;
    $("#bookingMessage").textContent = "可继续在日历中选择日期，最多五天。";
    $("#bookingMessage").className = "form-message";
    $("#bookingDialog").showModal();
  }
  async function submitBooking(event) {
    event.preventDefault();
    if (!state.bookingDates.length || !state.selectedDeviceId) {
      $("#bookingMessage").textContent = "请选择设备和至少一个日期。";
      return;
    }
    if (!window.Service.online || state.stale) {
      $("#bookingMessage").textContent = "当前为离线只读状态，无法提交。";
      return;
    }
    const button = $("#submitBooking");
    button.disabled = true;
    button.textContent = "正在提交…";
    try {
      const result = await window.Service.createReservation({
        deviceId: $("#bookingDevice").value,
        dates: state.bookingDates.slice(),
        purpose: $("#bookingPurpose").value.trim()
      });
      const payload = unwrap(result.data);
      $("#bookingMessage").textContent = field(payload, ["message", "msg"], "预约请求已提交。");
      $("#bookingMessage").classList.add("success");
      notify("预约请求已提交");
      state.bookingMode = false;
      $("#bookingDialog").close();
      await loadCalendar();
      await loadDailyUsage();
    } catch (error) {
      $("#bookingMessage").textContent = error.payload && (error.payload.message || error.payload.error)
        ? error.payload.message || error.payload.error
        : error.message;
      $("#bookingMessage").classList.remove("success");
      updateConnection(null);
    } finally {
      button.disabled = false;
      button.textContent = "提交预约";
    }
  }

  function renderStatsDeviceOptions() {
    const node = $("#statsDeviceList");
    if (!node) return;
    if (!state.devices.length) {
      node.innerHTML = '<p class="table-empty">服务端未返回设备</p>';
      return;
    }
    node.innerHTML = state.devices.map((device) => {
      const id = deviceId(device);
      return '<label class="stats-device"><input type="checkbox" value="' + escapeHtml(id) + '" ' + (state.statsSelection.includes(id) ? "checked" : "") + '><span>' + escapeHtml(deviceName(device)) + "</span></label>";
    }).join("");
    $$('input[type="checkbox"]', node).forEach((input) => input.addEventListener("change", () => {
      state.statsSelection = $$('input[type="checkbox"]:checked', node).map((item) => item.value);
      loadStatistics();
    }));
  }
  async function loadStatistics() {
    const node = $("#statsChart");
    if (!state.statsSelection.length) {
      node.innerHTML = '<p class="table-empty">选择一件或多件设备后查看统计</p>';
      return;
    }
    try {
      const result = await window.Service.getStatistics({ period: state.statsPeriod, deviceIds: state.statsSelection });
      updateConnection(result);
      const rows = listFrom(result.data, ["items", "statistics", "stats", "devices", "rows"]);
      if (!rows.length) {
        node.innerHTML = '<p class="table-empty">' + (state.stale ? "缓存中没有该统计结果" : "服务端暂未返回统计数据") + "</p>";
        return;
      }
      const counts = rows.map((item) => num(field(item, ["count", "usageCount", "useCount", "total", "value"], 0)));
      const maximum = Math.max(1, ...counts);
      node.innerHTML = rows.map((item, index) => {
        const name = String(field(item, ["deviceName", "name", "label"], deviceName(state.devices.find((d) => deviceId(d) === String(field(item, ["deviceId", "id", "code"]))) || {})));
        const count = counts[index];
        return '<div class="bar-row"><span class="bar-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span><div class="bar-track"><div class="bar-fill" style="--bar-width:' + Math.round(count / maximum * 100) + '%"></div></div><span class="bar-value">' + count + "</span></div>";
      }).join("");
    } catch (error) {
      node.innerHTML = '<p class="table-empty">' + escapeHtml(error.message) + "</p>";
      showError(error.message);
    }
  }
  function setRole(role) {
    state.role = role;
    localStorage.setItem("wu-jin-qi-yong:role", role);
    $$(".role-button").forEach((button) => {
      const active = button.dataset.role === role;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $(".calendar-panel").hidden = role === "admin";
    $(".usage-panel").hidden = role === "admin";
    $("#adminPanel").hidden = role !== "admin";
    if (role === "admin") loadStatistics();
  }
  function changeMonth(offset) {
    state.currentMonth += offset;
    if (state.currentMonth < 1) { state.currentMonth = 12; state.currentYear--; }
    if (state.currentMonth > 12) { state.currentMonth = 1; state.currentYear++; }
    state.calendarReady = false;
    loadCalendar();
  }
  function bindEvents() {
    $$(".role-button").forEach((button) => button.addEventListener("click", () => setRole(button.dataset.role)));
    $("#prevPage").addEventListener("click", () => { if (state.page > 1) { state.page--; loadDevices(); } });
    $("#nextPage").addEventListener("click", () => { if (state.page * pageSize < state.totalDevices) { state.page++; loadDevices(); } });
    $("#deviceSearch").addEventListener("input", (event) => {
      clearTimeout(state.searchTimer);
      state.search = event.target.value.trim();
      state.searchTimer = setTimeout(() => { state.page = 1; loadDevices(); }, 280);
    });
    $$(".category-tab").forEach((button) => button.addEventListener("click", () => {
      state.category = button.dataset.category;
      state.page = 1;
      $$(".category-tab").forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      loadDevices();
    }));
    $("#prevMonth").addEventListener("click", () => changeMonth(-1));
    $("#nextMonth").addEventListener("click", () => changeMonth(1));
    $$(".view-button").forEach((button) => button.addEventListener("click", () => {
      state.currentView = button.dataset.view;
      $$(".view-button").forEach((item) => item.classList.toggle("is-active", item === button));
      renderCalendar();
    }));
    $$(".segmented button").forEach((button) => button.addEventListener("click", () => {
      state.usageStatus = button.dataset.usage;
      state.usagePage = 1;
      state.currentHistoryDevice = null;
      $$(".segmented button").forEach((item) => item.classList.toggle("is-active", item === button));
      loadDailyUsage();
    }));
    $("#reserveButton").addEventListener("click", openBooking);
    $("#usagePrev").addEventListener("click", () => {
      if (state.usagePage > 1) {
        state.usagePage--;
        if (state.currentHistoryDevice) loadHistory(); else loadDailyUsage();
      }
    });
    $("#usageNext").addEventListener("click", () => {
      if (state.usagePage * pageSize < state.usageTotal) {
        state.usagePage++;
        if (state.currentHistoryDevice) loadHistory(); else loadDailyUsage();
      }
    });
    $("#bookingForm").addEventListener("submit", submitBooking);
    $("#cancelBooking").addEventListener("click", () => $("#bookingDialog").close());
    $("#bookingDialog").addEventListener("close", () => { state.bookingMode = false; renderCalendar(); });
    $("#bookingDevice").addEventListener("change", (event) => { state.selectedDeviceId = event.target.value; loadCalendar(); });
    $("#addBookingDate").addEventListener("click", () => {
      const date = $("#bookingDatePicker").value;
      if (!date) { notify("先选择一个日期"); return; }
      if (state.bookingDates.includes(date)) { notify("这个日期已经添加"); return; }
      if (state.bookingDates.length >= 5) { notify("一次最多选择五个日期"); return; }
      state.bookingDates.push(date);
      state.bookingDates.sort();
      renderBookingDates();
    });
    $("#statsPeriod").addEventListener("change", (event) => { state.statsPeriod = event.target.value; loadStatistics(); });
    $("#serverStatus").addEventListener("click", () => {
      notify(window.Service.online ? "当前已连接课程模拟服务端" : "当前离线，只能查看此前缓存的数据");
    });
  }
  async function start() {
    bindEvents();
    state.selectedDate = dateKey(today);
    state.currentView = "month";
    $("#usageDate").textContent = prettyDate(state.selectedDate);
    setStatus("连接中", "", "正在连接课程模拟服务端");
    setRole(state.role);
    try { await window.Service.checkHealth(); updateConnection({ stale: false }); }
    catch (error) { showError(error.message); }
    await loadDevices();
    if (!state.selectedDeviceId) renderCalendar();
  }
  start();
})();
