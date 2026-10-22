/* Browser-local collaboration demo for workflows absent from the course WCF API. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "wu-jin-qi-yong:workflow:v1";
  const empty = () => ({ reservations: [], issues: [], maintenance: [], notices: [], waitlist: [], coordination: [] });
  let data = empty();
  let context = { role: "user", account: "student", devices: [], selectedDate: "", selectedDeviceId: "" };
  let reservationFilter = "all";
  let pendingCoordinationReservation = "";
  try { data = { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { data = empty(); }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* local demo storage may be unavailable */ } };
  const id = () => "wf-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toLocaleString("zh-CN", { hour12: false });
  const deviceName = (deviceId) => {
    const device = context.devices.find((d) => String(d.No ?? d.id ?? d.deviceId) === String(deviceId));
    return device ? String(device.Name ?? device.name ?? device.deviceName ?? deviceId) : String(deviceId);
  };
  const ownedByMe = (entry) => entry.account === context.account;
  const isActive = (entry) => !["completed", "cancelled", "withdrawn"].includes(entry.status);
  function optionsFor(selector) {
    const select = $(selector);
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">选择一件设备</option>' + context.devices.map((d) => {
      const code = String(d.No ?? d.id ?? d.deviceId ?? "");
      const name = String(d.Name ?? d.name ?? d.deviceName ?? code);
      return '<option value="' + esc(code) + '">' + esc(name + " · " + code) + "</option>";
    }).join("");
    if (context.devices.some((d) => String(d.No ?? d.id ?? d.deviceId) === current)) select.value = current;
  }
  function statusLabel(status) {
    return ({ pending: "待确认", confirmed: "已确认", cancel_requested: "申请取消", completed: "已完成", cancelled: "已取消", withdrawn: "已撤回" })[status] || "待确认";
  }
  function renderReservations() {
    const list = $("#workflowReservations");
    if (!list) return;
    const rows = data.reservations.filter((r) => context.role === "admin" || ownedByMe(r)).filter((r) => {
      if (reservationFilter === "active") return isActive(r);
      if (reservationFilter === "done") return !isActive(r);
      return true;
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    $("#reservationCount").textContent = rows.length + " 条";
    if (!rows.length) { list.innerHTML = '<p class="workflow-empty">暂无符合条件的预约。提交预约后，时段、用途和交接进度会显示在这里。</p>'; return; }
    list.innerHTML = rows.map((r) => {
      const incoming = data.coordination.filter((m) => m.to === context.account && m.reservationId === r.id && m.status === "pending");
      const owner = context.role === "admin" ? '<span class="reservation-owner">演示账号：' + esc(r.account) + '</span>' : "";
      const check = r.handoff || {};
      const checklist = ["设备外观正常", "配件数量齐全", "开机 / 功能正常"];
      const controls = isActive(r) ? '<div class="handoff-box"><strong>取还设备检查</strong><div class="handoff-checks">' + checklist.map((label, i) => '<label><input type="checkbox" data-handoff="' + esc(r.id) + '" data-check="' + i + '" ' + (check[i] ? "checked" : "") + '><span>' + label + "</span></label>").join("") + '</div><div class="handoff-return"><input type="text" maxlength="100" data-condition="' + esc(r.id) + '" placeholder="归还时记录设备状态或异常" value="' + esc(r.returnNote || "") + '"><button type="button" class="text-button" data-complete="' + esc(r.id) + '">完成归还</button></div></div>' : "";
      const action = r.account === context.account && isActive(r) ? '<div class="reservation-actions"><button type="button" class="text-button" data-toggle-coordination="' + esc(r.id) + '">' + (r.allowCoordination ? "关闭时段协调" : "开放时段协调") + '</button><button type="button" class="text-button" data-cancel="' + esc(r.id) + '">申请取消</button></div>' : "";
      const adminAction = context.role === "admin" && r.status === "cancel_requested"
        ? '<button type="button" class="text-button" data-cancelresolve="' + esc(r.id) + '">确认本地取消</button>'
        : (context.role === "admin" && isActive(r) ? '<button type="button" class="text-button" data-confirm="' + esc(r.id) + '">' + (r.status === "confirmed" ? "标记待确认" : "演示确认") + "</button>" : "");
      const requestCards = incoming.map((m) => '<div class="coordination-request"><div><strong>时段协调请求 · ' + esc(m.from) + '</strong><p>希望调整到 ' + esc(m.proposedSlot) + '</p></div><div><button type="button" class="text-button" data-message="' + esc(m.id) + '" data-decision="accept">同意</button><button type="button" class="text-button" data-message="' + esc(m.id) + '" data-decision="decline">婉拒</button></div></div>').join("");
      return '<article class="workflow-reservation"><div class="workflow-reservation-top"><span class="workflow-status status-' + esc(r.status) + '">' + statusLabel(r.status) + '</span><time>' + esc(r.createdAt) + '</time></div><div class="workflow-reservation-main"><h4>' + esc(r.deviceName || deviceName(r.deviceId)) + '</h4><span>' + esc(r.deviceId) + '</span></div><div class="workflow-reservation-meta"><span>' + esc((r.dates || []).join("、")) + '</span><strong>' + esc(r.startTime) + '—' + esc(r.endTime) + '</strong></div><p class="reservation-purpose">用途：' + esc(r.purpose || "未填写") + '</p>' + owner + '<p class="workflow-source-note">课程服务端原始日期：' + esc((r.serverDates || r.dates || []).join("、")) + '。时段、协商变更、状态和交接仅在本机演示记录。</p>' + controls + requestCards + (action || adminAction ? '<div class="reservation-actions">' + action + adminAction + '</div>' : "") + '</article>';
    }).join("");
    $$('[data-handoff]').forEach((input) => input.addEventListener("change", () => updateHandoff(input.dataset.handoff, input.dataset.check, input.checked)));
    $$('[data-condition]').forEach((input) => input.addEventListener("change", () => updateCondition(input.dataset.condition, input.value)));
    $$('[data-complete]').forEach((button) => button.addEventListener("click", () => completeReservation(button.dataset.complete)));
    $$('[data-cancel]').forEach((button) => button.addEventListener("click", () => requestCancel(button.dataset.cancel)));
    $$('[data-confirm]').forEach((button) => button.addEventListener("click", () => toggleConfirm(button.dataset.confirm)));
    $$('[data-cancelresolve]').forEach((button) => button.addEventListener("click", () => resolveCancel(button.dataset.cancelresolve)));
    $$('[data-coordinate]').forEach((button) => button.addEventListener("click", () => coordinate(button.dataset.coordinate)));
    $$('[data-toggle-coordination]').forEach((button) => button.addEventListener("click", () => toggleCoordination(button.dataset.toggleCoordination)));
    $$('[data-message]').forEach((button) => button.addEventListener("click", () => answerCoordination(button.dataset.message, button.dataset.decision)));
    renderOpenCoordination();
  }
  function renderOpenCoordination() {
    const list = $("#openCoordinationList"); if (!list) return;
    const rows = data.reservations.filter((r) => r.allowCoordination && isActive(r) && r.account !== context.account).slice(0, 12);
    list.innerHTML = rows.length ? rows.map((r) => {
      const previous = data.coordination.find((m) => m.reservationId === r.id && m.from === context.account);
      const label = previous ? ({ pending: "等待回复", accepted: "已同意", declined: "再次申请" })[previous.status] || "申请协商" : "申请协商";
      const disabled = previous && ["pending", "accepted"].includes(previous.status);
      return '<article class="open-slot-card"><div><span class="workflow-status status-confirmed">可申请协调</span><h4>' + esc(r.deviceName || deviceName(r.deviceId)) + '</h4><p>' + esc((r.dates || []).join("、")) + ' · ' + esc(r.startTime) + '—' + esc(r.endTime) + '</p><small>演示账号 ' + esc(r.account) + ' · 用途：' + esc(r.purpose || "未填写") + (previous && previous.status !== "pending" ? ' · 上次结果：' + esc(previous.status === "accepted" ? "已同意" : "已婉拒") : "") + '</small></div><button type="button" class="secondary-button" data-open-coordinate="' + esc(r.id) + '" ' + (disabled ? "disabled" : "") + '>' + label + '</button></article>';
    }).join("") : '<p class="workflow-empty">当前没有其他账号开放协调的预约。可以在预约时勾选“允许其他演示账号向我发送时段协调请求”。</p>';
    $$('[data-open-coordinate]').forEach((button) => button.addEventListener("click", () => coordinate(button.dataset.openCoordinate)));
  }
  function renderIssues() {
    const mine = $("#myIssueList");
    const admin = $("#adminIssueList");
    const rows = data.issues.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (mine) {
      const own = rows.filter((r) => context.role === "admin" || r.account === context.account).slice(0, 4);
      const waitRows = data.waitlist.filter((w) => context.role === "admin" || w.account === context.account);
      const issueHtml = own.map((r) => '<article class="compact-record"><div><strong>' + esc(r.deviceName || deviceName(r.deviceId)) + '</strong><span>' + esc(r.type) + ' · ' + esc(r.status) + '</span></div><p>' + esc(r.description) + '</p><small>' + esc(r.createdAt) + '</small></article>').join("");
      const waitHtml = waitRows.map((w) => '<article class="compact-record waitlist-record"><div><strong>候补 · ' + esc(w.deviceName || deviceName(w.deviceId)) + '</strong><span>' + esc(w.status || "等待空档") + '</span></div><small>' + esc(w.date) + ' · 演示账号 ' + esc(w.account) + ' · ' + esc(w.createdAt) + '</small>' + (w.status === "有空档待确认" ? '<p>请先回到设备日历确认服务端仍可预约，再提交新的预约。</p>' : "") + '</article>').join("");
      mine.innerHTML = issueHtml + waitHtml || '<p class="workflow-empty">暂无问题记录或候补。</p>';
    }
    if (admin) admin.innerHTML = rows.length ? rows.map((r) => '<article class="issue-row"><div><span class="workflow-status status-' + (r.status === "已解决" ? "completed" : "pending") + '">' + esc(r.status) + '</span><strong>' + esc(r.deviceName || deviceName(r.deviceId)) + '</strong><small>' + esc(r.type) + ' · ' + esc(r.account) + ' · ' + esc(r.createdAt) + '</small><p>' + esc(r.description) + '</p></div><div class="issue-actions"><button type="button" class="text-button" data-issue="' + esc(r.id) + '" data-state="处理中">接手</button><button type="button" class="text-button" data-issue="' + esc(r.id) + '" data-state="已解决">解决</button><button type="button" class="text-button" data-block="' + esc(r.id) + '">' + (r.blocked ? "恢复预约" : "暂停预约") + '</button></div></article>').join("") : '<p class="workflow-empty">暂无问题记录，用户提交后会出现在这里。</p>';
    $$('[data-issue]').forEach((button) => button.addEventListener("click", () => { const row = data.issues.find((r) => r.id === button.dataset.issue); if (row) { row.status = button.dataset.state; if (row.status === "已解决") row.blocked = false; } persist(); renderAll(); }));
    $$('[data-block]').forEach((button) => button.addEventListener("click", () => { const row = data.issues.find((r) => r.id === button.dataset.block); if (row) { row.blocked = !row.blocked; if (row.blocked && row.status === "已解决") row.status = "处理中"; } persist(); renderAll(); }));
  }
  function renderMaintenance() {
    const rows = data.maintenance.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const html = rows.length ? rows.map((m) => '<article class="compact-record"><div><strong>' + esc(m.deviceName || deviceName(m.deviceId)) + '</strong><span>' + esc(m.date) + '</span></div><p>' + esc(m.note) + '</p><small>由管理员演示账号 ' + esc(m.account) + ' 发布</small></article>').join("") : '<p class="workflow-empty">暂无维护安排。</p>';
    if ($("#maintenanceList")) $("#maintenanceList").innerHTML = html;
    const publicList = $("#publicMaintenanceList");
    if (publicList) publicList.innerHTML = rows.length ? rows.map((m) => '<article class="public-notice maintenance-notice"><span class="notice-tag">维护安排</span><time>' + esc(m.date) + '</time><h4>' + esc(m.deviceName || deviceName(m.deviceId)) + '</h4><p>' + esc(m.note) + '</p></article>').join("") : '<p class="workflow-empty">暂无维护安排。</p>';
  }
  function renderNotices() {
    const list = $("#publicNoticeList");
    if (!list) return;
    const rows = data.notices.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    list.innerHTML = rows.length ? rows.map((n) => '<article class="public-notice"><span class="notice-tag">' + esc(n.category) + '</span><time>' + esc(n.createdAt) + '</time><h4>' + esc(n.title) + '</h4><p>' + esc(n.body) + '</p><small>发布者：' + esc(n.account) + '</small></article>').join("") : '<p class="workflow-empty">暂无公告。管理员可在服务工作台发布设备维护、故障或使用提醒。</p>';
    if ($("#adminNoticeList")) $("#adminNoticeList").innerHTML = rows.length ? rows.slice(0, 3).map((n) => '<p class="mini-notice">' + esc(n.title) + ' · ' + esc(n.category) + '</p>').join("") : '<p class="workflow-helper">尚未发布公告。</p>';
  }
  function renderMetrics() {
    const box = $("#serviceMetrics"); if (!box) return;
    const active = data.reservations.filter(isActive).length;
    const hours = data.reservations.filter((r) => r.status !== "cancelled" && r.status !== "withdrawn").reduce((sum, r) => sum + Math.max(0, (Number(r.endTime.slice(0, 2)) * 60 + Number(r.endTime.slice(3, 5)) - Number(r.startTime.slice(0, 2)) * 60 - Number(r.startTime.slice(3, 5))) / 60) * (r.dates || []).length, 0);
    const metrics = [[active, "进行中预约"], [data.issues.filter((r) => r.status !== "已解决").length, "待处理问题"], [data.maintenance.length, "维护安排"], [hours.toFixed(1), "预约时长（小时）"]];
    box.innerHTML = metrics.map(([n, label]) => '<div class="service-metric"><strong>' + esc(n) + '</strong><span>' + esc(label) + '</span></div>').join("");
  }
  function renderAll() { renderReservations(); renderIssues(); renderMaintenance(); renderNotices(); renderMetrics(); if (typeof CustomEvent !== "undefined") window.dispatchEvent(new CustomEvent("workflow:update")); }
  function updateHandoff(reservationId, check, checked) { const r = data.reservations.find((x) => x.id === reservationId); if (r) { r.handoff = { ...(r.handoff || {}), [check]: checked }; persist(); } }
  function updateCondition(reservationId, note) { const r = data.reservations.find((x) => x.id === reservationId); if (r) { r.returnNote = note; persist(); } }
  function notifyWaitlist(r) { const releasedDates = (r.dates || []).concat(r.serverDates || []); data.waitlist.filter((w) => String(w.deviceId) === String(r.deviceId) && releasedDates.includes(w.date)).forEach((w) => { w.status = "有空档待确认"; w.notifiedAt = now(); }); }
  function completeReservation(reservationId) { const r = data.reservations.find((x) => x.id === reservationId); if (!r) return; if (![0, 1, 2].every((key) => r.handoff && r.handoff[key]) || !String(r.returnNote || "").trim()) { notify("请完成外观、配件、功能检查并记录归还状态"); return; } if (/异常|损坏|故障|缺失|破损|无法|不正常/.test(r.returnNote)) data.issues.unshift({ id: id(), deviceId: r.deviceId, deviceName: r.deviceName, account: r.account, type: "归还检查异常", description: r.returnNote, status: "待处理", blocked: false, createdAt: now() }); r.status = "completed"; r.completedAt = now(); notifyWaitlist(r); persist(); renderAll(); notify("已在本机演示中记录归还；如描述异常，系统已生成待处理问题。候补账号可查看空档提示"); }
  function requestCancel(reservationId) { const r = data.reservations.find((x) => x.id === reservationId); if (!r) return; r.status = "cancel_requested"; persist(); renderAll(); notify("已记录取消申请；课程服务端不支持撤销预约，请另行联系管理员"); }
  function resolveCancel(reservationId) { const r = data.reservations.find((x) => x.id === reservationId); if (!r) return; r.status = "cancelled"; r.cancelledAt = now(); notifyWaitlist(r); persist(); renderAll(); notify("已在本机演示中处理取消申请；候补账号可查看空档提示，课程服务端登记未改变"); }
  function toggleConfirm(reservationId) { const r = data.reservations.find((x) => x.id === reservationId); if (!r) return; r.status = r.status === "confirmed" ? "pending" : "confirmed"; r.confirmedBy = context.account; persist(); renderAll(); }
  function toggleCoordination(reservationId) { const r = data.reservations.find((x) => x.id === reservationId); if (!r || r.account !== context.account) return; r.allowCoordination = !r.allowCoordination; persist(); renderAll(); notify(r.allowCoordination ? "已开放本机演示时段协调" : "已关闭时段协调入口"); }
  function coordinate(reservationId) {
    const r = data.reservations.find((x) => x.id === reservationId);
    if (!r || !r.allowCoordination) { notify("对方未开放时段协调"); return; }
    pendingCoordinationReservation = reservationId;
    $("#coordinationTargetLabel").textContent = "申请调整「" + (r.deviceName || deviceName(r.deviceId)) + "」的使用时间；对方同意后仅更新本机演示记录。";
    $("#coordinationDate").value = (r.dates || [context.selectedDate])[0] || context.selectedDate;
    $("#coordinationStart").value = r.startTime || "09:00";
    $("#coordinationEnd").value = r.endTime || "11:00";
    $("#coordinationNote").value = "";
    $("#coordinationMessage").textContent = "";
    $("#coordinationDialog").showModal();
  }
  function submitCoordination(event) {
    event.preventDefault();
    const r = data.reservations.find((x) => x.id === pendingCoordinationReservation);
    const date = $("#coordinationDate").value, start = $("#coordinationStart").value, end = $("#coordinationEnd").value;
    if (!r || !date || !start || !end || start >= end) { $("#coordinationMessage").textContent = "请填写有效日期，并确保结束时间晚于开始时间。"; return; }
    const proposedSlot = date + " " + start + "—" + end;
    data.coordination.unshift({ id: id(), reservationId: r.id, from: context.account, to: r.account, proposedSlot, note: $("#coordinationNote").value.trim(), status: "pending", createdAt: now() });
    persist(); $("#coordinationDialog").close(); renderAll(); notify("时段协调申请已发送到本机演示账号");
  }
  function answerCoordination(messageId, decision) {
    const m = data.coordination.find((x) => x.id === messageId); if (!m) return;
    if (decision === "accept") {
      const match = m.proposedSlot.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*[—–-]\s*(\d{2}:\d{2})$/);
      const r = data.reservations.find((x) => x.id === m.reservationId);
      if (!match || !r) { notify("协商时段格式无效，请按“YYYY-MM-DD HH:MM—HH:MM”重新发送"); return; }
      if (match[2] >= match[3] || data.reservations.some((other) => other.id !== r.id && String(other.deviceId) === String(r.deviceId) && isActive(other) && (other.dates || []).includes(match[1]) && match[2] < other.endTime && match[3] > other.startTime) || hasMaintenance(r.deviceId, match[1]) || deviceBlocked(r.deviceId)) { notify("这个建议时段与本地预约或维护安排冲突，暂不能接受"); return; }
      r.dates = [match[1]]; r.startTime = match[2]; r.endTime = match[3];
    }
    m.status = decision === "accept" ? "accepted" : "declined"; m.repliedAt = now(); persist(); renderAll(); notify(decision === "accept" ? "已更新本地演示时段；课程服务端原预约仍需双方自行确认" : "已记录婉拒");
  }
  function deviceBlocked(deviceId) { return data.issues.some((r) => String(r.deviceId) === String(deviceId) && r.blocked && r.status !== "已解决"); }
  function hasMaintenance(deviceId, date) { return data.maintenance.some((m) => String(m.deviceId) === String(deviceId) && m.date === date); }
  function checkConflict(deviceId, dates, startTime, endTime) {
    const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const collision = data.reservations.find((r) => String(r.deviceId) === String(deviceId) && isActive(r) && (r.dates || []).some((d) => dates.includes(d)) && minutes(startTime) < minutes(r.endTime) && minutes(endTime) > minutes(r.startTime));
    if (collision) return { ok: false, message: "此时段与 " + collision.account + " 的本地演示预约冲突。可选择下方空档建议，或加入候补。" };
    const maintenance = dates.find((date) => hasMaintenance(deviceId, date));
    if (maintenance) return { ok: false, message: maintenance + " 已安排设备维护，请改期或联系管理员。" };
    if (deviceBlocked(deviceId)) return { ok: false, message: "该设备在本机演示中已暂停预约（存在未解决的安全/故障标记）。" };
    return { ok: true };
  }
  function alternatives(deviceId, dates) {
    const candidates = [["09:00", "11:00"], ["11:00", "13:00"], ["14:00", "16:00"], ["16:00", "18:00"]];
    const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return candidates.filter(([start, end]) => !data.reservations.some((r) => String(r.deviceId) === String(deviceId) && isActive(r) && (r.dates || []).some((d) => dates.includes(d)) && minutes(start) < minutes(r.endTime) && minutes(end) > minutes(r.startTime)) && !dates.some((date) => hasMaintenance(deviceId, date))).map(([start, end]) => ({ start, end }));
  }
  function recommendDevices(excludedDeviceId, dates, startTime, endTime) {
    const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return context.devices.filter((device) => {
      const id = String(device.No ?? device.id ?? device.deviceId ?? "");
      const unavailable = device.available === false || device.isAvailable === false || /故障|维修|检修|停用|损坏|不可用/.test(String(device.status ?? device.Status ?? device.condition ?? ""));
      if (!id || id === String(excludedDeviceId) || unavailable || deviceBlocked(id) || dates.some((date) => hasMaintenance(id, date))) return false;
      return !data.reservations.some((r) => String(r.deviceId) === id && isActive(r) && (r.dates || []).some((d) => dates.includes(d)) && minutes(startTime) < minutes(r.endTime) && minutes(endTime) > minutes(r.startTime));
    }).slice(0, 3).map((device) => ({ id: String(device.No ?? device.id ?? device.deviceId), name: String(device.Name ?? device.name ?? device.deviceName ?? "设备") }));
  }
  function setContext(next) {
    context = { ...context, ...next };
    optionsFor("#issueDevice"); optionsFor("#maintenanceDevice"); renderAll();
    const admin = $("#adminService"); if (admin) admin.hidden = context.role !== "admin";
  }
  function addReservation(entry) {
    data.reservations.unshift({ ...entry, serverDates: (entry.dates || []).slice(), id: id(), status: "pending", createdAt: now(), handoff: {} });
    persist(); renderAll();
  }
  function submitIssue(event) {
    event.preventDefault();
    const deviceId = $("#issueDevice").value;
    if (!deviceId) { notify("请先选择设备"); return; }
    data.issues.unshift({ id: id(), deviceId, deviceName: deviceName(deviceId), account: context.account, type: $("#issueType").value, description: $("#issueDescription").value.trim(), status: "待处理", blocked: false, createdAt: now() });
    event.target.reset(); persist(); renderAll(); notify("问题已记入本机演示工作台");
  }
  function submitMaintenance(event) {
    event.preventDefault(); const deviceId = $("#maintenanceDevice").value;
    data.maintenance.unshift({ id: id(), deviceId, deviceName: deviceName(deviceId), date: $("#maintenanceDate").value, note: $("#maintenanceNote").value.trim(), account: context.account });
    event.target.reset(); persist(); renderAll(); notify("维护安排已加入本机日历；未同步课程服务端");
  }
  function submitNotice(event) {
    event.preventDefault();
    data.notices.unshift({ id: id(), category: $("#noticeCategory").value, title: $("#noticeTitle").value.trim(), body: $("#noticeBody").value.trim(), account: context.account, createdAt: now() });
    event.target.reset(); persist(); renderAll(); notify("公告已发布到本机演示页面");
  }
  function joinWaitlist() {
    const deviceId = context.selectedDeviceId || $("#issueDevice").value || $("#bookingDevice").value || "";
    if (!deviceId) { notify("请先选择设备"); return; }
    const date = context.selectedDate || "待定";
    const existing = data.waitlist.some((w) => w.account === context.account && w.deviceId === deviceId && w.date === date);
    if (existing) { notify("你已在这件设备的候补名单中"); return; }
    data.waitlist.unshift({ id: id(), account: context.account, deviceId, deviceName: deviceName(deviceId), date, createdAt: now() });
    persist(); notify("已加入本机候补名单；空档提醒仅在本浏览器演示中生效");
  }
  function bind() {
    $("#issueForm")?.addEventListener("submit", submitIssue);
    $("#maintenanceForm")?.addEventListener("submit", submitMaintenance);
    $("#noticeForm")?.addEventListener("submit", submitNotice);
    $("#joinWaitlist")?.addEventListener("click", joinWaitlist);
    $("#coordinationForm")?.addEventListener("submit", submitCoordination);
    $("#closeCoordination")?.addEventListener("click", () => $("#coordinationDialog").close());
    $$('[data-reservation-filter]').forEach((button) => button.addEventListener("click", () => { reservationFilter = button.dataset.reservationFilter; $$('[data-reservation-filter]').forEach((b) => b.classList.toggle("is-active", b === button)); renderReservations(); }));
  }
  function notify(message) { const toast = $("#toast"); if (!toast) return; toast.textContent = message; toast.classList.add("show"); clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove("show"), 3200); }
  bind();
  window.FeatureDesk = Object.freeze({ setContext, addReservation, checkConflict, alternatives, recommendDevices, deviceBlocked, render: renderAll });
})();
