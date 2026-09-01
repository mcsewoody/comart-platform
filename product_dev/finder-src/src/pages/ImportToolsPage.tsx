import { ArrowRight, BrainCircuit, Download, FolderUp, ShieldCheck, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Card, PageHeader } from "../components/ui";

const tools: Array<{ to: string; title: string; description: string; icon: LucideIcon; tone: string }> = [
  { to: "/upload/batch", title: "批次匯入", description: "掃描預設 products 目錄，分批匯入大量新增或變更文件。", icon: FolderUp, tone: "text-cyan-300 bg-cyan-950/60" },
  { to: "/upload/quick", title: "少量上傳", description: "臨時上傳 1～10 份文件，並指定自製品／外購品與分類路徑。", icon: Zap, tone: "text-amber-300 bg-amber-950/60" },
  { to: "/upload/sync", title: "預設目錄補檔", description: "把同事已上傳、但預設目錄缺少的文件安全補回本機。", icon: Download, tone: "text-emerald-300 bg-emerald-950/60" },
  { to: "/upload/analysis", title: "文件分析", description: "查看 AI 佇列狀態並手動啟動 PDF、Office 與圖片分析。", icon: BrainCircuit, tone: "text-violet-300 bg-violet-950/60" },
];

export function ImportToolsPage() {
  const { profile } = useAuth();

  if (!profile?.canUpload) {
    return <Card className="p-8 text-center"><p className="font-black text-white">你尚未列入 Product Finder 上傳者名單</p></Card>;
  }

  return <>
    <PageHeader eyebrow="DOCUMENT TOOLS" title="文件工具" description="每項工作獨立執行；進入需要的功能即可，不會載入其他工具的狀態。" />
    <div className="grid gap-4 md:grid-cols-2">
      {tools.map((tool) => <ToolLink key={tool.to} {...tool} />)}
      {profile.role === "admin" && <ToolLink to="/users" title="Users" description="管理哪些 Platform 使用者可以上傳、批次匯入與補檔。" icon={ShieldCheck} tone="text-fuchsia-300 bg-fuchsia-950/60" />}
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
