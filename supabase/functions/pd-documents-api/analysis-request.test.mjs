import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { BATCHES_MAX, BATCHES_MIN, dispatchInputs, parseAnalysisRequest } from "./analysis-request.js"

test("三個 dataset 都收，其他一律拒絕", () => {
  for (const dataset of ["mfg", "buy", "both"]) {
    assert.equal(parseAnalysisRequest({ dataset, limit: 20 }).ok, true)
  }
  for (const dataset of ["", "MFG", "all", undefined, null, 1]) {
    assert.equal(parseAnalysisRequest({ dataset, limit: 20 }).ok, false)
  }
})

test("limit 只收 1–50 的整數", () => {
  for (const limit of [1, 50]) assert.equal(parseAnalysisRequest({ dataset: "both", limit }).ok, true)
  for (const limit of [0, -1, 51, 1.5, NaN, undefined, null, "abc"]) {
    assert.equal(parseAnalysisRequest({ dataset: "both", limit }).ok, false, `limit=${limit}`)
  }
})

test("maxBatches 沒帶就是 1（＝改動之前的行為），不是不限", () => {
  assert.equal(parseAnalysisRequest({ dataset: "both", limit: 20 }).maxBatches, BATCHES_MIN)
})

test("maxBatches 只收 1–20 的整數 —— workflow 超出範圍會直接 exit 1", () => {
  for (const n of [1, 20]) {
    assert.equal(parseAnalysisRequest({ dataset: "both", limit: 20, maxBatches: n }).ok, true)
  }
  for (const n of [0, -1, 21, 2.5, NaN, null, "abc"]) {
    assert.equal(parseAnalysisRequest({ dataset: "both", limit: 20, maxBatches: n }).ok, false, `maxBatches=${n}`)
  }
})

/* 數字字串會被 Number() 收下 —— 這是既有行為（原本就是 `Number(body.limit)`），
   不是這次放寬的。寫成測試是為了下次有人「順手收緊」時知道那會改變行為。*/
test("數字字串會被接受（既有行為）", () => {
  const parsed = parseAnalysisRequest({ dataset: "both", limit: "20", maxBatches: "3" })
  assert.deepEqual(parsed, { ok: true, dataset: "both", limit: 20, maxBatches: 3 })
})

test("dispatch 的 inputs 一律是字串（GitHub 只吃字串）", () => {
  const parsed = parseAnalysisRequest({ dataset: "mfg", limit: 50, maxBatches: 4 })
  assert.deepEqual(dispatchInputs(parsed), { dataset: "mfg", limit: "50", max_batches: "4" })
})

/* 🔴 這條是重點：上限必須跟 workflow 自己的檢查一致。
   兩邊分岔的話，edge function 放行的值會讓整個 GitHub job 在第一步就失敗，
   而使用者只會看到「已啟動分析」然後什麼都沒發生。 */
test("上限與 workflow 的 max_batches 檢查一致", () => {
  const yml = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../.github/workflows/pd-document-worker.yml"),
    "utf8",
  )
  const guard = yml.match(/MAX_BATCHES\s*<\s*(\d+)\s*\|\|\s*MAX_BATCHES\s*>\s*(\d+)/)
  assert.ok(guard, "找不到 workflow 裡的 max_batches 範圍檢查")
  assert.equal(Number(guard[1]), BATCHES_MIN)
  assert.equal(Number(guard[2]), BATCHES_MAX)
})
