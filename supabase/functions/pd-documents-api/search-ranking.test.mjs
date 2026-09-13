import assert from "node:assert/strict"
import test from "node:test"

import { compareSearchResults } from "./search-ranking.js"

test("sorts by score before any date", () => {
  const rows = [
    { document_id: "newer", score: 80, primary_document_date: "2026-09-01" },
    { document_id: "relevant", score: 90, primary_document_date: "2020-01-01" },
  ]
  assert.deepEqual(rows.sort(compareSearchResults).map((row) => row.document_id), ["relevant", "newer"])
})

test("uses primary date and then source modified date as tie breakers", () => {
  const rows = [
    { document_id: "older-version", score: 90, primary_document_date: "2025-01-01", source_modified_at: "2026-12-01" },
    { document_id: "older-file", score: 90, primary_document_date: "2026-01-01", source_modified_at: "2026-02-01" },
    { document_id: "newer-file", score: 90, primary_document_date: "2026-01-01", source_modified_at: "2026-03-01" },
  ]
  assert.deepEqual(rows.sort(compareSearchResults).map((row) => row.document_id), ["newer-file", "older-file", "older-version"])
})

test("places missing dates last", () => {
  const rows = [
    { document_id: "missing", score: 90, primary_document_date: null, source_modified_at: null },
    { document_id: "dated", score: 90, primary_document_date: "2026-01-01", source_modified_at: null },
  ]
  assert.deepEqual(rows.sort(compareSearchResults).map((row) => row.document_id), ["dated", "missing"])
})
