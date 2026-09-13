import assert from "node:assert/strict"
import test from "node:test"
import { expandSearchQueries } from "./search-aliases.js"

test("expands 3 in 1 to Chinese equivalents", () => {
  const queries = expandSearchQueries("3 in 1")
  assert.equal(queries[0], "3 in 1")
  assert.ok(queries.includes("三合一"))
  assert.ok(queries.includes("3合1"))
  assert.ok(queries.includes("3 trong 1"))
})

test("expands multi-term Chinese product queries into English and Vietnamese", () => {
  const queries = expandSearchQueries("磁吸三合一")
  assert.ok(queries.includes("magnetic 3 in 1"))
  assert.ok(queries.includes("nam châm 3 trong 1"))
  assert.ok(queries.length <= 12)
})

test("connects Vietnamese product terms to both Chinese scripts and English", () => {
  const queries = expandSearchQueries("giá đỡ điện thoại có thể gập")
  assert.ok(queries.some((value) => value.includes("手機支架") && value.includes("可折疊")))
  assert.ok(queries.some((value) => value.includes("手机支架") && value.includes("可折叠")))
  assert.ok(queries.some((value) => value.includes("phone holder") && value.includes("foldable")))
})

test("normalizes Traditional and Simplified Chinese supplier and document terms", () => {
  assert.ok(expandSearchQueries("鎛銳報價單").includes("镈锐报价单"))
  assert.ok(expandSearchQueries("镈锐报价单").includes("鎛銳報價單"))
})

test("keeps unrelated model numbers unchanged", () => {
  assert.deepEqual(expandSearchQueries("X8-2026"), ["X8-2026"])
})
