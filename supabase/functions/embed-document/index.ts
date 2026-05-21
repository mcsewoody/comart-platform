import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")
    if (!OPENAI_KEY) return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), { status: 500, headers: CORS })

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
