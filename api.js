/* All service calls are kept here so the page never invents records locally.
   Endpoint and response mappings should follow the course mock-server manual. */
(function () {
  const config = window.SITE_CONFIG || {};
  const baseUrl = String(config.apiBaseUrl || "").replace(/\/+$/, "");
  const timeoutMs = Number(config.requestTimeoutMs) || 8000;
  const cachePrefix = "wu-jin-qi-yong:cache:";
  let online = false;
  let lastError = "";

  const routes = {
    health: "/health",
    devices: "/api/devices",
    calendar: "/api/calendar",
    dailyUsage: "/api/usage",
    history: (id) => "/api/devices/" + encodeURIComponent(id) + "/history",
    statistics: "/api/admin/statistics",
    reservation: "/api/reservations"
  };

  function cacheKey(path) { return cachePrefix + path; }
  function getCache(path) {
    try {
      const value = localStorage.getItem(cacheKey(path));
      return value ? JSON.parse(value) : null;
    } catch { return null; }
  }
  function setCache(path, data) {
    try { localStorage.setItem(cacheKey(path), JSON.stringify({ data, savedAt: Date.now() })); }
    catch { /* Storage may be unavailable or full. The online request still succeeds. */ }
  }
  function buildUrl(path, params) {
    const url = new URL(baseUrl + path, window.location.href);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
      }
    });
    return url.toString();
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const method = options.method || "GET";
    const query = new URLSearchParams(options.params || {}).toString();
    const key = path + query;
    try {
      const response = await fetch(buildUrl(path, options.params), {
        method,
        headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        cache: "no-store"
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error("服务端返回的内容不是有效 JSON"); }
      if (!response.ok) {
        const error = new Error(data.message || data.error || "请求失败（" + response.status + "）");
        error.status = response.status;
        error.payload = data;
        throw error;
      }
      online = true;
      lastError = "";
      if (method === "GET") setCache(key, data);
      return { data, stale: false };
    } catch (error) {
      if (error.status) {
        // A conflict or validation response still means the service is reachable.
        online = true;
        lastError = error.message;
        throw error;
      }
      if (method === "GET") {
        const cached = getCache(key);
        if (cached) {
          online = false;
          lastError = error.message;
          return { data: cached.data, stale: true, savedAt: cached.savedAt };
        }
      }
      online = false;
      lastError = error.message || "无法连接服务端";
      throw error;
    } finally { window.clearTimeout(timer); }
  }

  window.Service = Object.freeze({
    get online() { return online; },
    get lastError() { return lastError; },
    routes,
    checkHealth: () => request(routes.health),
    getDevices: (params) => request(routes.devices, { params }),
    getCalendar: (params) => request(routes.calendar, { params }),
    getDailyUsage: (params) => request(routes.dailyUsage, { params }),
    getDeviceHistory: (id, params) => request(routes.history(id), { params }),
    getStatistics: (params) => request(routes.statistics, { params }),
    createReservation: (body) => request(routes.reservation, { method: "POST", body })
  });
})();
