/* 啟動 AI 分析的參數驗證。
   抽出來是因為 edge function 沒辦法在本機跑（要有效的 x-session HMAC），
   而這裡新加了 max_batches —— 一個送錯就會讓整個 GitHub job 失敗的欄位
   （workflow 自己會檢查 1–20，不合就 exit 1）。 */

export const DATASETS = ["mfg", "buy", "both"]
export const LIMIT_MIN = 1
export const LIMIT_MAX = 50
/** workflow 的 `max_batches` 自己就檢查 1–20，這裡要跟它一致。 */
export const BATCHES_MIN = 1
export const BATCHES_MAX = 20

export function parseAnalysisRequest(body = {}) {
  const dataset = String(body.dataset ?? "")
  const limit = Number(body.limit)
  // 沒帶就是 1（＝改動之前的行為），不是「不限」
  const maxBatches = body.maxBatches === undefined ? BATCHES_MIN : Number(body.maxBatches)

  if (!DATASETS.includes(dataset)) return { ok: false, error: "invalid_analysis_request" }
  if (!Number.isInteger(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
    return { ok: false, error: "invalid_analysis_request" }
  }
  if (!Number.isInteger(maxBatches) || maxBatches < BATCHES_MIN || maxBatches > BATCHES_MAX) {
    return { ok: false, error: "invalid_analysis_request" }
  }
  return { ok: true, dataset, limit, maxBatches }
}

/** GitHub workflow_dispatch 的 inputs 一律是字串。 */
export function dispatchInputs({ dataset, limit, maxBatches }) {
  return { dataset, limit: String(limit), max_batches: String(maxBatches) }
}
