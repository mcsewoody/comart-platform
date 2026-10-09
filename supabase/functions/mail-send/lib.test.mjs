import { test } from "node:test"
import assert from "node:assert/strict"
import { cleanEmails, safePath, validate, chunkRanges, graphAttachment, UPLOAD_CHUNK } from "./lib.js"

const ok = { kind: "followup", to: ["a@b.com"], subject: "Hi", html: "<p>x</p>" }
test("cleanEmails 拆分、去重、轉小寫、丟掉不合法的", () => {
  assert.deepEqual(cleanEmails("A@b.com / a@b.com; c@d.co,bad"), ["a@b.com", "c@d.co"])
  assert.deepEqual(cleanEmails(["x <x@y.com>"]), [])
})
test("safePath 擋 .. 與絕對路徑與怪字元", () => {
  assert.equal(safePath("expo/1/a.pdf"), "expo/1/a.pdf")
  assert.equal(safePath("../x"), ""); assert.equal(safePath("/x"), ""); assert.equal(safePath("a b"), "")
})
test("validate", () => {
  assert.equal(validate(ok), null)
  assert.equal(validate({ ...ok, kind: "spam" }), "bad_kind")
  assert.equal(validate({ ...ok, to: [] }), "no_recipient")
  assert.equal(validate({ ...ok, to: ["1@a.co","2@a.co","3@a.co","4@a.co","5@a.co","6@a.co"] }), "too_many_recipients")
  assert.equal(validate({ ...ok, subject: "" }), "bad_subject")
  assert.equal(validate({ ...ok, attach: [{ bucket: "product-private", path: "a" }] }), "bad_attachment")
  assert.equal(validate({ ...ok, attach: [{ bucket: "crm-expo", path: "../a" }] }), "bad_attachment")
  assert.equal(validate({ ...ok, inline: [{ cid: "p1", bucket: "crm-expo", path: "e/p.jpg" }] }), null)
  assert.equal(validate({ ...ok, inline: [{ cid: "p 1", bucket: "crm-expo", path: "e/p.jpg" }] }), "bad_cid")
  assert.equal(validate({ ...ok, files: [{ name: "q.pdf" }] }), "bad_file")
})
test("chunkRanges 覆蓋整個檔案、320KiB 倍數", () => {
  assert.equal(UPLOAD_CHUNK % (320 * 1024), 0)
  const r = chunkRanges(UPLOAD_CHUNK * 2 + 5)
  assert.deepEqual(r, [[0, UPLOAD_CHUNK - 1], [UPLOAD_CHUNK, UPLOAD_CHUNK * 2 - 1], [UPLOAD_CHUNK * 2, UPLOAD_CHUNK * 2 + 4]])
})
test("inline 附件帶 contentId", () => {
  const g = graphAttachment({ name: "p.jpg", mime: "image/jpeg", b64: "AA", cid: "p1" })
  assert.equal(g.isInline, true); assert.equal(g.contentId, "p1")
})
test("wr（Woody 週報）要 reportId、不收前端給的附件", () => {
  const wr = { kind: "wr", to: ["all@comart.com.tw"], subject: "Woody 週報", html: "<p>x</p>", reportId: "abc_1" }
  assert.equal(validate(wr), null)
  assert.equal(validate({ ...wr, reportId: "" }), "bad_report")
  assert.equal(validate({ ...wr, reportId: "a/../b" }), "bad_report")
  assert.equal(validate({ ...wr, attach: [{ bucket: "crm-expo", path: "a.pdf" }] }), "bad_attachment")
  assert.equal(validate({ ...wr, files: [{ name: "x", b64: "AA" }] }), "bad_attachment")
})
