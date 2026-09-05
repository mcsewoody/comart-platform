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

// 🔴 詞彙提示：這正是瀏覽器內建引擎做不到、而使用者抱怨「辨識效果不佳」的部分。
//    只列**會被聽錯的專有名詞**，不要塞一般詞彙 —— 提示過長反而會讓模型
//    把提示裡的詞硬套進不相關的句子。
const VOCAB = [
  "COMART", "TIPTOP", "PLM", "ERP", "Qi2", "MagSafe",
  "東莞廠", "越南廠", "台灣營運中心",
  "報價單", "出貨", "打樣", "開模", "驗貨", "櫃號", "工單", "料號",
].join("、")

const LANGS = new Set(["zh", "en", "vi", "ja"])

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
    fd.append("model", "gpt-4o-transcribe")
    fd.append("prompt", VOCAB)
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
    return json({ text: String(data.text || "").trim() })
  } catch (e) {
    console.error("[transcribe]", e)
    return json({ error: "exception", message: String((e as Error)?.message || e) }, 500)
  }
})
