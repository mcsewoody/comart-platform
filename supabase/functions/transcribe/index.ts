// ═══════════════════════════════════════════════════════════════════════
// transcribe — 語音轉文字（線上對話的語音輸入）
//
// 🔴 **為什麼不用瀏覽器內建的 Web Speech API**（v1.85 之前的做法）：
//    ① 品質改不了 —— 引擎是瀏覽器給的，無法提供詞彙表，
//       產品型號、TIPTOP、工號一律辨識不出來。
//    ② **Chrome 的 Web Speech 把音訊送到 Google 的伺服器，而 Google 被 GFW 封鎖**，
//       東莞廠根本用不了。
//    改成伺服器端轉寫之後，**瀏覽器只跟 Supabase 說話**，音訊由這個 function
//    從機房發給 OpenAI —— GFW 完全不相干。這是這個改動最重要的一點。
//
// 🔴 Claude 不吃音訊輸入（只有文字／圖片／PDF），所以這裡不能用 claude-proxy。
//    這是本 repo 唯一呼叫 OpenAI 的 platform 端 function。
// ═══════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { verifySession } from "../_shared/session.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-session, x-audio-type, x-audio-lang",
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

// OpenAI 的上限是 25MB。這裡壓到 12MB：opus 約 1MB/分鐘，12 分鐘的獨白
// 遠超過聊天室的用途，而更大的檔案只會讓使用者等很久才發現失敗。
const MAX_BYTES = 12 * 1024 * 1024

// MediaRecorder 在不同瀏覽器產出不同容器：Chrome/Edge 是 webm(opus)、
// Safari 是 mp4(aac)。OpenAI 靠**副檔名**判斷格式，所以要對應正確，不能一律寫 .webm。
const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-m4a": "m4a",
}

/* 🔴 **prompt 必須是「有標點的完整句子」，不能是逗號串起來的詞彙表。**
   whisper-1 的 prompt 不是指令，是「前一段逐字稿」——模型會**模仿它的風格**，
   包含標點習慣。v1 版的 prompt 是 `COMART、TIPTOP、PLM、…` 這種沒有句號的
   詞彙串，於是輸出也跟著幾乎不標點，這就是使用者說「標點符號不太行」的原因。
   同時它完全沒有把模型帶離 YouTube 字幕的語境，而 Whisper 是用 YouTube 影片
   訓練的 —— 音訊一有問題就會冒出「感謝大家收看」那類樣板句。
   現在這段本身就是標點齊全的中文句子，同時交代了場景與可能出現的術語。 */
const VOCAB =
  "以下是台灣、東莞廠與越南廠同事的內部工作錄音，內容多與訂單、出貨、" +
  "打樣、開模、驗貨、櫃號、工單與料號有關。可能會提到 COMART、TIPTOP、PLM、" +
  "ERP、Qi2、MagSafe 等名稱。請逐字記錄，並加上正確的標點符號。"

const LANGS = new Set(["zh", "en", "vi", "ja"])

/* 🔴 Whisper 的樣板幻覺。它是用 YouTube 影片與字幕訓練的，收到近似無聲或
   無法解碼的音訊時會「填入」訓練資料裡最常見的句子。實際踩到的是
   「以上是本期視頻的全部內容，感謝大家收看，我們下次再見。」——
   使用者講了一整段，拿到的卻只有這句。
   前端已先用音量擋掉全靜音（shared/voice.js 的 SILENCE_RMS），這裡是第二道：
   **整段輸出幾乎只有樣板句時就當成沒收到**，回 hallucination:true 讓前端
   顯示「這段錄音幾乎沒有聲音」，而不是把這句話塞進使用者的週報。
   ⚠️ 只比對「整段幾乎等於樣板」，不做關鍵字包含判斷 —— 有人真的講
   「感謝大家收看」時不該被吞掉。 */
const HALLUCINATIONS = [
  "以上是本期視頻的全部內容感謝大家收看我們下次再見",
  "以上就是本期視頻的全部內容感謝大家收看我們下次再見",
  "感謝大家收看我們下次再見",
  "謝謝大家收看下次再見",
  "字幕由amaraorg社群提供",
  "字幕志願者",
  "請不吝點贊訂閱轉發打賞支持明鏡與點點欄目",
  "thankyouforwatching",
  "thanksforwatching",
  "thankyouforwatchingandseeyouinthenextvideo",
  "pleasesubscribetomychannel",
  "subtitlesbytheamaraorgcommunity",
]

