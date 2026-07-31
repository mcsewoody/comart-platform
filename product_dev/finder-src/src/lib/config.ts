const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL?.trim() ??
  "https://tcvlnpgpuphdalzvmoyo.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

export const appConfig = {
  supabaseUrl,
  supabaseAnonKey,
  platformMode: import.meta.env.VITE_PLATFORM_MODE === "true",
  platformApiUrl: `${supabaseUrl}/functions/v1/cpf-platform-api`,
  demoMode:
    import.meta.env.VITE_DEMO_MODE === "true" ||
    (!supabaseAnonKey && import.meta.env.VITE_PLATFORM_MODE !== "true"),
  sourceBucket: "cpf_source",
  previewBucket: "cpf_preview",
  thumbnailBucket: "cpf_thumbnail",
  sessionDays: 7,
} as const;
