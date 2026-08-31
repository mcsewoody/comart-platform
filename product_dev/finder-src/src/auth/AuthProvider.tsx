import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { appConfig } from "../lib/config";
import {
  getPlatformSession,
  platformHomeUrl,
  type PlatformSession,
} from "../lib/platform-session";
import type { Profile } from "../lib/types";

interface AuthContextValue {
  loading: boolean;
  session: PlatformSession | null;
  profile: Profile | null;
  demoMode: boolean;
  signIn(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const demoProfile: Profile = {
  id: "demo-user",
  email: "woody@comart.com.tw",
  displayName: "Woody",
  role: "admin",
  active: true,
  canUpload: true,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(!appConfig.demoMode);
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(
    appConfig.demoMode ? demoProfile : null,
  );

  useEffect(() => {
    if (appConfig.demoMode) return;
    const nextSession = getPlatformSession();
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
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      profile,
      demoMode: appConfig.demoMode,
      async signIn() {
        window.location.href = platformHomeUrl();
      },
      async signOut() {
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
