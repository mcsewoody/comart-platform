export function namedSecretKey(name: string, legacyEnv = "SB_SERVICE_ROLE_KEY") {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")
    const key = keys?.[name]
    if (typeof key === "string" && key) return key
  } catch {
    // Keep the legacy fallback available during the staged migration.
  }
  return Deno.env.get(legacyEnv) || ""
}

export function elevatedApiHeaders(key: string) {
  const headers: Record<string, string> = { apikey: key }
  // Legacy service_role keys are JWTs. New sb_secret keys must be sent only
  // as apikey or the upstream service will try to parse them as JWTs.
  if (key.split(".").length === 3) headers.Authorization = `Bearer ${key}`
  return headers
}
