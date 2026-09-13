import assert from "node:assert/strict"
import test from "node:test"

import { resolveProductFinderAccess } from "./access-control.js"

test("existing uploader does not inherit full-library sync", () => {
  assert.deepEqual(resolveProductFinderAccess("dcc", { active: true, can_sync: false }), {
    canUpload: true,
    canSync: false,
  })
})

test("sync-only access does not grant uploads", () => {
  assert.deepEqual(resolveProductFinderAccess("user", { active: false, can_sync: true }), {
    canUpload: false,
    canSync: true,
  })
})

test("administrator still needs explicit full-library sync access", () => {
  assert.deepEqual(resolveProductFinderAccess("admin", { active: true, can_sync: false }), {
    canUpload: true,
    canSync: false,
  })
})
