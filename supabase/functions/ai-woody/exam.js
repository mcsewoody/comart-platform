// AI Woody：入職考試與一致性檢查的純函式（抽出來才能用 node --test 在本機測）。
// 🔴 評分要點（points／minus）永遠只在伺服器端，送給前端的題目只有 id／category／question。

export const EXAM_N = 10;          // 每次抽 10 題，每題 10 分
export const EXAM_PASS = 85;       // Woody 定案：85 分及格
export const ANSWER_MAX = 2000;    // 單題作答上限

// 每個類別先各抽一題（題庫 10 類 → 剛好一類一題），不夠 n 題再從剩下的隨機補
export function pickQuestions(bank, n = EXAM_N, rand = Math.random) {
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const byCat = new Map();
  for (const q of shuffle(bank)) { if (!byCat.has(q.category)) byCat.set(q.category, []); byCat.get(q.category).push(q); }
  const picked = [];
  for (const list of shuffle([...byCat.values()])) { if (picked.length < n) picked.push(list.shift()); }
  const rest = shuffle([...byCat.values()].flat());
  while (picked.length < n && rest.length) picked.push(rest.shift());
  return picked;
}

export function publicQuestion(q) { return { id: q.id, category: q.category, question: q.question }; }

export function validateAnswers(ids, answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return "answers_required";
  for (const k of Object.keys(answers)) if (!ids.includes(k)) return "unknown_question";
  for (const id of ids) {
    const a = answers[id];
    if (a != null && typeof a !== "string") return "bad_answer";
    if (typeof a === "string" && a.length > ANSWER_MAX) return "answer_too_long";
  }
  return null;
}

const LANG_NAME = { "zh-TW": "繁體中文", "zh-CN": "简体中文", en: "English", vi: "Tiếng Việt", ja: "日本語" };

export function gradeRequestText(questions, answers, lang) {
  const blocks = questions.map((q) => [
    `<question id="${q.id}">`,
    `類別：${q.category}`,
    `題目：${q.question}`,
    `評分要點（答到越多分越高，不必用一樣的字）：\n${(q.points || []).map((p) => "・" + p).join("\n")}`,
    `扣分方向：\n${(q.minus || []).map((p) => "・" + p).join("\n") || "（無）"}`,
    `作答：${String(answers[q.id] || "").trim() || "（未作答）"}`,
    `</question>`,
  ].join("\n")).join("\n\n");
  return blocks + "\n\n" + [
    "請逐題評分，每題 0～10 分的整數：",
    "・要點全部答到、沒有扣分方向 → 9～10；答到大部分 → 7～8；只答到一部分 → 4～6；離題、空白或明顯違反扣分方向 → 0～3。",
    "・看的是觀念與做法對不對，不是字數、文筆或有沒有背出原句；用自己的話答對就給分。",
    "・未作答一律 0 分。",
    `・每題給一句具體的評語，說明扣分在哪裡、應該怎麼想；評語用${LANG_NAME[lang] || "作答者使用的語言"}。`,
    '輸出格式（標籤以外不要任何文字）：<grade id="題號" score="分數">評語</grade>，每題一個。',
  ].join("\n");
}

export function parseGrades(text, ids) {
  const out = [];
  for (const id of ids) {
    const m = String(text || "").match(new RegExp(`<grade id="${id}" score="(\\d{1,2})">([\\s\\S]*?)</grade>`));
    if (!m) return null;                        // 少一題就整份不算（截斷的回覆正是少尾巴）
    const score = Math.max(0, Math.min(10, parseInt(m[1], 10)));
    out.push({ id, score, comment: m[2].trim() });
  }
  return out;
}

export function examTotal(results) {
  const total = results.reduce((n, r) => n + r.score, 0);
  return { total, passed: total >= EXAM_PASS };
}

// ── 一致性檢查：裁判對照「應該包含／不可以出現」──
export function judgeRequestText(item, answer) {
  return [
    `問題：${item.question}`,
    `應該包含：\n${(item.must || []).map((p) => "・" + p).join("\n")}`,
    `不可以出現：\n${(item.must_not || []).map((p) => "・" + p).join("\n") || "（無）"}`,
    `受測回答：\n${answer}`,
    "",
    "你是嚴格的評審。依上面的標準替「受測回答」評分（0～10 的整數）：",
    "・出現任何一條「不可以出現」→ 最多 3 分。",
    "・「應該包含」每漏一條扣 2～3 分；意思到了就算，不必用一樣的字。",
    "輸出格式（標籤以外不要任何文字）：<score>分數</score><reason>一兩句說明扣分原因；滿分就寫「符合」</reason>",
  ].join("\n");
}

export function parseJudge(text) {
  const s = String(text || "").match(/<score>(\d{1,2})<\/score>/);
  const r = String(text || "").match(/<reason>([\s\S]*?)<\/reason>/);
  if (!s) return null;
  return { score: Math.max(0, Math.min(10, parseInt(s[1], 10))), reason: r ? r[1].trim() : "" };
}
