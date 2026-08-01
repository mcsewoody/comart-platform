import {
  ArchiveRestore,
  Boxes,
  ChevronDown,
  Files,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import type { UserRole } from "../lib/types";
import { cn } from "../lib/utils";
import { CPF_VERSION } from "../version";
import { Badge, Button } from "./ui";

const navigation: Array<{
  to: string;
  label: string;
  icon: typeof Search;
  end?: boolean;
  desktopOnly?: boolean;
  minimumRole?: UserRole;
}> = [
  { to: "/", label: "產品搜尋", icon: Search, end: true },
  { to: "/documents", label: "文件搜尋", icon: Files },
  {
    to: "/upload",
    label: "上傳與進度",
    icon: UploadCloud,
    desktopOnly: true,
    minimumRole: "editor",
  },
  {
    to: "/review",
    label: "AI 例外",
    icon: ShieldCheck,
    desktopOnly: true,
    minimumRole: "editor",
  },
  {
    to: "/admin",
    label: "管理",
    icon: Settings,
    desktopOnly: true,
    minimumRole: "admin",
  },
];

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { profile, demoMode, signOut } = useAuth();
  const portalHref =
    typeof window !== "undefined" && window.location.protocol === "file:"
      ? "../../index.html"
      : "/";

  return (
    <div className="min-h-screen bg-[#070b12] text-slate-100">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        跳到主要內容
      </a>

      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#0a111b]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <a
              href={portalHref}
              className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white sm:px-3 sm:py-2 sm:text-sm"
              aria-label="返回 Portal"
            >
              <span aria-hidden="true">←</span>
              Portal
            </a>
            <button
              type="button"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="開啟選單"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400 text-slate-950">
              <Boxes size={20} strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-sm font-black tracking-tight text-slate-950">
                COMART
              </p>
              <p className="-mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Product Dev / Product Finder
                <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] tracking-normal text-cyan-300">
                  v{CPF_VERSION}
                </span>
              </p>
            </div>
            {demoMode && <Badge tone="warning">Demo</Badge>}
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-slate-900">
                {profile?.displayName}
              </p>
              <p className="text-xs text-slate-500">{profile?.email}</p>
            </div>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-black text-slate-700"
              aria-label="使用者選單"
            >
              {profile?.displayName.slice(0, 1).toUpperCase()}
            </button>
            <ChevronDown className="hidden text-slate-400 sm:block" size={16} />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] border-r border-slate-800 bg-[#0a111b] p-4 lg:flex lg:flex-col">
          <Navigation />
          <div className="mt-auto border-t border-slate-200 pt-4">
            <div className="mb-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
              <p className="text-xs font-bold text-slate-700">資料權限</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {profile?.role === "admin"
                  ? "管理員 · 全部敏感等級"
                  : profile?.role === "editor"
                    ? "編輯者 · 一般與商業敏感"
                    : "查詢者 · 一般資料"}
              </p>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => void signOut()}
            >
              <LogOut size={17} />
              返回 Platform
            </Button>
          </div>
        </aside>

        <main id="main-content" className="min-w-0 px-4 py-7 md:px-7 lg:px-9">
          <Outlet />
        </main>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-slate-950/35"
            aria-label="關閉選單"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative h-full w-[84%] max-w-xs bg-[#0a111b] p-4 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <p className="font-black text-slate-950">功能選單</p>
              <button
                className="rounded-lg p-2 hover:bg-slate-100"
                onClick={() => setMobileOpen(false)}
                aria-label="關閉選單"
              >
                <X size={20} />
              </button>
            </div>
            <Navigation mobile onNavigate={() => setMobileOpen(false)} />
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              手機版僅支援搜尋、查看與下載。上傳、審核和管理請改用桌機或平板。
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Navigation({
  mobile,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const { profile } = useAuth();
  const roleRank: Record<UserRole, number> = {
    viewer: 0,
    editor: 1,
    admin: 2,
  };
  return (
    <nav aria-label="主要導覽" className="space-y-1">
      {navigation.map((item) => {
        const Icon = item.icon;
        if (mobile && item.desktopOnly) return null;
        if (
          item.minimumRole &&
          (!profile || roleRank[profile.role] < roleRank[item.minimumRole])
        ) {
          return null;
        }
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                isActive
                  ? "bg-cyan-400 text-slate-950 shadow-sm"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white",
              )
            }
          >
            <Icon size={18} />
            {item.label}
          </NavLink>
        );
      })}
      {!mobile && profile?.role === "admin" && (
        <NavLink
          to="/admin/trash"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
              isActive
                ? "bg-cyan-400 text-slate-950"
                : "text-slate-400 hover:bg-slate-800",
            )
          }
        >
          <ArchiveRestore size={18} />
          垃圾桶
        </NavLink>
      )}
    </nav>
  );
}
