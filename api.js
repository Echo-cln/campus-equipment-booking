/* Adapter for the course-provided WCF mock service (127.0.0.1:12345).
   The application keeps business records on the server; localStorage is read-only cache. */
(function () {
  const config = window.SITE_CONFIG || {};
  const baseUrl = String(config.apiBaseUrl || "http://127.0.0.1:12345").replace(/\/+$/, "");
  const timeoutMs = Number(config.requestTimeoutMs) || 8000;
  const cachePrefix = "wu-jin-qi-yong:cache:";
  let online = false;
  let lastError = "";
  const routes = Object.freeze({
    devices: "/getDevices", deviceNos: "/getDeviceNo", recordsByNo: "/getRecordByNo",
    recordsByDate: "/getRecordByDate", reservation: "/regDevice"
  });
  function cacheKey(url) { return cachePrefix + url; }
  function getCache(key) {
    try { const v = localStorage.getItem(cacheKey(key)); return v ? JSON.parse(v) : null; }
    catch { return null; }
  }
  function setCache(key, data) {
    try { localStorage.setItem(cacheKey(key), JSON.stringify({ data, savedAt: Date.now() })); }
    catch { /* Storage is optional; successful server response remains usable. */ }
  }
  function parseBody(text, contentType) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (/json/i.test(contentType) || /^[\[{"\d-]/.test(trimmed) || /^(true|false|null)$/i.test(trimmed)) {
      try { return JSON.parse(trimmed); } catch { /* XML is also returned by getDeviceNo. */ }
    }
    if (trimmed.startsWith("<")) {
      const xml = new DOMParser().parseFromString(trimmed, "application/xml");
      if (xml.querySelector("parsererror")) throw new Error("服务端返回了无法解析的 XML");
      const strings = Array.from(xml.getElementsByTagNameNS("*", "string")).map((x) => x.textContent || "");
      return strings.length ? strings : trimmed;
    }
    return trimmed;
  }
  function dateParam(value) {
    if (!value) return "";
    const parts = String(value).slice(0, 10).split("-");
    return parts.length === 3 ? Number(parts[0]) + "-" + Number(parts[1]) + "-" + Number(parts[2]) : String(value);
  }
  function dotNetDate(value) {
    const match = String(value || "").match(/\/Date\((-?\d+)([+-])(\d{2})(\d{2})?\)\//);
    if (!match) return null;
    const offset = (Number(match[3]) * 60 + Number(match[4] || 0)) * (match[2] === "+" ? 1 : -1);
    return new Date(Number(match[1]) + offset * 60000);
  }
  function formatDate(value) {
    const dotNet = dotNetDate(value);
    const d = dotNet || new Date(value);
    if (Number.isNaN(d.getTime())) return String(value || "").slice(0, 10);
    const y = dotNet ? d.getUTCFullYear() : d.getFullYear();
    const m = dotNet ? d.getUTCMonth() + 1 : d.getMonth() + 1;
    const day = dotNet ? d.getUTCDate() : d.getDate();
    return y + "-" + String(m).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }
  async function request(path, params = {}, cache = true) {
    const url = new URL(baseUrl + path);
    Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value)); });
    const key = url.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(key, { headers: { Accept: "application/json, application/xml, text/xml" }, signal: controller.signal, cache: "no-store" });
      const raw = await response.text();
      const data = parseBody(raw, response.headers.get("content-type") || "");
      if (!response.ok) {
        const error = new Error(typeof data === "string" ? data : "请求失败（" + response.status + "）");
        error.status = response.status; error.payload = data; throw error;
      }
      online = true; lastError = "";
      if (cache) setCache(key, data);
      return { data, stale: false };
    } catch (error) {
      if (error.status) { online = true; lastError = error.message; throw error; }
      const cached = getCache(key);
      if (cached) { online = false; lastError = error.message; return { data: cached.data, stale: true, savedAt: cached.savedAt }; }
      online = false; lastError = error.message || "无法连接课程模拟服务端"; throw error;
    } finally { clearTimeout(timer); }
  }
  const asList = (value) => {
    if (Array.isArray(value)) return value;
    for (const key of ["items", "records", "list", "rows", "results"]) {
      if (value && Array.isArray(value[key])) return value[key];
    }
    return [];
  };
  const getDevices = async () => request(routes.devices, { page: 1, pageSize: 10000 });
  const getDeviceNos = async () => {
    const result = await request(routes.deviceNos);
    return { ...result, data: asList(result.data).map(String) };
  };
  const getCalendar = async ({ year, month, deviceId }) => request(routes.recordsByNo, {
    no: deviceId, start: year + "-" + month + "-1", end: year + "-" + month + "-" + new Date(Number(year), Number(month), 0).getDate()
  }).then((r) => ({ ...r, data: asList(r.data).map((x) => ({ ...x, date: formatDate(x.UseDate), booked: true })) }));
  const getDailyUsage = async ({ date, status, page, pageSize }) => {
    const [recordsResult, nosResult, devicesResult] = await Promise.all([
      request(routes.recordsByDate, { date: dateParam(date), page: 1, pageSize: 10000 }), getDeviceNos(), getDevices()
    ]);
    const records = asList(recordsResult.data);
    const nos = nosResult.data;
    const devices = asList(devicesResult.data);
    const deviceMap = new Map(devices.map((d) => [String(d.No), d]));
    const used = new Set(records.map((r) => String(r.No)));
    let rows = status === "idle" ? nos.filter((no) => !used.has(no)).map((No) => ({ No, UseDate: date })) : records;
    rows = rows.map((r) => ({ ...r, deviceName: (deviceMap.get(String(r.No)) || {}).Name || String(r.No), deviceCode: r.No, date: formatDate(r.UseDate), registration: formatDateTime(r.RegTime) }));
    const start = (Math.max(1, Number(page) || 1) - 1) * (Number(pageSize) || 5);
    return { data: { items: rows.slice(start, start + (Number(pageSize) || 5)), total: rows.length }, stale: recordsResult.stale || nosResult.stale || devicesResult.stale };
  };
  const formatDateTime = (value) => {
    const d = dotNetDate(value);
    if (!d) return String(value || "");
    return formatDate(value) + " " + String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  };
  const getDeviceHistory = async (id, { page = 1, pageSize = 5 } = {}) => request(routes.recordsByNo, { no: id, start: "2000-1-1", end: "2100-12-31" }).then((r) => {
    const rows = asList(r.data).map((x) => ({ ...x, deviceName: String(x.No), deviceCode: x.No, useDate: formatDate(x.UseDate), registration: formatDateTime(x.RegTime) }));
    rows.sort((a, b) => String(b.RegTime).localeCompare(String(a.RegTime)));
    const start = (Math.max(1, Number(page) || 1) - 1) * (Number(pageSize) || 5);
    return { ...r, data: { items: rows.slice(start, start + (Number(pageSize) || 5)), total: rows.length } };
  });
  const getStatistics = async ({ deviceIds }) => getDevices().then((r) => ({
    ...r, data: asList(r.data).filter((d) => deviceIds.includes(String(d.No))).map((d) => ({ No: d.No, Name: d.Name, UseCount: d.UseCount }))
  }));
  const getRangeStatistics = async ({ deviceIds, start, end }) => {
    if (!start || !end || start > end) throw new Error("请填写有效的统计日期范围。");
    const results = await Promise.all(deviceIds.map(async (id) => {
      const response = await request(routes.recordsByNo, { no: id, start: dateParam(start), end: dateParam(end) });
      const records = asList(response.data).filter((record) => {
        const rawDate = String(record.UseDate || record.useDate || record.date || "");
        const parts = rawDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        const date = parts
          ? parts[1] + "-" + String(parts[2]).padStart(2, "0") + "-" + String(parts[3]).padStart(2, "0")
          : formatDate(rawDate);
        return date >= start && date <= end;
      });
      return { No: String(id), UseCount: records.length, stale: response.stale };
    }));
    return { data: { items: results.map(({ stale, ...row }) => row) }, stale: results.some((row) => row.stale) };
  };
  async function createReservation({ deviceId, dates }) {
    const result = await request(routes.reservation, { No: deviceId, UseDates: dates.map(dateParam).join(",") }, false);
    const conflicts = asList(result.data);
    if (conflicts.length) {
      const error = new Error("以下日期发生冲突：" + conflicts.map(formatDate).join("、"));
      error.status = 409; error.payload = conflicts; throw error;
    }
    return result;
  }
  window.Service = Object.freeze({
    get online() { return online; }, get lastError() { return lastError; }, routes,
    checkHealth: () => getDevices(), getDevices, getDeviceNos, getCalendar, getDailyUsage,
    getDeviceHistory, getStatistics, getRangeStatistics, createReservation, formatDate, formatDateTime
  });
})();
