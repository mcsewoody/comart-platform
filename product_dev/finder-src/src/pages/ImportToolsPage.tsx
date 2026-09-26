import { ArrowRight, BrainCircuit, Download, FolderUp, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useT } from "../i18n";
import { Card, PageHeader } from "../components/ui";

/* 🔴 存 key 不存文案：這個陣列在模組載入時求值一次。*/
const tools: Array<{ to: string; titleKey: string; descKey: string; icon: LucideIcon; tone: string; permission: "upload" | "sync" }> = [
  { to: "/upload/batch", titleKey: "it_batch", descKey: "it_batch_d", icon: FolderUp, tone: "text-cyan-300 bg-cyan-950/60", permission: "upload" },
  { to: "/upload/sync", titleKey: "it_sync", descKey: "it_sync_d", icon: Download, tone: "text-emerald-300 bg-emerald-950/60", permission: "sync" },
  { to: "/upload/analysis", titleKey: "it_analysis", descKey: "it_analysis_d", icon: BrainCircuit, tone: "text-violet-300 bg-violet-950/60", permission: "upload" },
];

export function ImportToolsPage() {
  const t = useT();
  const { profile } = useAuth();

  if (!profile?.canUpload && !profile?.canSync) {
    return <Card className="p-8 text-center"><p className="font-black text-white">{t("it_no_perm")}</p></Card>;
  }

  return <>
    <PageHeader eyebrow="DOCUMENT TOOLS" title={t("it_title")} description={t("it_desc")} />
    <div className="grid gap-4 md:grid-cols-2">
      {tools.filter((tool) => tool.permission === "sync" ? profile.canSync : profile.canUpload).map((tool) => <ToolLink key={tool.to} to={tool.to} title={t(tool.titleKey)} description={t(tool.descKey)} icon={tool.icon} tone={tool.tone} />)}
      {profile.role === "admin" && <ToolLink to="/users" title="Users" description={t("it_users_d")} icon={ShieldCheck} tone="text-fuchsia-300 bg-fuchsia-950/60" />}
    </div>
  </>;
}

function ToolLink({ to, title, description, icon: Icon, tone }: { to: string; title: string; description: string; icon: LucideIcon; tone: string }) {
  return <Link to={to} className="group rounded-2xl border border-slate-800 bg-slate-900/70 p-5 transition hover:-translate-y-0.5 hover:border-cyan-700 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400 md:p-6">
    <div className="flex items-start gap-4">
      <span className={`rounded-xl p-3 ${tone}`}><Icon size={23} /></span>
      <span className="min-w-0 flex-1"><span className="block text-lg font-black text-white">{title}</span><span className="mt-1 block text-sm leading-6 text-slate-400">{description}</span></span>
      <ArrowRight className="mt-2 text-slate-600 transition group-hover:translate-x-1 group-hover:text-cyan-300" size={20} />
    </div>
  </Link>;
}
