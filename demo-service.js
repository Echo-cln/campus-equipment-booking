/* Complete local data adapter for walkthroughs when the course service is unavailable. */
(function () {
  "use strict";
  const today = new Date();
  const dateKey = (offset) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  };
  const devices = [
    { No: "CAM-01", Name: "微单相机", category: "影像设备", UseCount: 38, available: true, condition: "状态良好", description: "适合课程拍摄与校园活动记录。", location: "创作工坊 · A203", model: "LUMIX G100", availableTime: "09:00—18:00", duration: "单次最多 4 小时" },
    { No: "CAM-02", Name: "便携摄像机", category: "影像设备", UseCount: 24, available: true, condition: "状态良好", description: "轻便机身，适合采访与短片拍摄。", location: "创作工坊 · A203", model: "Handycam", availableTime: "09:00—18:00", duration: "单次最多 4 小时" },
    { No: "MIC-01", Name: "无线麦克风套装", category: "音频设备", UseCount: 31, available: true, condition: "状态良好", description: "含发射器、接收器和领夹麦克风。", location: "创作工坊 · A203", model: "双通道无线套装", availableTime: "09:00—18:00", duration: "单次最多 4 小时" },
    { No: "TOOL-01", Name: "精密工具箱", category: "制作工具", UseCount: 17, available: true, condition: "管理员检查中", description: "适用于模型与电子制作，请按清单归还配件。", location: "创客空间 · B105", model: "基础精密工具组", availableTime: "10:00—17:00", duration: "单次最多 3 小时" },
    { No: "PROJ-01", Name: "便携投影仪", category: "展示设备", UseCount: 29, available: true, condition: "状态良好", description: "含电源线、HDMI 线和遥控器。", location: "共享设备室 · C108", model: "短焦 LED", availableTime: "09:00—18:00", duration: "单次最多 4 小时" },
    { No: "PRINT-01", Name: "照片打印机", category: "打印设备", UseCount: 12, available: true, condition: "状态良好", description: "支持活动照片与作品小样打印。", location: "创作工坊 · A203", model: "热升华照片打印机", availableTime: "09:00—17:00", duration: "单次最多 2 小时" }
  ];
  const reservations = () => {
    try { return (JSON.parse(localStorage.getItem("wu-jin-qi-yong:workflow:v1") || "{}").reservations || []); }
    catch { return []; }
  };
  const active = (r) => !["completed", "cancelled", "withdrawn"].includes(r.status);
  const overlaps = (a, b) => a.startTime < b.endTime && a.endTime > b.startTime;
  const service = {
    online: true,
    lastError: "",
    demo: true,
    getDevices: async () => ({ data: { items: devices.map((d) => ({ ...d })) }, stale: false }),
    getDeviceNos: async () => ({ data: devices.map((d) => d.No), stale: false }),
    getCalendar: async ({ year, month, deviceId }) => ({ data: reservations().filter((r) => String(r.deviceId) === String(deviceId) && active(r)).flatMap((r) => (r.dates || []).filter((date) => date.startsWith(String(year) + "-" + String(month).padStart(2, "0") + "-")).map((date) => ({ date, booked: true, mine: false, startTime: r.startTime, endTime: r.endTime, account: r.account }))), stale: false }),
    getDailyUsage: async ({ date, status, page = 1, pageSize = 5 }) => {
      const booked = reservations().filter((r) => active(r) && (r.dates || []).includes(date));
      const rows = status === "idle"
        ? devices.filter((d) => !booked.some((r) => String(r.deviceId) === d.No)).map((d) => ({ ...d, UseDate: date, isNoRegistration: true, condition: d.condition, status: "暂无登记" }))
        : booked.map((r) => ({ No: r.deviceId, Name: r.deviceName || devices.find((d) => d.No === String(r.deviceId))?.Name || r.deviceId, UseDate: date, startTime: r.startTime, endTime: r.endTime, duration: ((Number(r.endTime.slice(0, 2)) * 60 + Number(r.endTime.slice(3, 5)) - Number(r.startTime.slice(0, 2)) * 60 - Number(r.startTime.slice(3, 5))) / 60) + " 小时", userName: r.account, purpose: r.purpose, status: r.status === "confirmed" ? "已确认" : "待确认", condition: "预约中" }));
      const start = (Math.max(1, Number(page) || 1) - 1) * Number(pageSize || 5);
      return { data: { items: rows.slice(start, start + Number(pageSize || 5)), total: rows.length }, stale: false };
    },
    getDeviceHistory: async (id, opts = {}) => {
      const rows = reservations().filter((r) => String(r.deviceId) === String(id)).flatMap((r) => (r.dates || []).map((date) => ({ No: id, Name: r.deviceName || id, UseDate: date, startTime: r.startTime, endTime: r.endTime, userName: r.account, status: r.status, purpose: r.purpose })));
      const page = Number(opts.page || 1), size = Number(opts.pageSize || 5), start = (page - 1) * size;
      return { data: { items: rows.slice(start, start + size), total: rows.length }, stale: false };
    },
    getStatistics: async ({ deviceIds }) => ({ data: devices.filter((d) => deviceIds.includes(String(d.No))).map(({ No, Name, UseCount }) => ({ No, Name, UseCount })), stale: false }),
    getRangeStatistics: async ({ deviceIds, start, end }) => {
      if (!start || !end || start > end) throw new Error("请填写有效的统计日期范围。");
      const rows = devices.filter((d) => deviceIds.includes(String(d.No))).map((d) => ({ No: d.No, UseCount: reservations().filter((r) => String(r.deviceId) === d.No && active(r) && (r.dates || []).some((date) => date >= start && date <= end)).length }));
      return { data: { items: rows }, stale: false };
    },
    createReservation: async ({ deviceId, dates, startTime, endTime }) => {
      const busy = reservations().find((r) => String(r.deviceId) === String(deviceId) && active(r) && (r.dates || []).some((date) => dates.includes(date)) && overlaps({ startTime, endTime }, r));
      if (busy) { const error = new Error("此时段与 " + busy.account + " 的预约冲突，请改选时段。"); error.status = 409; throw error; }
      return { data: { message: "本机演示预约已记录。" }, stale: false };
    },
    dateKey
  };
  window.DemoService = Object.freeze(service);
})();
