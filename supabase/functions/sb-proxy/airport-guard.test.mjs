import assert from "node:assert/strict"
import test from "node:test"
import { airportSeeAll, forceOwnRows } from "./airport-guard.js"

const own = (p, id = "C00001") => new URLSearchParams(forceOwnRows(p, id).split("?")[1])

test("沒有任何 filter 時也會被限縮", () => {
  assert.equal(own("airport_bookings?select=*").getAll("emp_id").length, 1)
  assert.equal(own("airport_bookings?select=*").get("emp_id"), "eq.C00001")
})

/* 🔴 這條是重點：前端自己帶別人的工號時，必須被**換掉**而不是被 AND。
   AND 的結果是空清單 —— 安全，但看起來像系統壞了。 */
test("前端帶別人的 emp_id 會被換掉，不是被 AND", () => {
  const params = own("airport_bookings?select=*&emp_id=eq.C00099")
  assert.deepEqual(params.getAll("emp_id"), ["eq.C00001"])
})

test("多個偽造的 emp_id 也全部清掉", () => {
  const params = own("airport_bookings?emp_id=eq.A&emp_id=neq.B&select=*")
  assert.deepEqual(params.getAll("emp_id"), ["eq.C00001"])
})

test("其他 filter 一律保留（PostgREST 頂層參數彼此 AND，繞不過去）", () => {
  const params = own("airport_bookings?select=id,status&status=eq.已預約&order=created_at.desc&limit=50")
  assert.equal(params.get("status"), "eq.已預約")
  assert.equal(params.get("order"), "created_at.desc")
  assert.equal(params.get("limit"), "50")
  assert.equal(params.get("emp_id"), "eq.C00001")
})

test("or=(...) 也還是被 AND 在自己的範圍內", () => {
  const params = own("airport_bookings?or=(status.eq.已預約,status.eq.已完成)")
  assert.equal(params.get("emp_id"), "eq.C00001")
  assert.equal(params.get("or"), "(status.eq.已預約,status.eq.已完成)")
})

test("完全沒有查詢字串也不會壞", () => {
  assert.equal(forceOwnRows("airport_bookings", "C00001"), "airport_bookings?emp_id=eq.C00001")
})

test("admin 角色與行政部都看得到全部，其餘看不到", () => {
  assert.equal(airportSeeAll({ role: "admin", dept: "rd" }), true)
  assert.equal(airportSeeAll({ role: "user", dept: "admin" }), true)
  assert.equal(airportSeeAll({ role: "dcc", dept: "rd" }), false)
  assert.equal(airportSeeAll({ role: "user", dept: "sales" }), false)
  // 停用／離職者的 liveUserOf 會回空字串 —— 那不該變成「看得到全部」
  assert.equal(airportSeeAll({ role: "", dept: "" }), false)
  assert.equal(airportSeeAll({}), false)
  assert.equal(airportSeeAll(), false)
})
