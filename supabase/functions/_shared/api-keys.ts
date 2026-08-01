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
