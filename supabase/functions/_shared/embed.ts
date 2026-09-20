// OpenAI embedding 的共用呼叫（text-embedding-3-small）。
//
// 🔴 這個檔案存在的唯一理由是一個踩過的坑：**8192 是 token 上限，不是字元上限。**
//    原本 embed-document 與批次補齊都寫 `text.slice(0, 8000)`，那對英文沒事
//    （約 0.25 token/字元，8000 字元 ≈ 2000 token），但**中文大約 1 token 一個字**，
//    所以 8000 字的中文 ≈ 8000+ token，直接被 API 回
//    `Invalid 'input': maximum context length is 8192 tokens.`。
//    2026-09-21 批次補齊向量時，幾十份中文法規／專利說明書全部這樣失敗 ——
//    而同一段程式碼也在**存檔那條路**上，所以那些文件從一開始就嵌不進去。
//
// 🔴 做法是「估一個起點 ＋ 撞到就縮短重試」，不是把常數調小了事：
//    調小會讓英文文件白白少嵌一半內容，而估算永遠會有猜錯的一天
//    （罕見漢字、日文、越南文的 token 比例都不同）。讓 API 自己告訴我們太長，
//    比任何估算都準。
//
// ⚠️ 已知且接受的限制：一份文件只有**一個**向量，所以超長文件只有開頭那一段
//    進得了語意搜尋。要完整覆蓋得改成分段多向量（schema 要改），目前不做 ——
//    關鍵字搜尋仍然涵蓋全文。

const API = "https://api.openai.com/v1/embeddings"
const MODEL = "text-embedding-3-small"
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g

/** 依 CJK 比例估一個安全的起始字元數（只是起點，錯了會自動縮短重試）。 */
export function startBudget(text: string): number {
  const cjk = (text.match(CJK) || []).length
  const ratio = cjk / Math.max(1, text.length)
  // CJK 約 1 token/字 → 給 5,000 字（≈5,000–6,500 token，離 8,192 還有餘裕）
  // 拉丁字母約 0.25 token/字元 → 8,000 字元 ≈ 2,000 token，很安全
  return ratio > 0.2 ? 5000 : 8000
}

export async function embedText(text: string, apiKey: string): Promise<number[]> {
  let budget = startBudget(text)
  let lastMsg = ""
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({ input: text.slice(0, budget), model: MODEL }),
    })
    const data = await res.json().catch(() => ({}))
    const emb = data?.data?.[0]?.embedding
    if (Array.isArray(emb) && emb.length) return emb
    lastMsg = String(data?.error?.message || `HTTP ${res.status}`)
    // 🔴 只有「太長」才值得縮短重試。金鑰錯、額度用完、服務中斷都不會因為
    //    內容變短而變好 —— 那時候重試只是把同一個錯誤再犯三次
    if (!/maximum context length|too long|too many tokens|reduce/i.test(lastMsg)) break
    budget = Math.floor(budget * 0.6)
    if (budget < 300) break
  }
  throw new Error(lastMsg || "no embedding returned")
}
