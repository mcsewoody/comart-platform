import test from "node:test";
import assert from "node:assert/strict";
import { isStaff, tagParagraphs, woodyComments, normalizeDocs, buildDocsAppendix, assemble } from "./assemble.js";

test("同仁段落要有冒號才算", () => {
  assert.equal(isStaff("振慈：利他是永續的力量"), true);
  assert.equal(isStaff("Kayla: Recently..."), true);
  assert.equal(isStaff("李立的心得思考：…"), true);
  assert.equal(isStaff("本週怡芳的分享，是我上週就想跟各位分享的文章"), false);
  assert.equal(isStaff("原文：https://example.com"), false);
  assert.equal(isStaff("1. PDCA 是起點"), false);
});
test("同仁段落之後的延續段落也算同仁的，直到 Woody 的標記", () => {
  const t = tagParagraphs("我的話\n\n振慈：她的話\n\n她的第二段\n\n→ Woody 的回應");
  assert.equal(t, "我的話\n\n〔同仁分享〕振慈：她的話\n\n〔同仁分享〕她的第二段\n\n→ Woody 的回應");
});
test("Woody 的短評：太短的流程箭頭不算", () => {
  assert.deepEqual(woodyComments({ feedback: "→ 生產\n→ 這已到不可迴避的程度了\nWoody: 謝謝大家的分享" }),
    ["這已到不可迴避的程度了", "謝謝大家的分享"]);
});
test("文件：只收兩個子資料夾、順序固定", () => {
  const { docs } = normalizeDocs([
    { folder: "好文分享", name: "b.pdf", text: "B" },
    { folder: "其他", name: "x.pdf", text: "X" },
    { folder: "必讀資料", name: "a.docx", text: "A\r\n\n\n\nA2" },
    { folder: "必讀資料", name: "empty.docx", text: "  " },
  ]);
  assert.deepEqual(docs.map((d) => d.folder + "/" + d.name), ["必讀資料/a.docx", "好文分享/b.pdf"]);
  assert.equal(docs[0].text, "A\n\nA2");
});
test("文件總量過大要拒絕", () => {
  const big = "字".repeat(190000);
  const r = normalizeDocs(Array.from({ length: 5 }, (_, i) => ({ folder: "好文分享", name: i + ".txt", text: big })));
  assert.equal(r.error, "docs_too_large");
});
test("沒有文件時附錄二是空的，組裝時不留空段", () => {
  assert.equal(buildDocsAppendix([]), "");
  assert.equal(assemble("CORE", "APP1", ""), "CORE\n\n---\n\nAPP1");
});

import { isImageName, ocrKey, validOcrKey, fillOcr } from "./assemble.js";
test("圖片：key 的格式與驗證", () => {
  assert.equal(isImageName("IMG_0014.PNG"), true);
  assert.equal(isImageName("a.pdf"), false);
  assert.equal(ocrKey("好文分享", "IMG_0014.PNG", 881259), "好文分享/IMG_0014.PNG|881259");
  assert.equal(validOcrKey("好文分享/IMG_0014.PNG|881259"), true);
  assert.equal(validOcrKey("其他/IMG_0014.PNG|1"), false);
  assert.equal(validOcrKey("好文分享/a.pdf|1"), false);
  assert.equal(validOcrKey("好文分享/a.png"), false);
});
test("圖片：用快取補文字，找不到的列出來", () => {
  const r = fillOcr([
    { folder: "必讀資料", name: "a.docx", text: "A" },
    { folder: "好文分享", name: "x.png", size: 10, ocr: true },
    { folder: "好文分享", name: "y.png", size: 20, ocr: true },
  ], { "好文分享/x.png|10": "X 文" });
  assert.deepEqual(r.docs.map((d) => d.text), ["A", "X 文"]);
  assert.deepEqual(r.missing, ["y.png"]);
  assert.deepEqual(r.used, ["好文分享/x.png|10", "好文分享/y.png|20"]);
});
