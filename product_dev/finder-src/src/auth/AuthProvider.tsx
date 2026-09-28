import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { appConfig } from "../lib/config";
import { setSessionLostHandler } from "../lib/api";
import { initLang } from "../i18n";
import {
  clearPlatformSession,
  getPlatformSession,
  platformHomeUrl,
  type PlatformSession,
} from "../lib/platform-session";
import type { Profile } from "../lib/types";

interface AuthContextValue {
  loading: boolean;
  session: PlatformSession | null;
  profile: Profile | null;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  /* 🔴 session 中途失效時把人送回登入轉接頁，而不是讓每一次呼叫各自丟錯。
     掛在自己的 effect 裡（不是下面那個 bootstrap effect），因為 StrictMode
     會把 effect 跑兩次，混在一起會在第一次 cleanup 時把 handler 解除掉。 */
  useEffect(() => {
    setSessionLostHandler(() => {
      clearPlatformSession();
      setSession(null);
      setProfile(null);
    });
    return () => setSessionLostHandler(null);
  }, []);

  useEffect(() => {
    const nextSession = getPlatformSession();
    /* 🔴 語言要在取 session 之後、打 API 之前就定下來：擺在 bootstrap 回應之後的話，
       後端不通時整個畫面會停在繁中（devices v1.10 踩過同一個坑）。
       沒有 session 也要 initLang()，否則登入頁不會跟著 Portal 的語言。 */
    initLang(nextSession?.site);
    if (!nextSession) {
      setLoading(false);
      return;
    }
    setSession(nextSession);
    fetch(appConfig.platformApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session": nextSession.sig,
      },
      body: JSON.stringify({ action: "bootstrap" }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("platform_session_invalid");
        return response.json() as Promise<{ profile: Profile }>;
      })
      .then((result) => setProfile(result.profile))
      .catch(() => {
        clearPlatformSession();
        setProfile(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      profile,
      async signIn() {
        window.location.href = platformHomeUrl();
      },
      async signOut() {
        clearPlatformSession();
        window.location.href = platformHomeUrl();
      },
    }),
    [loading, profile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The provider and its hook intentionally share one module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
