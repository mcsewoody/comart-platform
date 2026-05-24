const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = new URL(req.url);
    const year = url.searchParams.get("year") || String(new Date().getFullYear());
    const cc   = (url.searchParams.get("countryCode") || "TW").toUpperCase();

    const apiUrl = "https://date.nager.at/api/v3/publicholidays/" + year + "/" + cc;
    const res    = await fetch(apiUrl, { headers: { "Accept": "application/json" } });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "upstream", status: res.status }), {
        status: 502, headers: CORS,
      });
    }

    const text = await res.text();
    return new Response(text || "[]", {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "max-age=86400" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
