export interface PlatformSession {
  empId: string;
  nameEn?: string;
  nameZh?: string;
  role: string;
  email?: string;
  site?: string;
  expires?: number;
  sig: string;
}

const SESSION_KEY = "comart-portal-session";

function decodePortalPayload(value: string): PlatformSession | null {
  try {
    const decoded = decodeURIComponent(escape(atob(value)));
    return JSON.parse(decoded) as PlatformSession;
  } catch {
    return null;
  }
}

export function getPlatformSession(): PlatformSession | null {
  const params = new URLSearchParams(window.location.search);
  const incoming = params.get("_ps");
  const parsedIncoming = incoming ? decodePortalPayload(incoming) : null;
  if (parsedIncoming?.empId && parsedIncoming.sig) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(parsedIncoming));
    } catch {
      // The in-memory value still lets the current navigation continue.
    }
    params.delete("_ps");
    params.delete("_portal");
    const cleanQuery = params.toString();
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${window.location.hash}`,
    );
    return parsedIncoming;
  }

  try {
    const stored = JSON.parse(
      localStorage.getItem(SESSION_KEY) ?? "null",
    ) as PlatformSession | null;
    if (
      !stored?.empId ||
      !stored.sig ||
      (stored.expires && Date.now() > stored.expires)
    ) {
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

export function platformHomeUrl() {
  return `${window.location.origin}/index.html`;
}
