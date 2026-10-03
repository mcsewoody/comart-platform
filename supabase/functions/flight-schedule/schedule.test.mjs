import test from "node:test";
import assert from "node:assert/strict";
import { pickSchedule, weekdayOf, hhmm } from "./schedule.js";

const wk = (days) => Object.fromEntries(
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => [d, days.includes(d)]),
);
// CI601 換季：10/24 以前 07:25，10/25 起 07:15（形狀照 TDX GeneralFlightSchedule）
const CI601 = [
  { AirlineID: "CI", FlightNumber: "CI601", DepartureAirportID: "TPE", ArrivalAirportID: "HKG",
    DepartureTime: "07:25", ArrivalTime: "09:15", Terminal: "1",
    ScheduleStartDate: "2026-03-29", ScheduleEndDate: "2026-10-24", ...wk(["Monday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) },
  { AirlineID: "CI", FlightNumber: "CI601", DepartureAirportID: "TPE", ArrivalAirportID: "HKG",
    DepartureTime: "07:15:00", ArrivalTime: "09:15:00", Terminal: "1",
    ScheduleStartDate: "2026-10-25T00:00:00+08:00", ScheduleEndDate: "2027-03-27", ...wk(["Monday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) },
];

test("星期從年月日直接算（2026-10-11 是週日）", () => {
  assert.equal(weekdayOf("2026-10-11"), "Sunday");
  assert.equal(weekdayOf("2026-10-13"), "Tuesday");
  assert.equal(weekdayOf("bad"), "");
});

test("時間正規化", () => {
  assert.equal(hhmm("07:15:00"), "07:15");
  assert.equal(hhmm("7:05"), "07:05");
  assert.equal(hhmm(""), "");
});

test("依那一天挑出正確的班季", () => {
  assert.equal(pickSchedule(CI601, "CI601", "2026-10-11").matches[0].depTime, "07:25");
  assert.equal(pickSchedule(CI601, "ci 601", "2026-10-25").matches[0].depTime, "07:15");
});

test("那一天沒飛就不回，但說得出有效期", () => {
  const r = pickSchedule(CI601, "CI601", "2026-10-13"); // 週二停飛
  assert.equal(r.matches.length, 0);
  assert.equal(r.known, true);
  assert.ok(r.periods.length === 2);
});

test("共掛的重複資料只留一筆", () => {
  const dup = [CI601[0], { ...CI601[0] }];
  assert.equal(pickSchedule(dup, "CI601", "2026-10-11").matches.length, 1);
});

test("查無此班號", () => {
  const r = pickSchedule(CI601, "BR189", "2026-10-11");
  assert.equal(r.known, false);
  assert.equal(r.matches.length, 0);
});

test("航廈只留數字、飛航日照週一到週日排", () => {
  const m = pickSchedule(CI601, "CI601", "2026-10-11").matches[0];
  assert.equal(m.terminal, "1");
  assert.equal(m.opDays, "一三四五六日");
});

test("超出已公布範圍：covered=false，不可當成「那天不飛」", () => {
  const onlyAutumn = [CI601[0]]; // 只到 10/24
  const r = pickSchedule(onlyAutumn, "CI601", "2026-10-25");
  assert.equal(r.matches.length, 0);
  assert.equal(r.covered, false);
  assert.equal(r.coveredTo, "2026-10-24");
  // 範圍內但當天停飛（週二）才是真的不飛
  const tue = pickSchedule(onlyAutumn, "CI601", "2026-10-13");
  assert.equal(tue.covered, true);
  assert.equal(tue.matches.length, 0);
});
