(function () {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const pageSize = Number((window.SITE_CONFIG || {}).pageSize) || 5;
  const today = new Date();
  const calendarMinYear = Number((window.SITE_CONFIG || {}).calendarMinYear) || 2000;
  const calendarMaxYear = Number((window.SITE_CONFIG || {}).calendarMaxYear) || 2100;
  const courseService = window.Service;
  const state = {
    demoMode: false,
    role: "user", account: "student", adminView: true,
    page: 1, category: "全部", search: "", devices: [], allDevices: [], totalDevices: 0,
    selectedDeviceId: "", selectedDate: "", currentYear: today.getFullYear(),
    currentMonth: today.getMonth() + 1, calendarEvents: [], calendarReady: false, calendarDeviceId: "",
    usageStatus: "used", usagePage: 1, usageTotal: 0, bookingMode: false, bookingDates: [], statsSelection: [],
    statsPeriod: "all", statsRange: null, statsRows: [], statsRequestId: 0, currentHistoryDevice: null, myReservations: [], detailDevice: null, stale: false, searchTimer: null
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
  function deviceCondition(device) {
    const raw = field(device, ["condition", "Condition", "health", "Health", "deviceStatus", "DeviceStatus", "maintenanceStatus", "MaintenanceStatus", "repairStatus", "RepairStatus", "status", "Status"], "");
    const available = field(device, ["available", "isAvailable", "is_available"], null);
    const text = String(raw || "").trim();
    const faultFlag = ["isBroken", "IsBroken", "underMaintenance", "UnderMaintenance", "isDisabled", "IsDisabled"].some((key) => device && (device[key] === true || device[key] === 1));
    if (faultFlag || available === false || available === 0 || /故障|维修|检修|停用|损坏|不可用|报废/.test(text)) return { label: text || "暂停预约", unavailable: true };
    if (available === true || available === 1) return { label: text || "服务端标记可用", unavailable: false };
    return { label: text || "服务端未提供", unavailable: /故障|维修|检修|停用|损坏|不可用|报废/.test(text) };
  }
  function displayField(value, fallback = "服务端未提供") {
    return value === undefined || value === null || String(value).trim() === "" ? fallback : String(value);
  }
  function readMyReservations() {
    try {
      const value = JSON.parse(localStorage.getItem("wu-jin-qi-yong:my-reservations") || "[]");
      state.myReservations = Array.isArray(value) ? value : [];
    } catch { state.myReservations = []; }
  }
  function saveMyReservation(entry) {
    state.myReservations = [entry].concat(state.myReservations).slice(0, 30);
    try { localStorage.setItem("wu-jin-qi-yong:my-reservations", JSON.stringify(state.myReservations)); } catch { /* optional local receipt */ }
  }
  function initCalendarPicker() {
    const yearSelect = $("#calendarYear");
    const monthSelect = $("#calendarMonth");
    for (let year = calendarMaxYear; year >= calendarMinYear; year--) {
      yearSelect.add(new Option(year + " 年", String(year)));
    }
    for (let month = 1; month <= 12; month++) {
      monthSelect.add(new Option(month + " 月", String(month)));
    }
    const minDate = calendarMinYear + "-01-01";
    const maxDate = calendarMaxYear + "-12-31";
    $("#statsStartDate").min = minDate;
    $("#statsStartDate").max = maxDate;
    $("#statsEndDate").min = minDate;
    $("#statsEndDate").max = maxDate;
    $("#calendarYear").value = String(state.currentYear);
    $("#calendarMonth").value = String(state.currentMonth);
  }
  function showLogin() {
    document.body.classList.remove("is-authenticated");
    $("#loginScreen").hidden = false;
    $("#loginError").textContent = "";
  }
  function clearLoadedServiceData() {
    state.devices = [];
    state.allDevices = [];
    state.totalDevices = 0;
    state.selectedDeviceId = "";
    state.calendarEvents = [];
    state.calendarReady = false;
    state.calendarDeviceId = "";
    state.currentHistoryDevice = null;
    state.statsSelection = [];
    state.statsRows = [];
    state.statsRequestId++;
    state.stale = false;
    state.usagePage = 1;
    state.usageTotal = 0;
  }
  async function enterDemoSession(role, account, persist = true) {
    state.role = role;
    state.account = account;
    state.adminView = role === "admin";
    if (persist) localStorage.setItem("wu-jin-qi-yong:demo-session", JSON.stringify({ role, account, demoMode: state.demoMode }));
    document.body.classList.add("is-authenticated");
    $("#loginScreen").hidden = true;
    $("#identityChip").textContent = (state.demoMode ? "完整体验 · " : "课程演示 · ") + (role === "admin" ? "管理员" : "使用者");
    setStatus(state.demoMode ? "完整体验数据" : "连接中", state.demoMode ? "online" : "", state.demoMode ? "当前使用浏览器本地演示数据，不连接课程服务端" : "正在连接课程模拟服务端");
    setRoleView();
    window.FeatureDesk?.setContext({ role, account, devices: state.allDevices, selectedDate: state.selectedDate, selectedDeviceId: state.selectedDeviceId });
    if (!state.allDevices.length) await loadDevices();
    else if (role === "admin") { renderStatsDeviceOptions(); loadStatistics(); }
  }
  function handleDemoLogin(event) {
    event.preventDefault();
    state.demoMode = false;
    window.Service = courseService;
    const accounts = {
      student: { password: "demo123", role: "user" },
      admin: { password: "demo123", role: "admin" }
    };
    const account = $("#loginAccount").value.trim().toLowerCase();
    const password = $("#loginPassword").value;
    const match = accounts[account];
    if (!match || match.password !== password) {
      $("#loginError").textContent = "账号或密码不正确，请使用下方课程演示账号。";
      $("#loginPassword").value = "";
      return;
    }
    $("#loginError").textContent = "";
    clearLoadedServiceData();
    enterDemoSession(match.role, account);
  }
  function startFullDemo(event) {
    const role = event.currentTarget.dataset.demoStart;
    state.demoMode = true;
    window.Service = window.DemoService;
    const account = role === "admin" ? "admin" : "student";
    localStorage.setItem("wu-jin-qi-yong:demo-session", JSON.stringify({ role, account, demoMode: true }));
    enterDemoSession(role, account, false);
  }
  function logoutDemo() {
    localStorage.removeItem("wu-jin-qi-yong:demo-session");
    clearLoadedServiceData();
    state.demoMode = false;
    window.Service = courseService;
    state.role = "user";
    state.adminView = false;
    showLogin();
    $("#loginPassword").value = "";
  }
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
    $("#offlineNote").textContent = state.demoMode
      ? "完整体验环境：示例数据仅保存在当前浏览器，不写入课程服务端"
      : kind === "offline"
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
    } else if (state.demoMode) {
      state.stale = false;
      setStatus("完整体验数据", "online", "当前使用浏览器本地演示数据，不连接课程服务端");
    } else if (window.Service.online) {
      state.stale = false;
      setStatus("服务端在线", "online", "已连接课程模拟服务端");
    }
    $("#reserveButton").disabled = state.stale || !window.Service.online || !state.selectedDeviceId || !state.selectedDate;
    $("#bookingHint").textContent = state.stale
      ? "离线状态下仅可查看缓存，连接服务端后才能提交预约"
      : (!state.selectedDeviceId || !state.selectedDate ? "选择设备和日期后，可以提交预约" : "已选日期：" + state.selectedDate);
  }
  const deviceId = (device) => String(field(device, ["No", "id", "deviceId", "device_id", "code", "deviceCode"]));
  const deviceName = (device) => String(field(device, ["Name", "name", "deviceName", "device_name", "title"], "未命名设备"));
  const deviceCode = (device) => String(field(device, ["No", "code", "deviceCode", "device_id", "deviceId", "id"], "—"));
  const deviceCategory = (device) => String(field(device, ["category", "type", "kind", "categoryName"], "共享设备"));
  const deviceCount = (device) => num(field(device, ["UseCount", "usageCount", "useCount", "usage_count", "usedCount", "count"], 0));
  const deviceDescription = (device) => String(field(device, ["description", "purpose", "intro", "remark"], "服务端未提供设备说明。"));
  const isAvailable = (device) => field(device, ["available", "isAvailable", "is_available"], null);

  function deviceIllustration(category, index) {
    const kind = /相机|影像|摄像|摄影/i.test(category) ? "camera" : /电工|工具|电子/i.test(category) ? "tools" : "printer";
    if (kind === "camera") return '<svg viewBox="0 0 180 120" aria-hidden="true"><path fill="#c5a684" d="M25 43h28l9-13h50l10 13h27a8 8 0 0 1 8 8v47a9 9 0 0 1-9 9H28a9 9 0 0 1-9-9V51a8 8 0 0 1 6-8Z"/><path fill="#41433d" d="M27 47h27l9-12h49l10 12h27v50H27Z"/><circle cx="90" cy="71" r="28" fill="#252822"/><circle cx="90" cy="71" r="21" fill="#66899a"/><circle cx="90" cy="71" r="13" fill="#1d2427"/><circle cx="84" cy="65" r="5" fill="#bad1cd"/><rect x="34" y="52" width="21" height="7" rx="2" fill="#eed39e"/><circle cx="143" cy="54" r="3" fill="#d98d60"/></svg>';
    if (kind === "tools") return '<svg viewBox="0 0 180 120" aria-hidden="true"><path fill="#799487" d="M25 44h130l-9 57a10 10 0 0 1-10 8H44a10 10 0 0 1-10-8Z"/><path fill="#465b55" d="M19 39h142v15H19z"/><path d="M69 39v-9a9 9 0 0 1 9-9h25a9 9 0 0 1 9 9v9" fill="none" stroke="#465b55" stroke-width="7"/><path d="m51 61 12 21m0-21L51 82m40-23v29m28-27-11 22m0-22 11 22" fill="none" stroke="#f3d18a" stroke-width="5" stroke-linecap="round"/><path fill="#d27653" d="M71 60h10v28H71z"/><circle cx="135" cy="68" r="7" fill="#e6d4b3"/><path d="M61 89h59" stroke="#d9c69d" stroke-width="3"/></svg>';
    return '<svg viewBox="0 0 180 120" aria-hidden="true"><path d="M39 25h102v76H39z" fill="#596c65"/><path d="M49 34h82v56H49z" fill="#d9d0bb"/><path d="M57 40h66v44H57z" fill="#b9d4cf"/><path d="M68 48h44v5H68zm0 12h44v5H68zm0 12h25v5H68z" fill="#879c8d"/><path d="M30 101h120l-12 9H42z" fill="#796b56"/><circle cx="133" cy="96" r="2" fill="#ffd47f"/><path d="M87 89v12" stroke="#6a665c" stroke-width="4"/><path d="M71 24v-8h39v8" fill="none" stroke="#9b7959" stroke-width="5"/></svg>';
  }

  function filteredDevices() {
    const query = state.search.toLocaleLowerCase();
    return state.allDevices.filter((device) => {
      const haystack = [device.No, device.Name].join(" ").toLocaleLowerCase();
      return haystack.includes(query);
    });
  }
  function renderDevices() {
    const container = $("#deviceList");
    const filtered = filteredDevices();
    state.totalDevices = filtered.length;
    const visible = filtered.slice((state.page - 1) * pageSize, state.page * pageSize);
    $("#deviceCount").textContent = state.totalDevices + " 件设备";
    if (!visible.length) {
      container.innerHTML = '<div class="empty-state"><span class="empty-illustration">⌕</span><span>' +
        (state.stale ? "没有可用的缓存设备记录" : "服务端暂未返回设备记录") + "</span></div>";
      renderStatsDeviceOptions();
      return;
    }
    container.innerHTML = visible.map((device, index) => {
      const id = deviceId(device);
      const available = isAvailable(device);
      const condition = deviceCondition(device);
      const demoBlocked = !!window.FeatureDesk?.deviceBlocked(id);
      const status = demoBlocked ? "本机演示暂停预约" : (condition.unavailable ? condition.label : (available === null ? (condition.label === "服务端未提供" ? "状态待确认" : condition.label) : (available ? "服务端标记可用" : "当天已有登记")));
      const statusClass = demoBlocked || condition.unavailable ? "busy" : (available === null ? "unknown" : (available ? "" : "busy"));
      const palette = ["#e6ede4", "#f6e5d8", "#f4e8bc", "#dce9e8", "#e8e3d5"];
      return '<article class="device-card ' + (id === state.selectedDeviceId ? "selected" : "") + '" data-device="' + escapeHtml(id) + '" tabindex="0" role="button" aria-pressed="' + (id === state.selectedDeviceId) + '">' +
        '<div class="device-visual" style="--visual-bg:' + palette[((state.page - 1) * pageSize + index) % palette.length] + '"><span class="device-number">' + String((state.page - 1) * pageSize + index + 1).padStart(2, "0") + "</span>" + deviceIllustration(deviceCategory(device), index) + "</div>" +
        '<div class="device-info"><span class="device-kind">' + escapeHtml(deviceCategory(device)) + '</span><div class="device-title-row"><h3 class="device-title">' + escapeHtml(deviceName(device)) + '</h3><span class="device-code">' + escapeHtml(deviceCode(device)) + '</span></div>' +
        '<p class="device-description">' + escapeHtml(deviceDescription(device)) + '</p><div class="device-meta"><span class="usage-count">' + deviceCount(device) + " 次使用</span><span class=\"availability " + statusClass + '">' + status + '</span></div><div class="device-card-actions"><button type="button" class="device-history" data-detail="' + escapeHtml(id) + '">设备详情</button><button type="button" class="device-history" data-history="' + escapeHtml(id) + '">查看登记历史</button></div></div></article>';
    }).join("");
    $$(".device-card").forEach((card) => {
      const select = () => selectDevice(card.dataset.device);
      card.addEventListener("click", (event) => {
        if (!event.target.closest("[data-history], [data-detail]")) select();
      });
      card.addEventListener("keydown", (event) => { if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button")) { event.preventDefault(); select(); } });
    });
    $$("[data-history]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const device = state.allDevices.find((item) => deviceId(item) === button.dataset.history);
      if (device) loadHistory(device);
    }));
    $$('[data-detail]').forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const device = state.allDevices.find((item) => deviceId(item) === button.dataset.detail);
      if (device) openDeviceDetail(device);
    }));
    $("#pageLabel").textContent = "第 " + state.page + " 页";
    $("#prevPage").disabled = state.page <= 1;
    $("#nextPage").disabled = state.page * pageSize >= state.totalDevices;
    populateBookingDevices();
    renderStatsDeviceOptions();
  }

  async function loadDevices() {
    try {
      const result = await window.Service.getDevices();
      const payload = unwrap(result.data);
      state.allDevices = listFrom(payload, ["items", "devices", "list", "results", "rows"]);
      if (state.demoMode) window.FeatureDesk?.seedDemoData(state.allDevices);
      window.FeatureDesk?.setContext({ role: state.role, account: state.account, devices: state.allDevices, selectedDate: state.selectedDate, selectedDeviceId: state.selectedDeviceId });
      state.statsSelection = state.statsSelection.filter((id) => state.allDevices.some((device) => deviceId(device) === id));
      state.devices = state.allDevices;
      state.totalDevices = filteredDevices().length;
      state.stale = !!result.stale;
      updateConnection(result);
      if (state.selectedDeviceId && !state.allDevices.some((d) => deviceId(d) === state.selectedDeviceId)) {
        state.selectedDeviceId = "";
      }
      renderDevices();
      if (!state.selectedDeviceId && state.devices.length) {
        state.selectedDeviceId = deviceId(state.devices[0]);
        window.FeatureDesk?.setContext({ role: state.role, account: state.account, devices: state.allDevices, selectedDate: state.selectedDate, selectedDeviceId: state.selectedDeviceId });
        renderDevices();
      }
      if (state.selectedDeviceId) await loadCalendar();
      else renderCalendar();
      if (state.demoMode && state.role === "admin") {
        if (!state.statsSelection.length) state.statsSelection = state.allDevices.map(deviceId);
        renderStatsDeviceOptions();
        loadStatistics();
      }
    } catch (error) {
      state.devices = [];
      state.allDevices = [];
      state.totalDevices = 0;
      renderDevices();
      showError(error.message);
    }
  }

  async function selectDevice(id) {
    state.selectedDeviceId = id;
    window.FeatureDesk?.setContext({ role: state.role, account: state.account, devices: state.allDevices, selectedDate: state.selectedDate, selectedDeviceId: id });
    state.currentHistoryDevice = null;
    state.usagePage = 1;
    renderDevices();
    const selected = state.allDevices.find((device) => deviceId(device) === id);
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
    if (!state.selectedDeviceId) { state.calendarEvents = []; state.calendarReady = true; state.calendarDeviceId = ""; renderCalendar(); return; }
    const requestedDeviceId = state.selectedDeviceId;
    const requestedYear = state.currentYear;
    const requestedMonth = state.currentMonth;
    state.calendarReady = false;
    state.calendarDeviceId = requestedDeviceId;
    state.calendarEvents = [];
    renderCalendar();
    try {
      const result = await window.Service.getCalendar({
        year: requestedYear, month: requestedMonth, deviceId: requestedDeviceId
      });
      if (requestedDeviceId !== state.selectedDeviceId || requestedYear !== state.currentYear || requestedMonth !== state.currentMonth) return;
      state.calendarEvents = normalizeEvents(result.data);
      state.calendarReady = true;
      state.calendarDeviceId = requestedDeviceId;
      updateConnection(result);
      renderCalendar();
    } catch (error) {
      if (requestedDeviceId !== state.selectedDeviceId || requestedYear !== state.currentYear || requestedMonth !== state.currentMonth) return;
      state.calendarEvents = [];
      state.calendarReady = false;
      state.calendarDeviceId = requestedDeviceId;
      renderCalendar(error.message);
      showError(error.message);
    }
  }

  function renderCalendar(error) {
    $("#monthTitle").textContent = state.currentYear + "年" + String(state.currentMonth).padStart(2, "0") + "月";
    $("#calendarYear").value = String(state.currentYear);
    $("#calendarMonth").value = String(state.currentMonth);
    const grid = $("#calendarDays");
    const first = new Date(state.currentYear, state.currentMonth - 1, 1);
    const firstOffset = (first.getDay() + 6) % 7;
    let start = new Date(state.currentYear, state.currentMonth - 1, 1 - firstOffset);
    const events = new Map(state.calendarEvents.map((event) => [event.date, event]));
    state.myReservations.filter((entry) => String(entry.deviceId) === String(state.selectedDeviceId) && (state.role === "admin" || !entry.account || entry.account === state.account)).forEach((entry) => {
      (entry.dates || []).forEach((date) => {
        const existing = events.get(date) || {};
        events.set(date, { ...existing, date, booked: true, mine: true, localReceipt: true });
      });
    });
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
      shown.push('<button class="' + classes.join(" ") + '" data-date="' + key + '" ' + (disabled ? "disabled" : "") + ' aria-label="' + key + (event && event.localReceipt ? "，本机有预约提交记录" : event && event.booked ? "，已有登记记录" : "，暂无登记记录") + '">' +
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
    window.FeatureDesk?.setContext({ role: state.role, account: state.account, devices: state.allDevices, selectedDate: date, selectedDeviceId: state.selectedDeviceId });
    state.usagePage = 1;
    state.currentView = state.currentView || "month";
    $("#usageDate").textContent = prettyDate(date);
    renderCalendar();
    if (state.currentHistoryDevice) state.currentHistoryDevice = null;
    await loadDailyUsage();
  }

  function recordFields(record) {
    const explicitTime = field(record, ["timeRange", "TimeRange", "useTime", "UseTime", "period", "Period", "slot"], "");
    const startTime = field(record, ["startTime", "StartTime", "beginTime", "BeginTime"], "");
    const endTime = field(record, ["endTime", "EndTime", "finishTime", "FinishTime"], "");
    return {
      time: String(explicitTime || (startTime && endTime ? startTime + "—" + endTime : startTime || field(record, ["time"], ""))),
      duration: String(field(record, ["duration", "Duration", "useDuration", "UseDuration", "expectedDuration", "ExpectedDuration"], "")),
      device: String(field(record, ["deviceName", "Name", "name", "device_name"], "设备")),
      id: String(field(record, ["deviceCode", "No", "deviceId", "device_id", "code"], "—")),
      user: String(field(record, ["userName", "UserName", "user", "borrower", "Borrower", "operator", "Operator"], "")),
      purpose: String(field(record, ["purpose", "usage", "description", "remark"], "—")),
      status: String(field(record, ["statusText", "status", "state"], "")),
      registration: String(field(record, ["registration", "RegTime", "registeredAt", "registrationTime", "createdAt", "registerTime"], ""))
    };
  }
  function renderUsage(records, mode, total) {
    const tbody = $("#usageRows");
    $("#usageTitle").textContent = mode === "history" ? "设备登记历史" : "当日使用登记";
    $("#usageDataNote").textContent = mode === "idle"
      ? "暂无登记只表示接口未返回该日记录；设备故障状态和可借时段仍需服务端或管理员确认。"
      : "课程接口目前只提供日期登记；未返回的时段、预计时长、登记人或设备状态会明确标出。";
    state.usageTotal = Number.isFinite(Number(total)) ? Number(total) : records.length;
    const maxPages = Math.max(1, Math.ceil(state.usageTotal / pageSize));
    $("#usagePageLabel").textContent = "第 " + state.usagePage + " / " + maxPages + " 页";
    $("#usagePrev").disabled = state.usagePage <= 1;
    $("#usageNext").disabled = state.usagePage >= maxPages;
    if (!records.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">' + (state.stale ? "缓存中没有这组记录" : (mode === "idle" ? "未找到当天暂无登记的设备" : "该日期暂无使用登记")) + "</td></tr>";
      return;
    }
    let entries = records.slice();
    if (mode === "history") entries.sort((a, b) => String(field(b, ["registration", "RegTime", "registeredAt", "registrationTime", "createdAt", "registerTime"], "")).localeCompare(String(field(a, ["registration", "RegTime", "registeredAt", "registrationTime", "createdAt", "registerTime"], ""))));
    let previousRegistration = "";
    tbody.innerHTML = entries.map((record) => {
      const row = recordFields(record);
      const useDate = String(field(record, ["date", "useDate", "UseDate", "usageDate", "startDate"], state.selectedDate || "—")).slice(0, 10);
      const condition = deviceCondition(record);
      const status = mode === "idle"
        ? (condition.unavailable ? condition.label : (condition.label === "服务端未提供" ? "设备状态未提供" : condition.label))
        : (row.status || "已有登记 · 时间未知");
      const statusClass = condition.unavailable ? "unavailable" : (mode === "idle" ? "idle" : "");
      let group = "";
      if (mode === "history" && row.registration && row.registration !== previousRegistration) {
        previousRegistration = row.registration;
        group = '<tr class="history-group"><td colspan="6">登记时间 · ' + escapeHtml(row.registration) + "</td></tr>";
      }
      const first = '<strong>' + escapeHtml(useDate) + '</strong><span class="usage-device-name">' + escapeHtml(row.device) + ' · ' + escapeHtml(row.id) + '</span>';
      return group + '<tr><td class="usage-device-cell">' + first + '</td><td>' + escapeHtml(displayField(row.time, "接口未提供")) + '</td><td>' + escapeHtml(displayField(row.duration, "接口未提供")) + '</td><td>' + escapeHtml(displayField(row.user, "接口未返回")) + '</td><td><span class="table-status ' + statusClass + '">' + escapeHtml(status) + '</span></td><td><button type="button" class="table-contact" data-contact="' + escapeHtml(row.user) + '">沟通说明</button></td></tr>';
    }).join("");
    $$('[data-contact]').forEach((button) => button.addEventListener("click", () => openContactDialog(button.dataset.contact)));
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

  function openDeviceDetail(device) {
    state.detailDevice = device;
    const id = deviceId(device);
    const condition = deviceCondition(device);
    const demoBlocked = !!window.FeatureDesk?.deviceBlocked(id);
    const currentDay = state.calendarDeviceId === id ? state.calendarEvents.find((event) => event.date === state.selectedDate) : null;
    const localSubmitted = state.myReservations.some((entry) => String(entry.deviceId) === id && (entry.dates || []).includes(state.selectedDate) && (state.role === "admin" || !entry.account || entry.account === state.account));
    const details = [
      ["设备名称", deviceName(device)], ["设备编号", id], ["设备类别", deviceCategory(device)],
      ["累计使用次数", deviceCount(device) + " 次"],
      ["设备状态", demoBlocked ? "本机演示已暂停预约" : condition.label],
      ["所在位置", field(device, ["location", "Location", "site", "Site", "room", "Room"], "")],
      ["品牌 / 型号", field(device, ["model", "Model", "brand", "Brand", "specification", "Specification"], "")],
      ["可借时段", field(device, ["availableTime", "AvailableTime", "timeRange", "TimeRange", "openingHours", "OpeningHours"], "")],
      ["单次可借时长", field(device, ["duration", "Duration", "maxDuration", "MaxDuration", "loanPeriod", "LoanPeriod"], "")],
      ["当前日期登记", localSubmitted ? "本机已提交预约" : (!state.calendarReady ? "日历记录尚未读取" : (currentDay && currentDay.booked ? "服务端已有登记" : "服务端未返回登记"))],
      ["设备说明", deviceDescription(device)]
    ];
    $("#deviceDetailTitle").textContent = deviceName(device);
    $("#deviceDetailIntro").textContent = "设备编号 " + id + " · 详细字段来自服务端设备目录。";
    $("#deviceDetailGrid").innerHTML = details.map(([label, value]) => '<div class="detail-item"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(displayField(value)) + '</strong></div>').join("");
    $("#deviceDetailNote").textContent = demoBlocked
      ? "管理员已在本机演示中暂停预约，处理或解决故障记录后可恢复；课程服务端状态未修改。"
      : condition.unavailable
      ? "服务端标记此设备为故障或停用状态，预约按钮已禁用。"
      : "预约接口只接收日期；如果没有返回时段、时长或设备状态，请先向管理员确认。";
    $("#detailReserveButton").disabled = demoBlocked || condition.unavailable || !window.Service.online || state.stale;
    $("#deviceDetailDialog").showModal();
  }
  function openContactDialog(borrower = "") {
    const name = String(borrower || "").trim();
    $("#contactTitle").textContent = name ? "与登记人沟通 · " + name : "沟通与使用协调";
    $("#contactStatusText").textContent = name
      ? "接口返回了登记人名称，但没有站内消息接口。若预约所有者开放协调，请在“预约与设备服务”的预约卡片中发起本机演示请求。"
      : "课程服务端未提供登记人身份和站内消息接口。时段协商请从“预约与设备服务”中的预约卡片发起；故障或安全问题请联系课程管理员。";
    if ($("#deviceDetailDialog").open) $("#deviceDetailDialog").close();
    $("#contactDialog").showModal();
  }

  function populateBookingDevices() {
    const select = $("#bookingDevice");
    if (!select) return;
    select.innerHTML = state.allDevices.map((device) => '<option value="' + escapeHtml(deviceId(device)) + '">' +
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
    if (!state.demoMode && state.calendarDeviceId === state.selectedDeviceId && state.calendarEvents.some((item) => item.date === state.selectedDate && item.booked)) { notify("所选日期已有登记，请换一个日期"); return; }
    const selected = state.allDevices.find((device) => deviceId(device) === state.selectedDeviceId);
    if (selected && deviceCondition(selected).unavailable) { notify("该设备在服务端标记为故障或停用，暂不能预约"); return; }
    if (window.FeatureDesk?.deviceBlocked(state.selectedDeviceId)) { notify("该设备在演示工作台中已暂停预约，请查看报修处理记录"); return; }
    state.bookingDates = [state.selectedDate];
    populateBookingDevices();
    renderBookingDates();
    $("#bookingDatePicker").value = state.selectedDate;
    $("#bookingStartTime").value = "09:00";
    $("#bookingEndTime").value = "11:00";
    $("#bookingPurpose").value = "";
    $("#bookingCoordination").checked = false;
    $("#slotSuggestions").innerHTML = "";
    $("#bookingMessage").textContent = "可继续在日历中选择日期，最多五天。";
    $("#bookingMessage").className = "form-message";
    $("#bookingDialog").showModal();
  }
  function renderBookingAlternatives(deviceId, dates, startTime, endTime, message) {
    $("#bookingMessage").textContent = message;
    const slots = window.FeatureDesk?.alternatives(deviceId, dates) || [];
    const devices = window.FeatureDesk?.recommendDevices(deviceId, dates, startTime, endTime) || [];
    const slotHtml = slots.map((slot) => '<button type="button" class="slot-suggestion" data-slot-start="' + slot.start + '" data-slot-end="' + slot.end + '">' + slot.start + '—' + slot.end + '</button>').join("");
    const deviceHtml = devices.map((device) => '<button type="button" class="slot-suggestion" data-alt-device="' + escapeHtml(device.id) + '">' + escapeHtml(device.name) + ' · ' + escapeHtml(device.id) + '</button>').join("");
    $("#slotSuggestions").innerHTML = (slotHtml ? '<p>可尝试以下本地空档：</p>' + slotHtml : "") + (deviceHtml ? '<p>也可以查看其他候选设备：</p>' + deviceHtml : "") + (!slotHtml && !deviceHtml ? '<p>暂时没有本地可推荐的空档或设备，请更换日期或加入候补。</p>' : "");
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
    const requestedDeviceId = $("#bookingDevice").value;
    const requestedDates = state.bookingDates.slice();
    const requestedDevice = state.allDevices.find((device) => deviceId(device) === requestedDeviceId);
    if (requestedDevice && deviceCondition(requestedDevice).unavailable) {
      $("#bookingMessage").textContent = "该设备已被服务端标记为故障或停用，请选择其他设备。";
      return;
    }
    if (window.FeatureDesk?.deviceBlocked(requestedDeviceId)) {
      $("#bookingMessage").textContent = "该设备在本机演示中已暂停预约，请选择其他设备或联系管理员。";
      return;
    }
    const startTime = $("#bookingStartTime").value;
    const endTime = $("#bookingEndTime").value;
    if (!startTime || !endTime || startTime >= endTime) {
      $("#bookingMessage").textContent = "结束时间必须晚于开始时间。";
      return;
    }
    const purpose = $("#bookingPurpose").value.trim();
    if (!purpose) {
      $("#bookingMessage").textContent = "请填写使用用途，便于后续确认。";
      return;
    }
    const localCheck = window.FeatureDesk?.checkConflict(requestedDeviceId, requestedDates, startTime, endTime);
    if (localCheck && !localCheck.ok) {
      renderBookingAlternatives(requestedDeviceId, requestedDates, startTime, endTime, localCheck.message);
      return;
    }
    $("#slotSuggestions").innerHTML = "";
    const button = $("#submitBooking");
    button.disabled = true;
    button.textContent = "正在提交…";
    try {
      const result = await window.Service.createReservation({
        deviceId: requestedDeviceId,
        dates: requestedDates,
        startTime,
        endTime
      });
      const payload = unwrap(result.data);
      const message = field(payload, ["message", "msg"], "服务端未返回冲突，预约请求已提交。");
      $("#bookingMessage").textContent = "提交成功：" + (requestedDevice ? deviceName(requestedDevice) : requestedDeviceId) + "，" + requestedDates.join("、") + "。" + message;
      $("#bookingMessage").classList.add("success");
      saveMyReservation({ deviceId: requestedDeviceId, deviceName: requestedDevice ? deviceName(requestedDevice) : requestedDeviceId, dates: requestedDates, account: state.account, submittedAt: new Date().toLocaleString("zh-CN", { hour12: false }) });
      window.FeatureDesk?.addReservation({
        deviceId: requestedDeviceId,
        deviceName: requestedDevice ? deviceName(requestedDevice) : requestedDeviceId,
        dates: requestedDates,
        startTime,
        endTime,
        purpose,
        account: state.account,
        allowCoordination: $("#bookingCoordination").checked,
        serviceSubmitted: true
      });
      state.selectedDeviceId = requestedDeviceId;
      state.selectedDate = requestedDates[0];
      window.FeatureDesk?.setContext({ role: state.role, account: state.account, devices: state.allDevices, selectedDate: state.selectedDate, selectedDeviceId: state.selectedDeviceId });
      $("#selectedDeviceLabel").textContent = (requestedDevice ? deviceName(requestedDevice) : requestedDeviceId) + " · " + requestedDeviceId;
      $("#usageDate").textContent = prettyDate(state.selectedDate);
      notify("预约已提交，结果记录在使用区下方");
      state.bookingMode = false;
      $("#bookingDialog").close();
      renderDevices();
      await loadCalendar();
      await loadDailyUsage();
    } catch (error) {
      const errorMessage = error.payload && (error.payload.message || error.payload.error)
        ? error.payload.message || error.payload.error
        : error.message;
      renderBookingAlternatives(requestedDeviceId, requestedDates, startTime, endTime, errorMessage + " 也可参考下方本地推荐。");
      $("#bookingMessage").classList.remove("success");
      updateConnection(null);
    } finally {
      button.disabled = false;
      button.textContent = "提交预约";
    }
  }

  function selectedStatDevices() {
    return state.allDevices.filter((device) => state.statsSelection.includes(deviceId(device)));
  }
  function currentStatRows() {
    if (state.statsPeriod === "all") return selectedStatDevices().map((device) => ({
      No: deviceId(device), Name: deviceName(device), UseCount: deviceCount(device)
    }));
    return state.statsRows;
  }
  function renderStatsSummary(rows = currentStatRows()) {
    const counts = rows.map((row) => num(row.UseCount));
    const total = counts.reduce((sum, count) => sum + count, 0);
    const average = rows.length ? total / rows.length : null;
    const topIndex = counts.length ? counts.indexOf(Math.max(...counts)) : -1;
    const formatCount = (value) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
    $("#selectedDeviceTotal").textContent = formatCount(state.statsSelection.length);
    $("#selectedUsageTotal").textContent = formatCount(total);
    $("#selectedUsageAverage").textContent = average === null ? "—" : formatCount(average);
    $("#mostUsedDevice").textContent = topIndex < 0 ? "—" : rows[topIndex].Name;
    $("#mostUsedDevice").title = topIndex < 0 ? "" : rows[topIndex].Name + " · " + formatCount(counts[topIndex]) + " 次";
    $("#mostUsedCount").textContent = topIndex < 0 ? "使用最多设备" : formatCount(counts[topIndex]) + (state.statsPeriod === "all" ? " 次使用" : " 次登记");
  }
  function updateCurrentPageSelect() {
    const visible = filteredDevices().slice((state.page - 1) * pageSize, state.page * pageSize);
    const checkbox = $("#selectCurrentPage");
    if (!checkbox) return;
    const selected = visible.filter((device) => state.statsSelection.includes(deviceId(device))).length;
    checkbox.checked = visible.length > 0 && selected === visible.length;
    checkbox.indeterminate = selected > 0 && selected < visible.length;
  }
  function renderStatsDeviceOptions() {
    const node = $("#statsDeviceList");
    if (!node) return;
    const visible = filteredDevices().slice((state.page - 1) * pageSize, state.page * pageSize);
    if (!state.allDevices.length) {
      node.innerHTML = '<p class="table-empty">暂无设备数据</p>';
      $("#statsPageLabel").textContent = "第 1 页";
      $("#statsPrev").disabled = true;
      $("#statsNext").disabled = true;
      updateCurrentPageSelect();
      renderStatsSummary([]);
      return;
    }
    node.innerHTML = visible.map((device) => {
      const id = deviceId(device);
      const condition = deviceCondition(device);
      return '<label class="admin-device-row"><input type="checkbox" value="' + escapeHtml(id) + '" ' + (state.statsSelection.includes(id) ? "checked" : "") + '><span class="admin-device-name">' + escapeHtml(deviceName(device)) + '</span><span class="admin-device-code">' + escapeHtml(id) + '</span><span class="admin-device-count">' + deviceCount(device) + ' 次</span><span class="admin-device-state ' + (condition.unavailable ? "unavailable" : "") + '">' + escapeHtml(condition.label) + '</span></label>';
    }).join("");
    $$('.admin-device-row input', node).forEach((input) => input.addEventListener("change", () => {
      if (input.checked && !state.statsSelection.includes(input.value)) state.statsSelection.push(input.value);
      if (!input.checked) state.statsSelection = state.statsSelection.filter((id) => id !== input.value);
      updateCurrentPageSelect();
      renderStatsSummary();
      loadStatistics();
    }));
    const pages = Math.max(1, Math.ceil(filteredDevices().length / pageSize));
    $("#statsPageLabel").textContent = "第 " + state.page + " / " + pages + " 页";
    $("#statsPrev").disabled = state.page <= 1;
    $("#statsNext").disabled = state.page >= pages;
    updateCurrentPageSelect();
    renderStatsSummary();
  }
  function setStatsHeading(range) {
    const isCumulative = state.statsPeriod === "all";
    const isPendingCustom = state.statsPeriod === "custom" && !range;
    $("#statsChartTitle").textContent = isCumulative ? "设备累计使用次数对比" : "设备区间登记次数对比";
    $("#statsRange").textContent = isCumulative ? "累计使用" : (range ? range.start + " 至 " + range.end : "待选区间");
    $("#selectedUsageTotalLabel").textContent = isCumulative ? "使用次数合计" : "区间登记次数合计";
    $("#selectedUsageAverageLabel").textContent = isCumulative ? "平均使用次数" : "平均区间登记次数";
    $("#statsPeriodNote").textContent = isCumulative ? "累计统计沿用 UseCount" : "区间统计依据 UseDate 登记记录";
    $("#statsChartCaption").textContent = isCumulative
      ? "累计次数取自设备目录的 UseCount 字段。"
      : "按服务端记录中的 UseDate 统计该日期范围内的登记次数；接口没有实际完成状态字段。";
    if (isPendingCustom) $("#statsChart").innerHTML = '<p class="table-empty">请选择开始日期和结束日期，再点击“应用区间”。</p>';
  }
  function resolveStatsRange(period) {
    if (period === "all") return null;
    if (period === "custom") return state.statsRange;
    const end = dateKey(today);
    if (period === "month") return { start: end.slice(0, 7) + "-01", end };
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 29);
    return { start: dateKey(startDate), end };
  }
  function renderStatsChart(rows, range) {
    const node = $("#statsChart");
    if (!rows.length) {
      node.innerHTML = '<p class="table-empty">' + (state.stale ? "缓存中没有该范围的设备登记记录" : "服务端暂未返回统计数据") + "</p>";
      return;
    }
    const sorted = rows.slice().sort((a, b) => num(b.UseCount) - num(a.UseCount));
    const maximum = Math.max(1, ...sorted.map((row) => num(row.UseCount)));
    node.innerHTML = sorted.map((row) => {
      const count = num(row.UseCount);
      return '<div class="bar-row"><span class="bar-name" title="' + escapeHtml(row.Name) + '">' + escapeHtml(row.Name) + '</span><div class="bar-track"><div class="bar-fill" style="--bar-width:' + Math.round(count / maximum * 100) + '%"></div></div><span class="bar-value">' + new Intl.NumberFormat("zh-CN").format(count) + "</span></div>";
    }).join("");
    setStatsHeading(range);
  }
  async function loadStatistics() {
    const node = $("#statsChart");
    const requestId = ++state.statsRequestId;
    const range = resolveStatsRange(state.statsPeriod);
    setStatsHeading(range);
    if (!state.statsSelection.length) {
      state.statsRows = [];
      renderStatsSummary([]);
      node.innerHTML = '<p class="table-empty">请在左侧勾选设备，查看累计次数或所选日期范围内的登记次数。</p>';
      return;
    }
    if (state.statsPeriod === "custom" && !range) {
      state.statsRows = [];
      renderStatsSummary([]);
      return;
    }
    renderStatsSummary();
    node.innerHTML = '<p class="table-empty"><span class="spinner"></span>正在读取统计数据…</p>';
    try {
      const result = state.statsPeriod === "all"
        ? await window.Service.getStatistics({ deviceIds: state.statsSelection })
        : await window.Service.getRangeStatistics({ deviceIds: state.statsSelection, start: range.start, end: range.end });
      if (requestId !== state.statsRequestId) return;
      updateConnection(result);
      const returned = listFrom(result.data, ["items", "statistics", "stats", "devices", "rows"]);
      const rows = returned.map((item) => {
        const id = String(field(item, ["No", "deviceId", "id", "code"], ""));
        const device = state.allDevices.find((entry) => deviceId(entry) === id);
        return {
          No: id,
          Name: String(field(item, ["Name", "deviceName", "name", "label"], device ? deviceName(device) : id)),
          UseCount: num(field(item, ["UseCount", "count", "usageCount", "useCount", "total", "value"], 0))
        };
      });
      state.statsRows = rows;
      renderStatsSummary(rows);
      renderStatsChart(rows, range);
    } catch (error) {
      if (requestId !== state.statsRequestId) return;
      state.statsRows = [];
      renderStatsSummary([]);
      node.innerHTML = '<p class="table-empty">' + escapeHtml(error.message) + "</p>";
      showError(error.message);
    }
  }
  function setRoleView() {
    $(".workspace").hidden = state.role === "admin" && state.adminView;
    $("#adminPanel").hidden = state.role !== "admin" || !state.adminView;
    $("#adminNavLink").hidden = state.role !== "admin";
    if (state.role === "admin" && state.adminView) { renderStatsDeviceOptions(); loadStatistics(); }
  }
  function changeMonth(offset) {
    state.currentMonth += offset;
    if (state.currentMonth < 1) { state.currentMonth = 12; state.currentYear--; }
    if (state.currentMonth > 12) { state.currentMonth = 1; state.currentYear++; }
    if (state.currentYear < calendarMinYear) { state.currentYear = calendarMinYear; state.currentMonth = 1; }
    if (state.currentYear > calendarMaxYear) { state.currentYear = calendarMaxYear; state.currentMonth = 12; }
    state.calendarReady = false;
    loadCalendar();
  }
  function applyCalendarMonth() {
    const year = Number($("#calendarYear").value);
    const month = Number($("#calendarMonth").value);
    if (year < calendarMinYear || year > calendarMaxYear || month < 1 || month > 12) return;
    state.currentYear = year;
    state.currentMonth = month;
    state.currentView = "month";
    $$(".view-button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === "month"));
    $("#monthYearPicker").hidden = true;
    $("#monthPickerToggle").setAttribute("aria-expanded", "false");
    state.calendarReady = false;
    loadCalendar();
  }
  function setStatsPeriod(period) {
    state.statsPeriod = period;
    $("#customStatsRange").hidden = period !== "custom";
    $("#statsRangeError").textContent = "";
    if (period === "custom") {
      const end = dateKey(today);
      $("#statsStartDate").value = state.statsRange?.start || end.slice(0, 7) + "-01";
      $("#statsEndDate").value = state.statsRange?.end || end;
      state.statsRange = null;
    } else {
      state.statsRange = resolveStatsRange(period);
    }
    loadStatistics();
  }
  function applyCustomStatsRange() {
    const start = $("#statsStartDate").value;
    const end = $("#statsEndDate").value;
    const startYear = Number(start.slice(0, 4));
    const endYear = Number(end.slice(0, 4));
    if (!start || !end || start > end || startYear < calendarMinYear || endYear > calendarMaxYear) {
      $("#statsRangeError").textContent = "请选择有效范围：开始日期不得晚于结束日期，年份需在 " + calendarMinYear + "—" + calendarMaxYear + " 之间。";
      return;
    }
    state.statsRange = { start, end };
    $("#statsRangeError").textContent = "";
    loadStatistics();
  }
  function changeMonth(offset) {
    state.currentMonth += offset;
    if (state.currentMonth < 1) { state.currentMonth = 12; state.currentYear--; }
    if (state.currentMonth > 12) { state.currentMonth = 1; state.currentYear++; }
    state.calendarReady = false;
    loadCalendar();
  }
  function bindEvents() {
    document.addEventListener("workflow:update", () => renderDevices());
    $("#loginForm").addEventListener("submit", handleDemoLogin);
    $$('[data-demo-start]').forEach((button) => button.addEventListener("click", startFullDemo));
    $("#logoutButton").addEventListener("click", logoutDemo);
    $("#detailContactButton").addEventListener("click", () => openContactDialog());
    $("#detailHistoryButton").addEventListener("click", () => {
      const device = state.detailDevice;
      if (device) { $("#deviceDetailDialog").close(); loadHistory(device); }
    });
    $("#detailReserveButton").addEventListener("click", async () => {
      if (!state.detailDevice) return;
      state.selectedDeviceId = deviceId(state.detailDevice);
      $("#selectedDeviceLabel").textContent = deviceName(state.detailDevice) + " · " + deviceCode(state.detailDevice);
      $("#deviceDetailDialog").close();
      await loadCalendar();
      openBooking();
    });
    $("#closeContactDialog").addEventListener("click", () => $("#contactDialog").close());
    $$(".nav-link").forEach((link) => link.addEventListener("click", () => {
      $$(".nav-link").forEach((item) => item.classList.toggle("active", item === link));
      if (link.id === "adminNavLink" && state.role === "admin") {
        state.adminView = true;
        setRoleView();
      } else if (link.getAttribute("href") === "#devices" && state.role === "admin") {
        state.adminView = false;
        setRoleView();
      }
    }));
    $("#prevPage").addEventListener("click", () => { if (state.page > 1) { state.page--; renderDevices(); } });
    $("#nextPage").addEventListener("click", () => { if (state.page * pageSize < filteredDevices().length) { state.page++; renderDevices(); } });
    $("#statsPrev").addEventListener("click", () => { if (state.page > 1) { state.page--; renderStatsDeviceOptions(); } });
    $("#statsNext").addEventListener("click", () => { if (state.page * pageSize < filteredDevices().length) { state.page++; renderStatsDeviceOptions(); } });
    $("#selectCurrentPage").addEventListener("change", (event) => {
      const ids = filteredDevices().slice((state.page - 1) * pageSize, state.page * pageSize).map(deviceId);
      state.statsSelection = event.target.checked
        ? Array.from(new Set(state.statsSelection.concat(ids)))
        : state.statsSelection.filter((id) => !ids.includes(id));
      renderStatsDeviceOptions(); loadStatistics();
    });
    $("#selectAllDevices").addEventListener("click", () => {
      state.statsSelection = state.allDevices.map(deviceId);
      renderStatsDeviceOptions(); loadStatistics();
    });
    $("#clearSelection").addEventListener("click", () => {
      state.statsSelection = [];
      renderStatsDeviceOptions(); loadStatistics();
    });
    $("#deviceSearch").addEventListener("input", (event) => {
      clearTimeout(state.searchTimer);
      state.search = event.target.value.trim();
      state.searchTimer = setTimeout(() => { state.page = 1; renderDevices(); }, 180);
    });
    $("#prevMonth").addEventListener("click", () => changeMonth(-1));
    $("#nextMonth").addEventListener("click", () => changeMonth(1));
    $("#monthPickerToggle").addEventListener("click", () => {
      const picker = $("#monthYearPicker");
      picker.hidden = !picker.hidden;
      $("#monthPickerToggle").setAttribute("aria-expanded", String(!picker.hidden));
      if (!picker.hidden) {
        $("#calendarYear").value = String(state.currentYear);
        $("#calendarMonth").value = String(state.currentMonth);
        $("#calendarYear").focus();
      }
    });
    $("#applyCalendarMonth").addEventListener("click", applyCalendarMonth);
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".calendar-title-wrap") && !$("#monthYearPicker").hidden) {
        $("#monthYearPicker").hidden = true;
        $("#monthPickerToggle").setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#monthYearPicker").hidden) {
        $("#monthYearPicker").hidden = true;
        $("#monthPickerToggle").setAttribute("aria-expanded", "false");
      }
    });
    $("#statsPeriod").addEventListener("change", (event) => setStatsPeriod(event.target.value));
    $("#applyStatsRange").addEventListener("click", applyCustomStatsRange);
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
    $("#bookingDevice").addEventListener("change", (event) => { state.selectedDeviceId = event.target.value; window.FeatureDesk?.setContext({ role: state.role, account: state.account, devices: state.allDevices, selectedDate: state.selectedDate, selectedDeviceId: state.selectedDeviceId }); loadCalendar(); });
    $("#slotSuggestions").addEventListener("click", (event) => {
      const button = event.target.closest("[data-slot-start]");
      if (button) {
        $("#bookingStartTime").value = button.dataset.slotStart;
        $("#bookingEndTime").value = button.dataset.slotEnd;
        $("#bookingMessage").textContent = "已填入建议时段，请重新提交预约。";
        $("#slotSuggestions").innerHTML = "";
        return;
      }
      const alternativeDevice = event.target.closest("[data-alt-device]");
      if (alternativeDevice) {
        $("#bookingDevice").value = alternativeDevice.dataset.altDevice;
        state.selectedDeviceId = alternativeDevice.dataset.altDevice;
        window.FeatureDesk?.setContext({ role: state.role, account: state.account, devices: state.allDevices, selectedDate: state.selectedDate, selectedDeviceId: state.selectedDeviceId });
        notify("已切换候选设备；日期与时段保留，请重新提交前核对设备状态");
      }
    });
    $("#addBookingDate").addEventListener("click", () => {
      const date = $("#bookingDatePicker").value;
      if (!date) { notify("先选择一个日期"); return; }
      if (state.bookingDates.includes(date)) { notify("这个日期已经添加"); return; }
      if (!state.demoMode && String($("#bookingDevice").value) === String(state.calendarDeviceId) && state.calendarEvents.some((item) => item.date === date && item.booked)) { notify("该日期已有登记，请换一个日期"); return; }
      if (state.bookingDates.length >= 5) { notify("一次最多选择五个日期"); return; }
      state.bookingDates.push(date);
      state.bookingDates.sort();
      renderBookingDates();
    });

    $("#serverStatus").addEventListener("click", () => {
      notify(state.demoMode ? "当前使用本机完整演示数据，不连接课程模拟服务端" : (window.Service.online ? "当前已连接课程模拟服务端" : "当前离线，只能查看此前缓存的数据"));
    });
  }
  async function start() {
    bindEvents();
    initCalendarPicker();
    readMyReservations();
    state.selectedDate = dateKey(today);
    state.currentView = "month";
    $("#usageDate").textContent = prettyDate(state.selectedDate);
    localStorage.removeItem("wu-jin-qi-yong:role");
    const saved = localStorage.getItem("wu-jin-qi-yong:demo-session");
    if (!saved) { showLogin(); return; }
    try {
      const session = JSON.parse(saved);
      const valid = (session.account === "student" && session.role === "user") || (session.account === "admin" && session.role === "admin");
      if (!valid) throw new Error("invalid demo session");
      state.demoMode = Boolean(session.demoMode);
      window.Service = state.demoMode ? window.DemoService : courseService;
      setStatus(state.demoMode ? "完整体验数据" : "连接中", state.demoMode ? "online" : "", state.demoMode ? "当前使用浏览器本地演示数据，不连接课程服务端" : "正在连接课程模拟服务端");
      await enterDemoSession(session.role, session.account, false);
    } catch {
      localStorage.removeItem("wu-jin-qi-yong:demo-session");
      showLogin();
    }
    if (!state.selectedDeviceId && document.body.classList.contains("is-authenticated")) renderCalendar();
  }
  start();
})();
