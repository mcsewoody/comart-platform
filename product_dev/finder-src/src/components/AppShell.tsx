import { Factory, FolderUp, LogOut, Menu, PackageSearch, ShoppingBag, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { cn } from "../lib/utils";
import { CPF_VERSION } from "../version";
import { Button } from "./ui";

const navigation = [
  { to: "/", label: "自製品文件", icon: Factory, end: true },
  { to: "/buy", label: "外購品文件", icon: ShoppingBag },
  { to: "/upload", label: "批次匯入", icon: FolderUp, editorOnly: true },
];

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { profile, signOut } = useAuth();
  const portalHref = typeof window !== "undefined" && window.location.protocol === "file:" ? "../../index.html" : "/";

  return (
    <div className="min-h-screen bg-[#070b12] text-slate-100">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">跳到主要內容</a>
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#0a111b]/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1600px] items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <a href={portalHref} className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:bg-slate-800">← Portal</a>
            <button type="button" className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="開啟選單"><Menu size={21} /></button>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 text-slate-950"><PackageSearch size={22} /></div>
            <div>
              <p className="text-sm font-black tracking-tight text-white">COMART</p>
              <p className="-mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Product Dev / Document Finder <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-cyan-300">v{CPF_VERSION}</span></p>
            </div>
          </div>
          <div className="hidden text-right sm:block"><p className="text-sm font-semibold text-white">{profile?.displayName}</p><p className="text-xs text-slate-500">{profile?.email}</p></div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="sticky top-[72px] hidden h-[calc(100vh-72px)] border-r border-slate-800 bg-[#0a111b] p-4 lg:flex lg:flex-col">
          <Navigation />
          <div className="mt-auto border-t border-slate-800 pt-4"><p className="mb-3 px-3 text-xs leading-5 text-slate-500">一個結果代表一份原始文件。自製品與外購品完全分開搜尋。</p><Button variant="ghost" className="w-full justify-start" onClick={() => void signOut()}><LogOut size={17} />返回 Platform</Button></div>
        </aside>
        <main id="main-content" className="min-w-0 px-4 py-7 md:px-7 lg:px-9"><Outlet /></main>
      </div>
      {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-slate-950/70" aria-label="關閉選單" onClick={() => setMobileOpen(false)} /><aside className="relative h-full w-[84%] max-w-xs bg-[#0a111b] p-4 shadow-2xl"><div className="mb-5 flex items-center justify-between"><p className="font-black text-white">文件庫</p><button className="rounded-lg p-2 hover:bg-slate-800" onClick={() => setMobileOpen(false)} aria-label="關閉選單"><X size={20} /></button></div><Navigation onNavigate={() => setMobileOpen(false)} /></aside></div>}
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useAuth();
  return <nav aria-label="主要導覽" className="space-y-1">{navigation.map((item) => {
    if (item.editorOnly && !profile?.canUpload) return null;
    const Icon = item.icon;
    return <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) => cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition", isActive ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:bg-slate-800 hover:text-white")}><Icon size={18} />{item.label}</NavLink>;
  })}</nav>;
}
