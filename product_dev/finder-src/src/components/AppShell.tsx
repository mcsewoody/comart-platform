import { Factory, FolderUp, Menu, PackageSearch, ShoppingBag, UploadCloud, X } from "lucide-react";
import { useState } from "react";
import { LANGS, getLang, setLang, useT } from "../i18n";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { cn } from "../lib/utils";
import { CPF_VERSION } from "../version";

// 🔴 存 key 不存文案：切語言時整個模組不會重新求值，存死字串就換不掉了
const navigation = [
  { to: "/", labelKey: "nav_mfg", icon: Factory, end: true },
  { to: "/buy", labelKey: "nav_buy", icon: ShoppingBag },
  { to: "/manual-upload", labelKey: "nav_manual_upload", icon: UploadCloud, uploadOnly: true },
  { to: "/upload", labelKey: "nav_tools", icon: FolderUp, toolAccessOnly: true },
];

/** 語言鈕：樣式與其他系統的 .lchip 一致（圓角膠囊、選中反藍）。 */
function LangChips() {
  const t = useT();
  const active = getLang();
  return (
    <div className="flex items-center gap-1" aria-label={t("nav_aria")}>
      {LANGS.map(([code, label]) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          className={cn(
            "whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
            code === active
              ? "border-cyan-400 bg-cyan-950 text-cyan-300"
              : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function AppShell() {
  const t = useT();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { profile } = useAuth();
  const productDevHref = typeof window !== "undefined" && window.location.protocol === "file:"
    ? "../index.html"
    : "/product_dev/index.html";

  return (
    <div className="min-h-screen bg-[#0A0E17] text-slate-100">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">{t("skip_main")}</a>
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#111827]/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1600px] items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <a href={productDevHref} className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:bg-slate-800">← Product Dev</a>
            <button type="button" className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("menu_open")}><Menu size={21} /></button>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 text-white"><PackageSearch size={22} /></div>
            <div>
              <p className="text-sm font-black tracking-tight text-white">COMART</p>
              <p className="-mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Product Dev / Document Finder <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-cyan-300">v{CPF_VERSION}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-4"><div className="hidden lg:block"><LangChips /></div><div className="hidden text-right sm:block"><p className="text-sm font-semibold text-white">{profile?.displayName}</p><p className="text-xs text-slate-500">{profile?.email}</p></div></div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="sticky top-[72px] hidden h-[calc(100vh-72px)] border-r border-slate-800 bg-[#111827] p-4 lg:flex lg:flex-col">
          <Navigation />
          <div className="mt-auto border-t border-slate-800 pt-4"><p className="px-3 text-xs leading-5 text-slate-500">{t("side_note")}</p></div>
        </aside>
        <main id="main-content" className="min-w-0 px-4 py-7 md:px-7 lg:px-9"><Outlet /></main>
      </div>
      {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-slate-950/70" aria-label={t("menu_close")} onClick={() => setMobileOpen(false)} /><aside className="relative h-full w-[84%] max-w-xs bg-[#111827] p-4 shadow-2xl"><div className="mb-5 flex items-center justify-between"><p className="font-black text-white">{t("lib_title")}</p><button className="rounded-lg p-2 hover:bg-slate-800" onClick={() => setMobileOpen(false)} aria-label={t("menu_close")}><X size={20} /></button></div><Navigation onNavigate={() => setMobileOpen(false)} /><div className="mt-5 lg:hidden"><LangChips /></div></aside></div>}
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const { profile } = useAuth();
  return <nav aria-label={t("nav_aria")} className="space-y-1">{navigation.map((item) => {
    if (item.uploadOnly && !profile?.canUpload) return null;
    if (item.toolAccessOnly && !profile?.canUpload && !profile?.canSync) return null;
    const Icon = item.icon;
    return <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) => cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition", isActive ? "bg-cyan-400 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white")}><Icon size={18} />{t(item.labelKey)}</NavLink>;
  })}</nav>;
}
