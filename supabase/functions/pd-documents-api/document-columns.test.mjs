import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  BUY_ONLY_COLUMNS,
  DELETE_COLUMNS,
  MFG_ONLY_COLUMNS,
  SUMMARY_COMMON_COLUMNS,
  editColumnList,
  summaryColumnList,
} from "./document-columns.js"

/* 🔴 這支測試存在的原因：2.35 把搜尋的 select("*") 改成明確列欄位時，把兩張表
   的欄位都列了上去 —— pd_mfg_documents 沒有 supplier_name，Postgres 直接 500，
   搜尋整個壞掉而且是上線後才發現。

   所以不靠人記得哪張表有哪些欄位，直接讀 migration 的真實 schema 來對。 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../migrations")

function columnsOf(table) {
  const columns = new Set()
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith(".sql")) continue
    const sql = readFileSync(join(MIGRATIONS, file), "utf8")

    const created = sql.match(
      new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`),
    )
    if (created) {
      for (const [, name] of created[1].matchAll(/^ {2}([a-z_][a-z_0-9]*)\s/gm)) columns.add(name)
    }

    const altered = sql.match(
      new RegExp(`alter table public\\.${table}\\b([\\s\\S]*?);`, "g"),
    )
    for (const block of altered || []) {
      for (const [, name] of block.matchAll(/add column if not exists ([a-z_][a-z_0-9]*)/g)) {
        columns.add(name)
      }
    }
  }
  return columns
}

const mfg = columnsOf("pd_mfg_documents")
const buy = columnsOf("pd_buy_documents")

/* 🔴 欄位名的 regex 本來是 `[a-z_]+`，讀不到任何含數字的欄位 —— `sha256` 就是
   一個，而且它是去重的主鍵之一。也就是這個「拿真 schema 來驗」的讀取器
   本身有個洞：把 sha256 寫進欄位清單，測試會說那個欄位不存在（反過來也一樣，
   真的打錯字時它照樣過）。下面這條把已知一定存在的欄位釘住。*/
test("schema 讀取器讀得到含數字的欄位名", () => {
  for (const [name, columns] of [["mfg", mfg], ["buy", buy]]) {
    assert.ok(columns.has("sha256"), `${name} 讀不到 sha256`)
  }
})

test("migration 讀得到兩張表的欄位（不然下面的驗證都是假的）", () => {
  assert.ok(mfg.size > 20, `pd_mfg_documents 只讀到 ${mfg.size} 個欄位`)
  assert.ok(buy.size > 20, `pd_buy_documents 只讀到 ${buy.size} 個欄位`)
})

test("共用欄位在兩張表都真的存在", () => {
  assert.deepEqual(SUMMARY_COMMON_COLUMNS.filter((c) => !mfg.has(c)), [])
  assert.deepEqual(SUMMARY_COMMON_COLUMNS.filter((c) => !buy.has(c)), [])
})

test("mfg 專屬欄位只有 mfg 有，buy 專屬欄位只有 buy 有", () => {
  assert.deepEqual(MFG_ONLY_COLUMNS.filter((c) => !mfg.has(c)), [])
  assert.deepEqual(MFG_ONLY_COLUMNS.filter((c) => buy.has(c)), [])
  assert.deepEqual(BUY_ONLY_COLUMNS.filter((c) => !buy.has(c)), [])
  assert.deepEqual(BUY_ONLY_COLUMNS.filter((c) => mfg.has(c)), [])
})

test("每個 dataset 送出去的欄位，那張表都有（這就是 2.35 掛掉的那一條）", () => {
  assert.deepEqual(summaryColumnList("mfg").filter((c) => !mfg.has(c)), [])
  assert.deepEqual(summaryColumnList("buy").filter((c) => !buy.has(c)), [])
})

test("不撈 extracted_text 與 search_text —— 分析完成後各可到 300 KB，summary() 用不到", () => {
  for (const dataset of ["mfg", "buy"]) {
    const columns = summaryColumnList(dataset)
    assert.ok(!columns.includes("extracted_text"), `${dataset} 撈了 extracted_text`)
    assert.ok(!columns.includes("search_text"), `${dataset} 撈了 search_text`)
  }
})

test("沒有重複欄位", () => {
  for (const dataset of ["mfg", "buy"]) {
    const columns = summaryColumnList(dataset)
    assert.equal(new Set(columns).size, columns.length)
  }
})

test("編輯要撈的欄位，兩張表都真的有", () => {
  assert.deepEqual(editColumnList("mfg").filter((c) => !mfg.has(c)), [])
  assert.deepEqual(editColumnList("buy").filter((c) => !buy.has(c)), [])
})

test("刪除要撈的欄位，兩張表都真的有", () => {
  assert.deepEqual(DELETE_COLUMNS.filter((c) => !mfg.has(c)), [])
  assert.deepEqual(DELETE_COLUMNS.filter((c) => !buy.has(c)), [])
})

test("search_text 三個端點都不撈 —— 沒有任何一個用得到它", () => {
  for (const dataset of ["mfg", "buy"]) {
    for (const columns of [summaryColumnList(dataset), editColumnList(dataset), DELETE_COLUMNS]) {
      assert.ok(!columns.includes("search_text"), `${dataset} 撈了 search_text`)
    }
  }
})

test("extracted_text 只有編輯撈得到（它要用內文重拼 search_text）", () => {
  for (const dataset of ["mfg", "buy"]) {
    assert.ok(editColumnList(dataset).includes("extracted_text"))
    assert.ok(!summaryColumnList(dataset).includes("extracted_text"))
  }
  assert.ok(!DELETE_COLUMNS.includes("extracted_text"))
})

test("編輯與刪除的欄位清單沒有重複", () => {
  for (const dataset of ["mfg", "buy"]) {
    const columns = editColumnList(dataset)
    assert.equal(new Set(columns).size, columns.length)
  }
  assert.equal(new Set(DELETE_COLUMNS).size, DELETE_COLUMNS.length)
})
