import { test } from "node:test"
import assert from "node:assert/strict"
import { sha256, sourceOf, footerSource, parseTag } from "./lib.js"
test("sourceOf 固定六段、去頭尾空白", () => {
  assert.deepEqual(Object.keys(sourceOf({ work: " a ", x: 1 })), ["work", "plan", "reflections", "intel", "feedback", "other"])
  assert.equal(sourceOf({ work: " a " }).work, "a")
})
test("改一個字指紋就不同", async () => {
  const a = await sha256(JSON.stringify(sourceOf({ work: "本週" }))), b = await sha256(JSON.stringify(sourceOf({ work: "本週。" })))
  assert.notEqual(a, b); assert.equal(a.length, 64)
})
test("footerSource 限長限量", () => {
  const f = footerSource({ okr: ["a", "b"], learn: ["c"] })
  assert.deepEqual(f, { okr_0: "a", okr_1: "b", learn_0: "c" })
  assert.deepEqual(footerSource(null), {})
})
test("parseTag 保留內部換行", () => {
  assert.equal(parseTag("<t>\nline1\nline2\n</t>", "t"), "line1\nline2")
  assert.equal(parseTag("none", "t"), null)
})
