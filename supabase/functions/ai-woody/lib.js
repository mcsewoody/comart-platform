// AI Woody：請求驗證與組裝（純函式，抽出來是為了能用 node --test 在本機測 ——
// edge function 本身要有效的 x-session 才跑得起來）。

export const MODEL = "claude-opus-5-5";
export const MAX_TURNS = 60;          // 一個分頁內的對話上限（來回各算一則）
export const MAX_MSG_CHARS = 6000;    // 單則上限
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

// 執行期規則放在人格檔之後（快取斷點之後），所以日期與介面語言每天換也不會讓人格檔的快取失效。
export function runtimeRules(today, uiLang) {
  const ui = UI_LANGS[uiLang] || "";
  return [
    `今天是 ${today}。你的知識只到 2026-10-04 那一期週報。`,
    "用提問者這一則訊息所使用的語言回答（繁中、簡中、英文、越南文、日文都可能）。" +
      (ui ? `提問者的介面語言是 ${ui}，訊息語言不明時用它。` : ""),
    "以純文字回答：不要用 Markdown 標題、表格、粗體星號或程式碼區塊；需要條列時用「1.」「2.」或「・」。",
    "不要在回答裡附上「AI 生成」之類的聲明，介面已經標示。",
  ].join("\n");
}

export function buildRequest(persona, messages, today, uiLang) {
  return {
    model: MODEL,
    max_tokens: 8000,
    stream: true,
    // 對話不需要深度推理；low 讓回應快，人格與規則都在 system 裡
    output_config: { effort: "low" },
    system: [
      { type: "text", text: persona, cache_control: { type: "ephemeral" } },
      { type: "text", text: runtimeRules(today, uiLang) },
    ],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    // 安全分類器誤擋時自動改由其他模型回答，不讓同仁看到空白
    fallbacks: "default",
  };
}
