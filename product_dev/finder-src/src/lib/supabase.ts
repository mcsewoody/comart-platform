import { createClient } from "@supabase/supabase-js";
import { appConfig } from "./config";

export const supabase = appConfig.demoMode
  ? null
  : createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "cpf-auth",
      },
    });