// 去掉標點、空白與大小寫差異之後再比，才不會被「，」「。」的有無騙過
function normalizeForHalluc(t: string): string {
  return t.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "")
}

function looksHallucinated(text: string): boolean {
  const n = normalizeForHalluc(text)
  if (!n) return false
  // 只有「整段就是樣板」才算。長一點的內容裡剛好包含這句話是正常發言。
  if (n.length > 60) return false
  return HALLUCINATIONS.some((h) => n === h || (h.length >= 10 && n.startsWith(h) && n.length < h.length * 1.3))
}

/* 🔴 **模型必須是 whisper-1，不要換成 gpt-4o-transcribe**（v1.87 改回）。
   使用者回報「語音輸入不完整，只擷取最後一段文字」，根因是：
   **gpt-4o-transcribe 依賴音檔 metadata 判斷時長，whisper-1 不依賴** ——
   而 MediaRecorder 產出的是「串流式 webm」，是邊錄邊寫的，
   **header 裡沒有時長資訊**（錄的時候還不知道會錄多久，寫不進去）。
   模型讀不到正確時長就只處理到一小段，於是回來的文字缺頭。
   OpenAI 社群另有大量「gpt-4o-transcribe 截斷」的回報（停頓處就斷、
   8–9 分鐘後截斷），不是我們這邊的個案。
   一般情境下 gpt-4o-transcribe 的準確度較高，但**缺頭的逐字稿是沒有用的**，
   正確性優先於準確度。要改回去之前，先確認前端能產出帶正確時長的音檔。 */
const MODEL = "whisper-1"

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  try {
    const KEY = Deno.env.get("OPENAI_API_KEY")
    if (!KEY) return json({ error: "OPENAI_API_KEY not set" }, 500)

    // 與 claude-proxy 同一套驗證：沒有有效簽章就不給用公司的額度
    const verified = await verifySession(req.headers.get("x-session") || "")
    if (!verified) return json({ error: "unauthorized" }, 401)

    const mime = (req.headers.get("x-audio-type") || "audio/webm").split(";")[0].trim()
    const ext = EXT[mime]
    if (!ext) return json({ error: "unsupported audio type", mime }, 415)

    const buf = new Uint8Array(await req.arrayBuffer())
    if (!buf.length) return json({ error: "empty audio" }, 400)
    if (buf.length > MAX_BYTES) return json({ error: "audio too large", bytes: buf.length }, 413)

    const fd = new FormData()
    fd.append("file", new File([buf], `audio.${ext}`, { type: mime }))
    fd.append("model", MODEL)
    // whisper-1 的 prompt 是「文字前綴提示」（上限約 224 token），
    // 逗號分隔的專有名詞表正是官方建議的偏置方式 —— 比 gpt-4o-transcribe
    // 把 prompt 當指令的行為更可預測。
    fd.append("prompt", VOCAB)
    fd.append("temperature", "0")
    // 語言留空 = 由模型自行判斷（使用者要的「AI 辨識」）。
    // 帶了就當提示用，能明顯提升同音字的準確度。
    const lang = (req.headers.get("x-audio-lang") || "").trim()
    if (lang && LANGS.has(lang)) fd.append("language", lang)

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}` },
      body: fd,
    })

    if (!res.ok) {
      const txt = await res.text()
      // 不要把上游的原文整段回前端（可能含金鑰相關訊息），只留狀態與前 200 字供診斷
      console.error("[transcribe] upstream", res.status, txt.slice(0, 500))
      return json({ error: "transcription failed", status: res.status, detail: txt.slice(0, 200) }, 502)
    }

    const data = await res.json()
    const text = String(data.text || "").trim()
    if (looksHallucinated(text)) {
      console.warn("[transcribe] 樣板幻覺，已丟棄:", text.slice(0, 80))
      return json({ text: "", hallucination: true, bytes: buf.length, mime, model: MODEL, chars: 0 })
    }
    /* 🔴 回傳 bytes／mime／chars 是刻意的診斷資訊：
       下次再有人說「不完整」，比對前端的 blob 大小與這裡的 bytes 就能分辨是
       「上傳的音訊本身不全」（前端問題）還是「音訊完整但文字短」（模型截斷）。
       上一輪就是缺這個判據，只能靠猜。 */
    return json({ text, bytes: buf.length, mime, model: MODEL, chars: text.length })
  } catch (e) {
    console.error("[transcribe]", e)
    return json({ error: "exception", message: String((e as Error)?.message || e) }, 500)
  }
})
