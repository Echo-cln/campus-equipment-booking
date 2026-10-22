/* Production data adapter. All writes require an authenticated session and pass
   through Supabase RLS; the browser never receives a privileged server key. */
(function () {
  "use strict";
  const iso = (date, time) => new Date(date + "T" + time + ":00").toISOString();
  const startOf = (year, month) => new Date(Number(year), Number(month) - 1, 1).toISOString();
  const endOf = (year, month) => new Date(Number(year), Number(month), 1).toISOString();
  const unwrapItems = (value) => Array.isArray(value) ? value : [];
  const datesInRange = (start, end) => { const out=[]; const d=new Date(start+"T00:00:00"); const last=new Date(end+"T00:00:00"); while(d<=last){out.push([d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"));d.setDate(d.getDate()+1);} return out; };
  async function equipment() {
    return window.AuthService.rest("equipment", { query: { select: "device_no,name,use_count,category,description,location,model,open_hours,max_duration_minutes,status,status_note,updated_at", order: "device_no.asc" } });
  }
  const deviceMap = (row) => ({ No: row.device_no, Name: row.name, UseCount: row.use_count, category: row.category, description: row.description, location: row.location, model: row.model, availableTime: row.open_hours, duration: row.max_duration_minutes ? Math.floor(row.max_duration_minutes/60)+" 小时" : null, maxDurationMinutes: row.max_duration_minutes, condition: row.status_note || ({ available: "可预约", maintenance: "维护中", disabled: "已停用", unknown: "" })[row.status], status: row.status, available: row.status === "unknown" ? null : row.status === "available" });
  async function slots(from, to) { return unwrapItems(await window.AuthService.rest("rpc/reservation_slots", { method: "POST", body: { p_from: from, p_to: to } })); }
  const service = {
    get online() { return window.AuthService?.configured === true; },
    get lastError() { return ""; },
    cloud: true,
    routes: {},
    async checkHealth() { await equipment(); return { data: true, stale: false }; },
    async getDevices() { const rows = await equipment(); return { data: { items: rows.map(deviceMap), total: rows.length }, stale: false }; },
    async getDeviceNos() { const rows = await equipment(); return { data: rows.map((x) => x.device_no), stale: false }; },
    async getCalendar({ year, month, deviceId }) {
      const rows = await slots(startOf(year, month), endOf(year, month));
      return { data: rows.filter((x) => String(x.device_no) === String(deviceId)).map((x) => ({ ...x, No: x.device_no, date: x.starts_at.slice(0,10), booked: true, mine: x.is_mine, reservationId: x.reservation_id })), stale: false };
    },
    async getDailyUsage({ date, status, page = 1, pageSize = 5 }) {
      const from = new Date(date + "T00:00:00").toISOString(); const to = new Date(date + "T23:59:59.999").toISOString();
      const [bookings, devices] = await Promise.all([slots(from, to), equipment()]);
      const mapped = devices.map(deviceMap);
      let rows = status === "idle" ? mapped.filter((d) => !bookings.some((r) => r.device_no === d.No)).map((d) => ({ ...d, date, UseDate: date, isNoRegistration: true, statusText: d.status === "maintenance" ? "维护中" : d.status === "disabled" ? "已停用" : "暂无预约" })) : bookings.map((r) => {
        const d = mapped.find((x) => x.No === r.device_no) || { No:r.device_no, Name:r.device_no };
        return { ...d, date: r.starts_at.slice(0,10), UseDate: r.starts_at.slice(0,10), startTime: new Date(r.starts_at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false}), endTime: new Date(r.ends_at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false}), duration: Math.round((new Date(r.ends_at)-new Date(r.starts_at))/3600000*10)/10+" 小时", statusText: r.status === "confirmed" ? "已确认" : "待管理员确认", userName:r.owner_name, reservationId:r.reservation_id, reservationStatus:r.status, allowCoordination:r.allow_coordination, isMine:r.is_mine };
      });
      const offset = (Math.max(1,Number(page)||1)-1)*Number(pageSize||5);
      return { data: { items: rows.slice(offset,offset+Number(pageSize||5)), total: rows.length }, stale: false };
    },
    async getDeviceHistory(id, { page = 1, pageSize = 5 } = {}) {
      const rows = await window.AuthService.rest("reservations", { query: { select: "id,device_no,starts_at,ends_at,purpose,status,created_at", device_no:"eq."+id, order:"starts_at.desc" } });
      const mapped = rows.map((r)=>({ ...r, No:r.device_no, Name:r.device_no, UseDate:r.starts_at.slice(0,10), date:r.starts_at.slice(0,10), startTime:new Date(r.starts_at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false}), endTime:new Date(r.ends_at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false}), registration:r.created_at }));
      const offset=(Math.max(1,Number(page)||1)-1)*Number(pageSize||5);
      return { data:{items:mapped.slice(offset,offset+pageSize),total:mapped.length},stale:false };
    },
    async getStatistics({ deviceIds }) { const rows = await equipment(); return { data: rows.filter((r)=>deviceIds.includes(r.device_no)).map((r)=>({No:r.device_no,Name:r.name,UseCount:r.use_count})),stale:false }; },
    async getRangeStatistics({ deviceIds, start, end }) {
      if (!start || !end || start > end) throw new Error("请填写有效的统计日期范围。");
      const until = new Date(end + "T00:00:00"); until.setDate(until.getDate()+1);
      const counts = await window.AuthService.rest("rpc/reservation_counts", { method:"POST", body:{ p_from:new Date(start+"T00:00:00").toISOString(), p_to:until.toISOString() } });
      return { data:{items:deviceIds.map((id)=>({No:id,UseCount:(counts||[]).find((row)=>row.device_no===id)?.reservation_count||0}))},stale:false };
    },
    async createReservation({ deviceId, dates, startTime, endTime, purpose, allowCoordination = true }) {
      const identity = await window.AuthService.getIdentity();
      if (!identity) throw new Error("登录状态已失效，请重新登录。");
      const rows = datesInRange(dates[0], dates[dates.length - 1]).filter((d) => dates.includes(d)).map((date) => ({ owner_id:identity.id, device_no:deviceId, starts_at:iso(date,startTime), ends_at:iso(date,endTime), purpose, status:"pending", allow_coordination:allowCoordination }));
      let data;
      try { data = await window.AuthService.rest("reservations", { method:"POST", body:rows, prefer:"return=representation" }); }
      catch (error) {
        const detail = String(error.message || "").toLowerCase();
        if (error.status === 409 || error.code === "23P01" || detail.includes("exclusion constraint")) throw new Error("该设备在此时段已有预约，请换一个时段后重试。");
        if (detail.includes("maintenance")) throw new Error("该设备在所选时段安排了维护，请更换日期或时间。");
        if (detail.includes("duration")) throw new Error("预约时长超过设备允许范围，请缩短时段。");
        if (detail.includes("future")) throw new Error("预约开始时间必须晚于当前时间。");
        throw error;
      }
      return { data:{items:data,message:"预约已写入云端。"},stale:false };
    },
    formatDate(value) { return String(value||"").slice(0,10); },
    formatDateTime(value) { return new Date(value).toLocaleString("zh-CN",{hour12:false}); },
    async importCourseDevices(devices) {
      const rows = devices.map((d)=>({ device_no:String(d.No), name:String(d.Name), use_count:Number(d.UseCount)||0 }));
      return window.AuthService.rest("equipment",{method:"POST",query:{on_conflict:"device_no"},body:rows,prefer:"resolution=merge-duplicates,return=representation"});
    }
  };
  window.CloudService = Object.freeze(service);
})();
