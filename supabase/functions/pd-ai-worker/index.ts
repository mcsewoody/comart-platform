import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function outputText(response: Record<string, any>) {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text
    }
  }
  return ""
}

function namedSecretKey(name: string) {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")
    return typeof keys?.[name] === "string" ? keys[name] : ""
  } catch {
    return ""
  }
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const currentSecretKey = namedSecretKey("cpf_worker")
  const suppliedApiKey = req.headers.get("apikey") || ""
  if (!currentSecretKey) return json({ error: "worker_key_not_configured" }, 500)
  if (suppliedApiKey !== currentSecretKey) return json({ error: "unauthorized" }, 401)

  const openaiKey = Deno.env.get("OPENAI_API_KEY") || ""
  if (!openaiKey) return json({ error: "openai_not_configured" }, 500)

  try {
    const body = await req.json()
    const headers = {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    }

    if (body.action === "analyze") {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: body.model,
          input: [
            { role: "system", content: body.systemPrompt },
            { role: "user", content: body.content },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "pd_document_extraction",
              strict: true,
              schema: body.schema,
            },
          },
          reasoning: { effort: "low" },
          max_output_tokens: 24000,
          store: false,
          safety_identifier: "pd-internal-worker",
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        return json({
          error: "openai_error",
          status: response.status,
          detail: result?.error?.message || "unknown_error",
        }, 502)
      }
      const text = outputText(result)
      if (!text) return json({ error: "empty_model_output" }, 502)
      return json({
        extraction: JSON.parse(text),
        usage: result.usage || {},
        responseId: result.id || null,
      })
    }

    if (body.action === "embed") {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: body.model,
          input: body.input,
          encoding_format: "float",
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        return json({
          error: "openai_error",
          status: response.status,
          detail: result?.error?.message || "unknown_error",
        }, 502)
      }
      return json({
        embedding: result?.data?.[0]?.embedding || [],
        usage: result.usage || {},
      })
    }

    return json({ error: "unknown_action" }, 400)
  } catch (error) {
    return json({
      error: "worker_proxy_failed",
      detail: error instanceof Error ? error.message : String(error),
    }, 500)
  }
})
