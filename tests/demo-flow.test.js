const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const store = new Map();
const localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
const nodes = new Map();
function element(selector) {
  if (!nodes.has(selector)) {
    const listeners = {};
    nodes.set(selector, {
      value: "", innerHTML: "", textContent: "", dataset: {}, hidden: false, className: "",
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
      dispatch: (type, event) => (listeners[type] || []).forEach((fn) => fn(event)),
      reset() {}, showModal() {}, close() {}
    });
  }
  return nodes.get(selector);
}
const document = { querySelector: element, querySelectorAll: () => [] };
const window = { dispatchEvent() {} };
const context = { window, document, localStorage, Date, Math, Map, Set, String, Number, Array, Object, JSON, CustomEvent: function () {}, setTimeout: () => 1, clearTimeout() {}, console };
vm.createContext(context);
const root = path.join(__dirname, "..");
for (const file of ["demo-service.js", "workflow.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });

const desk = window.FeatureDesk;
const service = window.DemoService;
const devices = service.getDevices();
const date = (offset) => service.dateKey(offset);

(async () => {
  const catalog = (await devices).data.items;
  assert.equal(catalog.length, 6, "demo catalog loads without a server");
  desk.setContext({ role: "user", account: "student", devices: catalog, selectedDate: date(1), selectedDeviceId: "CAM-01" });
  desk.seedDemoData(catalog);

  const collision = desk.checkConflict("CAM-01", [date(1)], "09:00", "11:00");
  assert.equal(collision.ok, false, "seeded reservation blocks the occupied time");
  assert.match(collision.message, /冲突/);
  assert(desk.alternatives("CAM-01", [date(1)]).some((slot) => slot.start === "11:00" && slot.end === "13:00"), "free time is suggested");
  await assert.rejects(service.createReservation({ deviceId: "CAM-01", dates: [date(1)], startTime: "09:00", endTime: "11:00" }), /预约冲突/);

  await service.createReservation({ deviceId: "CAM-01", dates: [date(1)], startTime: "11:00", endTime: "13:00" });
  desk.addReservation({ deviceId: "CAM-01", deviceName: "微单相机", dates: [date(1)], startTime: "11:00", endTime: "13:00", purpose: "采访补拍", account: "student" });
  const daily = await service.getDailyUsage({ date: date(1), status: "used", page: 1, pageSize: 10 });
  assert.equal(daily.data.total, 2, "two non-overlapping bookings appear in the daily register");

  assert.match(desk.checkConflict("PROJ-01", [date(3)], "09:00", "10:00").message, /维护/);
  desk.setIssueState("sample-tool-issue", "处理中");
  desk.toggleIssueBlock("sample-tool-issue");
  assert.equal(desk.deviceBlocked("TOOL-01"), true, "admin pause blocks a faulty device");
  desk.setIssueState("sample-tool-issue", "已解决");
  assert.equal(desk.deviceBlocked("TOOL-01"), false, "resolved issue resumes the device");

  desk.coordinate("sample-admin-camera");
  element("#coordinationDate").value = date(1);
  element("#coordinationStart").value = "13:00";
  element("#coordinationEnd").value = "15:00";
  element("#coordinationNote").value = "我可以晚些使用";
  element("#coordinationForm").dispatch("submit", { preventDefault() {}, target: { reset() {} } });
  const pending = JSON.parse(localStorage.getItem("wu-jin-qi-yong:workflow:v1"));
  const request = pending.coordination.find((message) => message.from === "student" && message.reservationId === "sample-admin-camera");
  assert(request, "user can send a request to an open reservation");
  desk.setContext({ role: "admin", account: "admin", devices: catalog });
  desk.answerCoordination(request.id, "accept");
  let final = JSON.parse(localStorage.getItem("wu-jin-qi-yong:workflow:v1"));
  const adminBooking = final.reservations.find((reservation) => reservation.id === "sample-admin-camera");
  assert.deepEqual(Array.from(adminBooking.dates), [date(1)]);
  assert.equal(adminBooking.startTime, "13:00", "accepted request updates the reservation time");
  assert.equal(final.coordination.find((message) => message.id === request.id).status, "accepted");

  desk.setContext({ role: "admin", account: "admin", devices: catalog });
  [0, 1, 2].forEach((check) => desk.updateHandoff("sample-admin-camera", check, true));
  desk.updateCondition("sample-admin-camera", "外观、配件与功能均正常");
  desk.completeReservation("sample-admin-camera");
  final = JSON.parse(localStorage.getItem("wu-jin-qi-yong:workflow:v1"));
  assert.equal(final.reservations.find((reservation) => reservation.id === "sample-admin-camera").status, "completed");
  assert.equal(final.waitlist.find((entry) => entry.id === "sample-camera-waitlist").status, "有空档待确认");
  console.log("Demo end-to-end flow passed: catalog → conflict → alternate slot → report → maintenance → coordination → handoff → waitlist.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
