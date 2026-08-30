import { Download, File, Folder, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Card, EmptyState } from "../components/ui";
import { api } from "../lib/api";
import type { PdDataset, PdDocumentDetail } from "../lib/types";

export function PdDocumentDetailPage() {
  const params = useParams();
  const dataset: PdDataset = params.dataset === "buy" ? "buy" : "mfg";
  const [item, setItem] = useState<PdDocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.id) return;
    setLoading(true);
    void api.getPdDocument(dataset, params.id)
      .then((result) => setItem(result))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "讀取失敗"))
      .finally(() => setLoading(false));
  }, [dataset, params.id]);

  if (loading) return <div className="flex min-h-64 items-center justify-center text-slate-400"><LoaderCircle className="mr-2 animate-spin" />讀取文件…</div>;
  if (error || !item) return <EmptyState icon={<File />} title="找不到文件" description={error || "文件可能尚未匯入或已移除。"} />;
  const isImage = ["jpg", "jpeg", "png"].includes(item.extension);

  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Link to={dataset === "mfg" ? "/" : "/buy"} className="text-sm font-semibold text-slate-400 hover:text-white">← 回到{dataset === "mfg" ? "自製品" : "外購品"}搜尋</Link>
      {item.sourceUrl && <a href={item.sourceUrl} download className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-400 px-5 text-sm font-black text-slate-950 hover:bg-cyan-300"><Download size={18} />下載原檔</a>}
    </div>
    <header className="mb-6"><div className="flex flex-wrap gap-2"><Badge tone="accent">{item.documentKind}</Badge><Badge>{item.extension.toUpperCase()}</Badge>{item.isReference && <Badge tone="warning">參考資料</Badge>}</div><h1 className="mt-3 break-words text-2xl font-black text-white md:text-4xl">{item.title}</h1><p className="mt-2 break-all text-sm text-slate-500">{item.relativePath}</p></header>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-h-[560px] overflow-hidden">
        <div className="border-b border-slate-700 px-5 py-4 font-bold text-white">文件預覽</div>
        {item.previewUrl ? isImage ? <div className="flex min-h-[500px] items-center justify-center bg-slate-950 p-4"><img src={item.previewUrl} alt={item.title} className="max-h-[72vh] max-w-full object-contain" /></div> : <iframe title={item.title} src={item.previewUrl} className="h-[72vh] min-h-[540px] w-full border-0 bg-slate-950" /> : <div className="flex min-h-[500px] flex-col items-center justify-center p-8 text-center"><File size={42} className="text-slate-600" /><p className="mt-4 font-bold text-slate-300">此格式沒有線上預覽</p><p className="mt-2 text-sm text-slate-500">STP、STEP、DWG、DXF 及尚未轉檔的 Office 文件請下載原檔查看。</p></div>}
      </Card>
      <aside className="space-y-4"><Card className="p-5"><h2 className="font-black text-white">文件資訊</h2><dl className="mt-4 space-y-4 text-sm"><Info label={dataset === "mfg" ? "來源工廠" : "廠商"} value={item.sourceFactory || item.supplierName || "未標示"} /><Info label="分類路徑" value={item.pathLabels.join(" › ") || "未分類"} /><Info label="檔案大小" value={formatBytes(item.byteSize)} /><Info label="索引狀態" value={item.analysisStatus === "completed" ? "內容已分析" : item.analysisStatus === "metadata_only" ? "僅檔案資訊" : "等待內容分析"} /></dl></Card><Card className="p-5"><div className="flex items-center gap-2 font-black text-white"><Folder size={18} className="text-cyan-300" />搜尋關鍵字</div><div className="mt-3 flex flex-wrap gap-2">{item.keywords.slice(0, 16).map((keyword) => <Badge key={keyword}>{keyword}</Badge>)}</div></Card></aside>
    </div>
  </>;
}

function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-200">{value}</dd></div>; }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
