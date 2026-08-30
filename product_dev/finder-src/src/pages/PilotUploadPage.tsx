import { CheckCircle2, FolderOpen, LoaderCircle, UploadCloud } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { useAuth } from "../auth/AuthProvider";
import { api } from "../lib/api";
import type { PdDataset } from "../lib/types";

type PilotFile = { file: File; dataset: PdDataset; relativePath: string; status: string };

const ALLOWED = new Set(["jpg", "jpeg", "png", "pdf", "ppt", "pptx", "xls", "xlsx", "doc", "docx", "stp", "step", "dwg", "dxf"]);
const MAX_PILOT_BYTES = 100 * 1024 * 1024;

export function PilotUploadPage() {
  const { profile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PilotFile[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const mfg = useMemo(() => files.filter((item) => item.dataset === "mfg"), [files]);
  const buy = useMemo(() => files.filter((item) => item.dataset === "buy"), [files]);

  if (profile?.role === "viewer") {
    return <Card className="p-8 text-center"><p className="font-black text-white">此功能僅供編輯者與管理員使用</p></Card>;
  }

  function choose(selected: FileList | null) {
    if (!selected) return;
    const candidates = Array.from(selected).flatMap((file) => {
      const relativePath = (file.webkitRelativePath || file.name).replaceAll("\\", "/");
      const dataset = relativePath.includes("/OwnProduct/") || relativePath.startsWith("OwnProduct/") ? "mfg" : relativePath.includes("/Outsourcing/") || relativePath.startsWith("Outsourcing/") ? "buy" : null;
      const extension = file.name.toLowerCase().split(".").pop() || "";
      if (!dataset || !ALLOWED.has(extension) || file.size <= 0 || file.size > MAX_PILOT_BYTES || file.name === ".DS_Store" || /\.log(?:\.\d+)?$|\.bak$/i.test(file.name)) return [];
      return [{ file, dataset, relativePath, status: "待上傳" } satisfies PilotFile];
    });
    const next = [...selectPilot(candidates.filter((item) => item.dataset === "mfg"), "mfg"), ...selectPilot(candidates.filter((item) => item.dataset === "buy"), "buy")];
    setFiles(next);
    setProgress(0);
    setMessage(next.length === 40 ? "已自動挑選自製品 20 份與外購品 20 份。" : `可用測試檔案 ${next.length} 份；其中一類不足 20 份。`);
  }

  async function upload() {
    if (!files.length || running) return;
    setRunning(true);
    setProgress(0);
    let completed = 0;
    let duplicates = 0;
    let failed = 0;
    for (let index = 0; index < files.length; index += 1) {
      const item = files[index];
      updateStatus(index, "計算雜湊…");
      try {
        const sha256 = await hashFile(item.file);
        updateStatus(index, "準備上傳…");
        const init = await api.initPdUpload({ dataset: item.dataset, relativePath: item.relativePath, byteSize: item.file.size, sha256 });
        if (init.duplicate) {
          duplicates += 1;
          updateStatus(index, "內容重複，已略過");
        } else {
          if (!init.signedUrl || !init.storagePath) throw new Error("未取得上傳位置");
          const form = new FormData();
          form.append("cacheControl", "3600");
          form.append("", item.file);
          updateStatus(index, "上傳中…");
          const response = await fetch(init.signedUrl, { method: "PUT", headers: { "x-upsert": "false" }, body: form });
          if (!response.ok) throw new Error(`Storage 上傳失敗 (${response.status})`);
          await api.completePdUpload({ dataset: item.dataset, relativePath: item.relativePath, byteSize: item.file.size, mimeType: item.file.type || "application/octet-stream", sha256, storagePath: init.storagePath, lastModified: item.file.lastModified });
          completed += 1;
          updateStatus(index, "已建立文件索引");
        }
      } catch (reason) {
        failed += 1;
        updateStatus(index, `失敗：${reason instanceof Error ? reason.message : "未知錯誤"}`);
      }
      setProgress(Math.round(((index + 1) / files.length) * 100));
    }
    setMessage(`測試匯入完成：新增 ${completed}、重複略過 ${duplicates}、失敗 ${failed}。`);
    setRunning(false);
  }

  function updateStatus(index: number, status: string) {
    setFiles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status } : item));
  }

  return <>
    <PageHeader eyebrow="PILOT IMPORT" title="自製 20＋外購 20 測試匯入" description="選擇 products 資料夾後，系統只挑選 40 份具代表性的檔案。完整資料不會在這一步上傳。" />
    <Card className="p-5 md:p-6">
      <button type="button" onClick={() => inputRef.current?.click()} className="flex min-h-56 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-950/30 p-8 text-center hover:border-cyan-600 hover:bg-cyan-950/10"><span className="rounded-2xl bg-slate-800 p-4 text-cyan-300"><FolderOpen size={30} /></span><span className="mt-4 text-lg font-black text-white">選擇 `/Users/woody/Documents/OpenAI/products/`</span><span className="mt-2 max-w-xl text-sm leading-6 text-slate-500">瀏覽器只會讀取你選擇的資料夾；系統自動區分 OwnProduct 與 Outsourcing。</span></button>
      <input ref={(node) => { inputRef.current = node; node?.setAttribute("webkitdirectory", ""); }} type="file" multiple className="hidden" onChange={(event) => choose(event.target.files)} />
      {files.length > 0 && <><div className="mt-5 flex flex-wrap gap-3"><Badge tone="accent">自製品 {mfg.length}</Badge><Badge tone="accent">外購品 {buy.length}</Badge><Badge>{formatBytes(files.reduce((sum, item) => sum + item.file.size, 0))}</Badge></div><div className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-slate-700">{files.map((item, index) => <div key={`${item.relativePath}-${item.file.size}`} className="grid gap-2 border-b border-slate-800 px-4 py-3 text-sm last:border-0 md:grid-cols-[90px_minmax(0,1fr)_170px]"><span className={item.dataset === "mfg" ? "text-cyan-300" : "text-amber-300"}>{item.dataset === "mfg" ? "自製品" : "外購品"}</span><span className="truncate text-slate-200" title={item.relativePath}>{item.relativePath}</span><span className="text-xs text-slate-500">{item.status}</span></div>)}</div></>}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 flex-1"><div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} /></div>{message && <p role="status" className="mt-2 text-sm text-slate-400">{message}</p>}</div><Button disabled={files.length === 0 || running} onClick={() => void upload()}>{running ? <LoaderCircle className="animate-spin" size={18} /> : progress === 100 ? <CheckCircle2 size={18} /> : <UploadCloud size={18} />}{running ? `匯入中 ${progress}%` : "開始測試匯入"}</Button></div>
    </Card>
  </>;
}

