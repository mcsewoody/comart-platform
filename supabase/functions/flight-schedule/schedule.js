// 從 TDX「定期航班時刻表」挑出某一天真的有飛的那一筆。
// 抽成純 JS 是為了能用 `node --test` 測：edge function 在本機跑不起來
// （要有效的 x-session），而這一段錯了的症狀是「時間差幾分鐘」—— 沒有人會回報。
//
// TDX 的一個航班會有很多筆：每一筆是一段有效期間（ScheduleStartDate～EndDate）
// ＋ 一週哪幾天飛（Monday…Sunday）。換季時同一班機的時間會變
// （例：CI601 10/24 以前 07:25、10/25 起 07:15），所以一定要依「那一天」挑，
// 不能拿第一筆就用。

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WD_ZH = { Monday: "一", Tuesday: "二", Wednesday: "三", Thursday: "四", Friday: "五", Saturday: "六", Sunday: "日" };

// 🔴 星期要從年月日直接算，不能 new Date('YYYY-MM-DD') 再 getDay()：
//    那個值是 UTC 午夜，換到 UTC-x 的時區會變成前一天（CLAUDE.md 記過一次）。
export function weekdayOf(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return "";
  return WD[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
}

// "07:25"、"07:25:00"、"7:25" → "07:25"；取不到回 ""
export function hhmm(t) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(t || ""));
  return m ? m[1].padStart(2, "0") + ":" + m[2] : "";
}

const day = (s) => String(s || "").slice(0, 10);

export function normFlight(no) {
  return String(no || "").trim().toUpperCase().replace(/\s+/g, "");
}

// 回傳 { matches: [...當天有飛的航段], periods: [...所有有效期，給「那天沒飛」的說明用] }
export function pickSchedule(records, flight, date) {
  const no = normFlight(flight);
  const wd = weekdayOf(date);
  const rows = (Array.isArray(records) ? records : []).filter((r) => normFlight(r.FlightNumber) === no);
  const matches = [];
  const seen = new Set();
  for (const r of rows) {
    const from = day(r.ScheduleStartDate), to = day(r.ScheduleEndDate);
    if (from && date < from) continue;
    if (to && date > to) continue;
    if (wd && r[wd] === false) continue;
    const leg = {
      flight: no,
      airline: String(r.AirlineID || ""),
      from: String(r.DepartureAirportID || "").toUpperCase(),
      to: String(r.ArrivalAirportID || "").toUpperCase(),
      depTime: hhmm(r.DepartureTime),
      arrTime: hhmm(r.ArrivalTime),
      terminal: String(r.Terminal || "").replace(/\D/g, ""),
      period: from || to ? `${from || "…"} ～ ${to || "…"}` : "",
      opDays: WD.slice(1).concat("Sunday").filter((d) => r[d] === true).map((d) => WD_ZH[d]).join(""),
      updated: String(r.UpdateTime || ""),
    };
    // 🔴 共掛（CodeShare）會讓同一段航程出現好幾筆一模一樣的資料
    const key = [leg.from, leg.to, leg.depTime, leg.arrTime].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(leg);
  }
  const periods = [...new Set(rows.map((r) => `${day(r.ScheduleStartDate)} ～ ${day(r.ScheduleEndDate)}`))];
  return { matches, periods, known: rows.length > 0 };
}
