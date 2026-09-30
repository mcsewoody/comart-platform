import test from "node:test"
import assert from "node:assert/strict"
import { tombstoneDecision, tombstonePublic } from "./tombstone.js"

const tomb = { sha256: "a".repeat(64), relative_path: "OwnProduct/A.pdf", title: "A", deleted_at: "2026-10-01T00:00:00Z", deleted_by: "A00001", deleted_by_name: "管理者" }

test("沒有刪除紀錄就照常上傳（不論有沒有帶 restore）", () => {
  assert.equal(tombstoneDecision(null), "allow")
  assert.equal(tombstoneDecision(null, { restore: true }), "allow")
})

test("曾刪除：批次匯入（沒帶 restore）一律擋下，admin 也一樣", () => {
  assert.equal(tombstoneDecision(tomb), "blocked")
  assert.equal(tombstoneDecision(tomb, { isAdmin: true }), "blocked")
})

test("還原只有 admin 可以", () => {
  assert.equal(tombstoneDecision(tomb, { restore: true, isAdmin: true }), "allow")
  assert.equal(tombstoneDecision(tomb, { restore: true, isAdmin: false }), "restore_forbidden")
})

test("回給前端的欄位不含刪除者工號", () => {
  const out = tombstonePublic(tomb)
  assert.equal(out.deletedByName, "管理者")
  assert.equal(out.relativePath, "OwnProduct/A.pdf")
  assert.ok(!("deletedBy" in out) && !JSON.stringify(out).includes("A00001"))
})
