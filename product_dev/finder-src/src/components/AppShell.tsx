import { Factory, FolderUp, Menu, ShoppingBag, UploadCloud, X } from "lucide-react";
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
            "whitespace-nowrap rounded-full border px-[9px] py-[4px] text-[11px] font-semibold transition",
            code === active
              ? "border-cyan-400 bg-cyan-400/[.12] text-cyan-400"
              : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-100",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const COMART_MARK = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="302.53125 269.878906 47.6875 24.714844" width="26" height="14" aria-hidden="true">
    <path fill="#ad0004" fillRule="nonzero" d="M336.148438 294.59375 L326.378906 271.554688 L316.542969 294.59375 L302.53125 294.59375 L318.625 269.878906 L334.058594 269.878906 L350.21875 294.59375 Z" />
    <path fill="#ad0004" fillRule="nonzero" d="M326.363281 283.351562 L321.265625 294.5625 L331.425781 294.5625 Z" />
  </svg>
);

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
      {/* 🔴 topbar 尺寸與品牌寫法照 board／admin 的子系統慣例：56px 高、
          COMART 三角標、DM Serif 斜體名稱 ＋ DM Mono 版本。v2.30 之前是 72px
          ＋ 兩行 black 字重的品牌塊，顏色一樣但密度與字重完全是另一套。*/}
      <header className="sticky top-0 z-30 border-b border-slate-700 bg-[#111827]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-2.5 px-4 md:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <a href={productDevHref} className="whitespace-nowrap rounded-[10px] border border-slate-700 px-[11px] py-[5px] text-xs text-slate-300 transition hover:border-slate-500 hover:bg-slate-800">← Product Dev</a>
            <button type="button" className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("menu_open")}><Menu size={20} /></button>
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">{COMART_MARK}</span>
            <span className="truncate font-serif text-[17px] italic tracking-[-.01em] text-slate-100">COMART Product Finder</span>
            <span className="hidden shrink-0 font-mono text-[11px] text-slate-400 opacity-80 sm:inline">v{CPF_VERSION}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3"><div className="hidden lg:block"><LangChips /></div><div className="hidden text-right sm:block"><p className="text-[13px] font-semibold text-slate-100">{profile?.displayName}</p><p className="text-[11px] text-slate-400">{profile?.email}</p></div></div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sticky top-14 hidden h-[calc(100vh-56px)] border-r border-slate-700 bg-[#111827] p-3 lg:flex lg:flex-col">
          <Navigation />
          <div className="mt-auto border-t border-slate-700 pt-3"><p className="px-2.5 text-[11px] leading-5 text-slate-400">{t("side_note")}</p></div>
        </aside>
        <main id="main-content" className="min-w-0 px-4 py-6 md:px-6 lg:px-7"><Outlet /></main>
      </div>
      {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-slate-950/70" aria-label={t("menu_close")} onClick={() => setMobileOpen(false)} /><aside className="relative h-full w-[84%] max-w-xs bg-[#111827] p-3 shadow-2xl"><div className="mb-4 flex items-center justify-between"><p className="font-serif text-[16px] italic text-slate-100">{t("lib_title")}</p><button className="rounded-lg p-2 hover:bg-slate-800" onClick={() => setMobileOpen(false)} aria-label={t("menu_close")}><X size={20} /></button></div><Navigation onNavigate={() => setMobileOpen(false)} /><div className="mt-5 lg:hidden"><LangChips /></div></aside></div>}
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
    return <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) => cn("flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] transition", isActive ? "bg-cyan-400 text-white font-semibold" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100")}><Icon size={16} />{t(item.labelKey)}</NavLink>;
  })}</nav>;
}
