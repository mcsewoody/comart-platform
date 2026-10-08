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

import { kmsToDocs } from "./assemble.js";
test("KMS 文件：有「必讀資料」標籤才算必讀，標題當小標", () => {
  const d = kmsToDocs([
    { title: "QBQ", body: "Q", tags: ["必讀資料"] },
    { title: "苦藥", body: "K", tags: ["好文分享", "何飛鵬"] },
    { title: "", file_name: "x.png", body: "X", tags: null },
  ]);
  assert.deepEqual(d.map((x) => x.folder + "/" + x.name), ["必讀資料/QBQ", "好文分享/苦藥", "好文分享/x.png"]);
});

test("KMS 文件：「Woody 著述」標籤優先，排在最前面", () => {
  const d = kmsToDocs([{ title: "好", body: "b", tags: ["好文分享"] }, { title: "我寫的", body: "w", tags: ["Woody 著述"] }]);
  assert.deepEqual(d.map((x) => x.folder), ["好文分享", "Woody 著述"]);
  const n = normalizeDocs(d).docs;
  assert.equal(n[0].folder, "Woody 著述");
  assert.ok(buildDocsAppendix(n).includes("〔Woody 著述〕的是 Woody 自己寫的"));
});
