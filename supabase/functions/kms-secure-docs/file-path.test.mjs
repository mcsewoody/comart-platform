import test from "node:test"
import assert from "node:assert/strict"
import { kmsFilePath, kmsUploadPath, kmsLocator } from "./file-path.js"

const BASE = "https://tcvlnpgpuphdalzvmoyo.supabase.co"

test("既有的公開網址解析得出路徑", () => {
  assert.equal(kmsFilePath(`${BASE}/storage/v1/object/public/kms-files/uploads/1790810365284_AI_.pdf`), "uploads/1790810365284_AI_.pdf")
})

test("簽章網址、帶 query 的網址也解析得出", () => {
  assert.equal(kmsFilePath(`${BASE}/storage/v1/object/sign/kms-files/uploads/1_a.pdf?token=xyz`), "uploads/1_a.pdf")
})

test("別的 bucket、上一層跳脫、非 uploads/ 一律拒絕", () => {
  assert.equal(kmsFilePath(`${BASE}/storage/v1/object/public/product-private/uploads/1_a.pdf`), null)
  assert.equal(kmsFilePath(`${BASE}/storage/v1/object/public/kms-files/uploads/../x`), null)
  assert.equal(kmsFilePath(`${BASE}/storage/v1/object/public/kms-files/other/1_a.pdf`), null)
  assert.equal(kmsFilePath(""), null)
})

test("上傳路徑只留 ASCII，而且與定位字串來回一致", () => {
  const p = kmsUploadPath("AI應用 - 良興電子.pdf", 123)
  assert.equal(p, "uploads/123_AI___-_____.pdf")
  assert.equal(kmsFilePath(kmsLocator(BASE, p)), p)
})
