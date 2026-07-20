import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { verifySession } from "../_shared/session.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session",
}

// 過渡旗標：前端上線後改 false 再部署（原本無驗證，任何人可耗用 OpenAI 額度）
const GRACE = false

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")
    if (!OPENAI_KEY) return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), { status: 500, headers: CORS })

    const verified = await verifySession(req.headers.get("x-session") || "")
    if (!verified && !GRACE) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS })

    const { text, doc_id } = await req.json()
    if (!text) return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: CORS })

    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + OPENAI_KEY,
      },
      body: JSON.stringify({ input: text.slice(0, 8000), model: "text-embedding-3-small" }),
    })

    const data = await res.json()
    const embedding = data.data?.[0]?.embedding

    if (!embedding) return new Response(JSON.stringify({ error: "no embedding returned" }), { status: 500, headers: CORS })

    return new Response(JSON.stringify({ embedding, doc_id }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS })
  }
})
