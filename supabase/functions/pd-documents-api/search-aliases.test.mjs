import assert from "node:assert/strict"
import test from "node:test"
import { expandSearchQueries } from "./search-aliases.js"

test("expands 3 in 1 to Chinese equivalents", () => {
  const queries = expandSearchQueries("3 in 1")
  assert.equal(queries[0], "3 in 1")
  assert.ok(queries.includes("三合一"))
  assert.ok(queries.includes("3合1"))
})

test("expands Chinese product terms to English", () => {
  const queries = expandSearchQueries("磁吸三合一")
  assert.ok(queries.some((value) => value.includes("MagSafe")))
  assert.ok(queries.some((value) => value.includes("3 in 1")))
  assert.ok(queries.length <= 12)
})

test("keeps unrelated model numbers unchanged", () => {
  assert.deepEqual(expandSearchQueries("X8-2026"), ["X8-2026"])
})
