import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const url = new URL(req.url)
    const year        = url.searchParams.get("year")        || new Date().getFullYear().toString()
    const countryCode = url.searchParams.get("countryCode") || "TW"

    // Validate inputs
    if (!/^\d{4}$/.test(year)) {
      return new Response(JSON.stringify({ error: "Invalid year" }), { status: 400, headers: CORS })
    }
    if (!/^[A-Z]{2}$/.test(countryCode.toUpperCase())) {
      return new Response(JSON.stringify({ error: "Invalid countryCode" }), { status: 400, headers: CORS })
    }

    const apiUrl = `https://date.nager.at/api/v3/publicholidays/${year}/${countryCode.toUpperCase()}`
    const res    = await fetch(apiUrl, {
      headers: { "Accept": "application/json" }
    })

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: "Holiday API error", status: res.status }),
        { status: res.status, headers: CORS }
      )
    }

    const data = await res.json()
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "max-age=86400" }
    })

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS })
  }
})