function selectPilot(files: PilotFile[], dataset: PdDataset) {
  const groups = dataset === "mfg"
    ? [["pdf"], ["xls", "xlsx"], ["stp", "step", "dwg", "dxf"], ["jpg", "jpeg", "png"], ["ppt", "pptx", "doc", "docx"]]
    : [["pdf"], ["xls", "xlsx"], ["ppt", "pptx", "doc", "docx"], ["jpg", "jpeg", "png"], ["stp", "step", "dwg", "dxf"]];
  const quota = dataset === "mfg" ? [6, 5, 4, 3, 2] : [6, 4, 4, 6, 0];
  const chosen: PilotFile[] = [];
  const remaining = [...files].sort((a, b) => quality(b) - quality(a) || a.relativePath.localeCompare(b.relativePath));
  groups.forEach((extensions, groupIndex) => {
    const matches = remaining.filter((item) => extensions.includes(ext(item.file.name))).slice(0, quota[groupIndex]);
    chosen.push(...matches);
    matches.forEach((match) => remaining.splice(remaining.indexOf(match), 1));
  });
  chosen.push(...remaining.slice(0, Math.max(0, 20 - chosen.length)));
  return chosen.slice(0, 20);
}

function quality(item: PilotFile) {
  const name = item.file.name.replace(/\.[^.]+$/, "");
  let score = 100;
  if (/^(image\s*\d*|img[_-]?\d+|[abc]\s*\(\d+\)|截圖|截图|微信圖片|微信图片|wechat)/i.test(name)) score -= 70;
  if (/(bom|型錄|型录|catalog|報價|报价|quotation|watch|qi|三合一|二合一)/i.test(item.relativePath)) score += 30;
  if (/(history|既有設計|既有提案|customer)/i.test(item.relativePath)) score -= 30;
  return score;
}

function ext(name: string) { return name.toLowerCase().split(".").pop() || ""; }
async function hashFile(file: File) { const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join(""); }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
