import test from "node:test";
import assert from "node:assert/strict";
import { pickQuestions, validateAnswers, parseGrades, examTotal, parseJudge, gradeRequestText, publicQuestion, EXAM_PASS } from "./exam.js";

const bank = [];
for (let c = 0; c < 10; c++) for (let i = 0; i < 5; i++) bank.push({ id: `E${c}${i}`, category: `C${c}`, question: "q", points: ["p"], minus: ["m"] });

test("抽題：10 類各一題、不重複", () => {
  const p = pickQuestions(bank);
  assert.equal(p.length, 10);
  assert.equal(new Set(p.map((q) => q.category)).size, 10);
  assert.equal(new Set(p.map((q) => q.id)).size, 10);
});
test("抽題：類別不足 10 類時從剩下的補滿", () => {
  const small = bank.filter((q) => ["C0", "C1"].includes(q.category));
  const p = pickQuestions(small);
  assert.equal(p.length, 10);
  assert.equal(new Set(p.map((q) => q.id)).size, 10);
});
test("送給前端的題目不含評分要點", () => {
  assert.deepEqual(Object.keys(publicQuestion(bank[0])).sort(), ["category", "id", "question"]);
});
test("作答驗證", () => {
  assert.equal(validateAnswers(["E1"], { E1: "a" }), null);
  assert.equal(validateAnswers(["E1"], { E2: "a" }), "unknown_question");
  assert.equal(validateAnswers(["E1"], { E1: "x".repeat(2001) }), "answer_too_long");
  assert.equal(validateAnswers(["E1"], [1]), "answers_required");
});
test("評分解析：每題都要有，分數夾在 0～10", () => {
  const t = '<grade id="E1" score="8">好</grade><grade id="E2" score="12">滿</grade>';
  assert.deepEqual(parseGrades(t, ["E1", "E2"]), [{ id: "E1", score: 8, comment: "好" }, { id: "E2", score: 10, comment: "滿" }]);
  assert.equal(parseGrades('<grade id="E1" score="8">好</grade>', ["E1", "E2"]), null);
});
test("及格線 85", () => {
  assert.equal(EXAM_PASS, 85);
  assert.deepEqual(examTotal(Array.from({ length: 10 }, () => ({ score: 8 }))), { total: 80, passed: false });
  assert.equal(examTotal([...Array(5)].map(() => ({ score: 9 })).concat([...Array(5)].map(() => ({ score: 8 })))).passed, true);
});
test("評分提示：未作答標示清楚", () => {
  assert.ok(gradeRequestText([bank[0]], {}, "zh-TW").includes("（未作答）"));
});
test("裁判解析", () => {
  assert.deepEqual(parseJudge("<score>7</score><reason>漏了一點</reason>"), { score: 7, reason: "漏了一點" });
  assert.equal(parseJudge("沒有分數"), null);
});
