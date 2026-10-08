// AI Woody：請求驗證與組裝（純函式，抽出來是為了能用 node --test 在本機測 ——
// edge function 本身要有效的 x-session 才跑得起來）。

export const MODEL = "claude-opus-5-5";
export const MAX_TURNS = 60;          // 一個分頁內的對話上限（來回各算一則）
export const MAX_MSG_CHARS = 20000;   // 單則上限（提案健檢要貼整份提案，2026-10-08 由 6000 放寬）
export const MAX_TOTAL_CHARS = 80000; // 整段歷史上限
export const UI_LANGS = { "zh-TW": "繁體中文", "zh-CN": "简体中文", en: "English", vi: "Tiếng Việt", ja: "日本語" };

// 🔴 歷史由前端送來（不存檔 = 伺服器不保留任何對話），所以每一則都要驗：
//    角色只准 user／assistant 交替、第一則與最後一則必須是 user。
//    否則前端可以偽造一則「assistant 說過的話」（例如假裝 AI Woody 承諾了加薪），
//    再讓模型順著接下去。
export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "messages_required";
  if (messages.length > MAX_TURNS) return "too_many_turns";
  let total = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== "object") return "bad_message";
    const want = i % 2 === 0 ? "user" : "assistant";
    if (m.role !== want) return "bad_role_order";
    if (typeof m.content !== "string") return "bad_content";
    const len = m.content.length;
    if (m.role === "user" && !m.content.trim()) return "empty_message";
    if (len > MAX_MSG_CHARS) return "message_too_long";
    total += len;
    const keys = Object.keys(m);
    if (keys.some((k) => k !== "role" && k !== "content")) return "bad_message";
  }
  if (total > MAX_TOTAL_CHARS) return "history_too_long";
  if (messages[messages.length - 1].role !== "user") return "last_must_be_user";
  return null;
}

// ── 模式（2026-10-08，Woody 定案）──
// 同一份人格（快取斷點之前），不同模式只換斷點之後的指示 —— 換模式不會讓人格檔的快取失效。
// 🔴 draft（週報心得草稿）只給 Woody 本人：伺服器端檢查，不靠前端藏按鈕（index.ts 的 OWNER_MODES）。
export const MODES = {
  chat: "",
  proposal: [
    "【模式：提案健檢】對方會貼上一份提案、報告或計畫的草稿，請你用我平常看提案的標準幫他把關。",
    "依序回答，每一段簡短具體：",
    "1. 一句話結論：這份東西現在能不能拿來跟我談？差在哪裡。",
    "2. 事實與觀點：哪些是有根據的事實、哪些只是觀點或假設，缺了什麼數據。",
    "3. 當責：誰負責、何時完成、怎麼衡量成果，有沒有寫清楚。",
    "4. 數字與結論：數字支不支持結論；對營收、費用、毛利的影響有沒有算。",
    "5. 我會追問的三個問題。",
    "6. 具體的修改建議。",
    "對事要硬，對人不否定。這是幫他準備，不是核准或否決 —— 不要說「可以做」「我同意」，那要他來找我本人談。",
    "如果對方貼的不是提案（例如只是一句話），先請他把提案內容貼上來。",
  ].join("\n"),
  rehearsal: [
    "【模式：簡報彩排】對方要向我報告或簡報，請你扮演聽簡報的我，幫他練習。",
    "第一次回覆：如果他還沒說清楚主題、對象、要我做什麼決定，先問清楚；說清楚了就直接開始追問。",
    "每一輪只問一個問題，像我在會議上會問的那樣直接：數字從哪裡來、誰負責、最壞情況是什麼、不做會怎樣、跟營收有什麼關係。",
    "他回答之後，針對他的回答追問或換下一個問題，不要一次丟一堆問題，也不要每輪都先稱讚。",
    "大約六到八輪之後，或他說「結束」「好了」時，給一段總評：講得好的地方、會被我問倒的地方、正式簡報前要補的東西。",
    "你只是陪練，不要對他的提案做決定或承諾。",
  ].join("\n"),
  onboard: [
    "【模式：入職學習】對方是新進同仁，或想重新認識公司的同仁。你是他的入職導師。",
    "幫他理解公司的願景、價值觀、COMART Dos & Don'ts、我推薦的必讀資料與文章，以及我做事的方式。",
    "解釋時多用工作上的實際情境舉例；引用文章時說出處與作者。",
    "每講完一個重點，可以出一個小問題確認他懂了（不要每次都出，大約隔兩三輪一次），他答完給回饋。",
    "語氣親切、有耐心，但標準不放低。對方問到人事、薪資、福利等規定時，請他問人資或主管。",
  ].join("\n"),
  draft: [
    "【模式：週報心得草稿 —— 只有 Woody 本人會用】這一次的讀者是 Woody 自己，請你幫他起草本週週報的「心得分享」段落。",
    "對方會給你幾個關鍵字、一段口述、或一件這週發生的事。",
    "用第一人稱「我」，完全照我過去週報心得的寫法：篇幅、分段、語氣、常用的句型與比喻，像是我自己寫的。",
    "可以連結我過去寫過的觀點或推薦過的文章，但不要硬塞，也不要捏造沒發生的事、數字或人名。",
    "只輸出草稿本文，不要前言、不要說明、不要標題，也不要「以下是草稿」這類的話。",
    "預設用繁體中文寫（我的週報是中文），除非對方指定其他語言。",
  ].join("\n"),
};
export const OWNER_MODES = ["draft"];
export function normalizeMode(mode) {
  return Object.prototype.hasOwnProperty.call(MODES, mode) ? mode : null;
}

