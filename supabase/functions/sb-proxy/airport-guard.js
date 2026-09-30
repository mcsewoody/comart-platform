/* 機場接送預約的存取守衛。
   抽出來是因為 edge function 沒辦法在本機跑，而這幾個函式是「把同事的住家地址
   與手機從公開變成不公開」的那一層 —— 錯了不會有人看得出來（畫面照樣正常，
   只是多看得到別人的資料）。 */

export const AIRPORT_SEE_ALL_ROLES = new Set(["admin"])
/** 🔴 dept === 'admin' 是**行政部**，與 role === 'admin'（系統管理者）不同。 */
export const AIRPORT_SEE_ALL_DEPTS = new Set(["admin"])
export const AIRPORT_IMMUTABLE = new Set(["id", "emp_id", "created_at"])
export const AIRPORT_SERVER_OWNED = new Set(["emp_id", "cancelled_by", "sent_by"])

export function airportSeeAll(live = {}) {
  return AIRPORT_SEE_ALL_ROLES.has(live.role || "") || AIRPORT_SEE_ALL_DEPTS.has(live.dept || "")
}

/* 把「只能看自己的」硬寫進查詢字串。
   🔴 是**取代**不是附加：前端若自己帶了 emp_id=eq.<別人>，附加會變成兩個條件
      AND 起來（結果為空，安全但看起來像壞掉）。直接覆蓋掉最乾淨。
   其餘 filter 一律保留 —— PostgREST 的頂層參數彼此 AND，
   所以 `or=(...)` 之類的也繞不過這一條。 */
export function forceOwnRows(restPath, empId) {
  const [head, query = ""] = restPath.split(/\?(.*)/s)
  const params = new URLSearchParams(query)
  params.delete("emp_id")
  params.append("emp_id", `eq.${empId}`)
  return `${head}?${params.toString()}`
}
