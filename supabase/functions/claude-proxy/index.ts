import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { verifySession } from "../_shared/session.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session",
}

// 過渡旗標：true = 暫時放行未帶 session 的請求（部署新前端期間），前端上線後改 false。
// 原本此函式完全無驗證，任何人可用公司的 Claude API 額度（2026-07-20 修復）
const GRACE = false

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const CLAUDE_KEY = Deno.env.get("CLAUDE_API_KEY")
    if (!CLAUDE_KEY) return new Response(JSON.stringify({ error: "CLAUDE_API_KEY not set" }), { status: 500, headers: CORS })

    const verified = await verifySession(req.headers.get("x-session") || "")
    if (!verified && !GRACE) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS })

    const body = await req.json()

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    })

    // stream:true → 直接把上游 SSE 轉發給前端。長輸出（如 board 的 AI 評論與總結，
    // opus-5 + thinking 動輒數十秒到數分鐘）若等 Anthropic 全部產生完才回應，
    // 這個 function 會被 gateway 判定逾時回 504（2026-08-08 實際踩到）。
    // 串流讓資料持續流動，連線就不會被中斷。非串流呼叫端（KMS/Portal/quotation）行為不變。
    if (body && body.stream === true) {
      return new Response(res.body, {
        status: res.status,
        headers: {
          ...CORS,
          "Content-Type": res.headers.get("content-type") || "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      })
    }

    const data = await res.json()
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS })
  }
})