// 執行期規則放在人格檔之後（快取斷點之後），所以日期與介面語言每天換也不會讓人格檔的快取失效。
export function runtimeRules(today, uiLang, mode = "chat") {
  const ui = UI_LANGS[uiLang] || "";
  const lines = [
    `今天是 ${today}。`,
    mode === "draft"
      ? "用對方指定的語言寫；沒指定就用繁體中文。"
      : "用提問者這一則訊息所使用的語言回答（繁中、簡中、英文、越南文、日文都可能）。" +
        (ui ? `提問者的介面語言是 ${ui}，訊息語言不明時用它。` : ""),
    "以純文字回答：不要用 Markdown 標題、表格、粗體星號或程式碼區塊；需要條列時用「1.」「2.」或「・」。",
    "不要在回答裡附上「AI 生成」之類的聲明，介面已經標示。",
  ];
  if (MODES[mode]) lines.push("", MODES[mode]);
  return lines.join("\n");
}

export function buildRequest(persona, messages, today, uiLang, mode = "chat") {
  return {
    model: MODEL,
    max_tokens: 8000,
    stream: true,
    // 對話不需要深度推理；low 讓回應快，人格與規則都在 system 裡
    output_config: { effort: "low" },
    system: [
      { type: "text", text: persona, cache_control: { type: "ephemeral" } },
      { type: "text", text: runtimeRules(today, uiLang, mode) },
    ],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    // 安全分類器誤擋時自動改由其他模型回答，不讓同仁看到空白
    fallbacks: "default",
  };
}

// ── KMS「Woody 推薦閱讀」導讀（action:'intro'）──
// 用我的口吻寫「為什麼推薦這篇」，五種語言一次產出。用 XML 標籤而不是 JSON：
// 多行文字的換行讓 JSON.parse 一碰就壞（同聊天室翻譯 v1.83 的教訓）。
export const INTRO_LANGS = ["zh-TW", "zh-CN", "en", "vi", "ja"];
export const INTRO_RULES = [
  "【任務：推薦文章導讀】下面是一篇我放在 KMS「Woody 推薦閱讀」裡的文章。請用我的口吻（第一人稱「我」）寫一段給同仁的導讀：",
  "・我為什麼推薦這篇；・它跟我們公司、跟同仁的日常工作有什麼關係（舉一個具體的工作情境）；・讀的時候特別留意哪一點。",
  "150～250 字，一段或兩段，不要條列、不要標題。文章的觀點要歸給原作者，不要說成是我自己的經歷。",
  "不要捏造我沒說過的事；連結我週報裡講過的觀點可以，但不要硬套。",
  "同一段導讀寫成五種語言，各自包在標籤裡，標籤以外不要輸出任何東西：",
  "<zh-TW>繁體中文</zh-TW><zh-CN>简体中文</zh-CN><en>English</en><vi>Tiếng Việt</vi><ja>日本語</ja>",
  "越南文用一致的語域，稱呼同仁用 bạn。",
].join("\n");
export function parseIntro(text) {
  const out = {};
  for (const l of INTRO_LANGS) {
    const m = String(text || "").match(new RegExp(`<${l}>([\\s\\S]*?)</${l}>`));
    const v = m ? m[1].trim() : "";
    if (!v) return null;          // 少一種語言就整份不算（截斷的回覆正是少尾巴那幾個）
    out[l] = v;
  }
  return out;
}
export function introUserText(doc) {
  const tags = Array.isArray(doc.tags) ? doc.tags.join("、") : "";
  return `標題：${doc.title || ""}\n標籤：${tags}\n\n${String(doc.body || "").slice(0, 30000)}`;
}
