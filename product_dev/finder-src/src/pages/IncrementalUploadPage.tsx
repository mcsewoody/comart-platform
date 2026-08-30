import { CheckCircle2, FolderOpen, LoaderCircle, RefreshCw, UploadCloud } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import {
  dedupeByDatasetHash,
  importFileKey,
  selectIncrementalBatch,
} from "../lib/incremental-import";
import type { PdDataset } from "../lib/types";

type ImportFile = {
  file: File;
  dataset: PdDataset;
  relativePath: string;
  sha256: string;
  status: string;
};

type Inventory = {
  total: number;
  eligible: number;
  indexed: number;
  pending: number;
  folderDuplicates: number;
  unsupported: number;
};

type Phase = "idle" | "inventory" | "ready" | "uploading" | "finished";

const ALLOWED = new Set([
  "jpg", "jpeg", "png", "pdf", "ppt", "pptx", "xls", "xlsx", "doc", "docx",
  "stp", "step", "dwg", "dxf", "iges", "igs", "mp4", "mov",
]);
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const BATCH_SIZE = 200;
const HASH_QUERY_SIZE = 100;

export function IncrementalUploadPage() {
  const { profile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ImportFile[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const mfg = useMemo(() => files.filter((item) => item.dataset === "mfg"), [files]);
  const buy = useMemo(() => files.filter((item) => item.dataset === "buy"), [files]);
  const running = phase === "inventory" || phase === "uploading";

  if (profile?.role === "viewer") {
    return <Card className="p-8 text-center"><p className="font-black text-white">此功能僅供編輯者與管理員使用</p></Card>;
  }

  async function choose(selected: FileList | null) {
    if (!selected?.length || running) return;
    setPhase("inventory");
    setFiles([]);
    setPendingFiles([]);
    setInventory(null);
    setProgress(0);

    const selectedFiles = Array.from(selected);
    const candidates = selectedFiles.flatMap((file) => {
      const relativePath = (file.webkitRelativePath || file.name).replaceAll("\\", "/");
      const dataset = datasetFor(relativePath);
      const extension = ext(file.name);
      if (!dataset || !ALLOWED.has(extension) || file.size <= 0 || file.size > MAX_FILE_BYTES || excludedName(file.name)) return [];
      return [{ file, dataset, relativePath, sha256: "", status: "待上傳" } satisfies ImportFile];
    }).sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    try {
      const hashed: ImportFile[] = [];
      for (let index = 0; index < candidates.length; index += 1) {
        const item = candidates[index];
        setMessage(`正在盤點檔案內容 ${index + 1} / ${candidates.length}…`);
        hashed.push({ ...item, sha256: await hashFile(item.file) });
        setProgress(Math.round(((index + 1) / Math.max(candidates.length, 1)) * 75));
      }

      const deduped = dedupeByDatasetHash(hashed);
      const existing = await findExistingHashes(deduped.unique, (checked, total) => {
        setMessage(`正在比對資料庫 ${checked} / ${total}…`);
        setProgress(75 + Math.round((checked / Math.max(total, 1)) * 25));
      });
      const pending = deduped.unique.filter((item) => !existing.has(importFileKey(item)));
      const batch = prepareBatch(pending);

      setInventory({
        total: selectedFiles.length,
        eligible: hashed.length,
        indexed: existing.size,
        pending: pending.length,
        folderDuplicates: deduped.duplicates,
        unsupported: selectedFiles.length - candidates.length,
      });
      setPendingFiles(pending);
      setFiles(batch);
      setProgress(0);
      setPhase(batch.length ? "ready" : "finished");
      setMessage(batch.length
        ? `盤點完成。本批準備 ${batch.length} 份；匯入後不會自動執行 AI。`
        : "盤點完成：目前沒有待匯入的新文件。");
    } catch (reason) {
      setPhase("idle");
      setProgress(0);
      setMessage(`盤點失敗：${reason instanceof Error ? reason.message : "未知錯誤"}`);
    }
  }

  async function upload() {
    if (!files.length || phase !== "ready") return;
    setPhase("uploading");
    setProgress(0);
    let completed = 0;
    let duplicates = 0;
    let failed = 0;
    const processed = new Set<string>();

    for (let index = 0; index < files.length; index += 1) {
      const item = files[index];
      updateStatus(index, "準備上傳…");
      try {
        const init = await api.initPdUpload({
          dataset: item.dataset,
          relativePath: item.relativePath,
          byteSize: item.file.size,
          sha256: item.sha256,
        });
        if (init.duplicate) {
          duplicates += 1;
          processed.add(importFileKey(item));
          updateStatus(index, "內容重複，已略過");
        } else {
          if (!init.storagePath) throw new Error("未取得上傳位置");
          if (init.storageExists) {
            updateStatus(index, "原檔已存在，補建索引…");
          } else {
            if (!init.signedUrl) throw new Error("未取得 signed upload URL");
            const form = new FormData();
            form.append("cacheControl", "3600");
            form.append("", item.file);
            updateStatus(index, "上傳中…");
            const response = await fetch(init.signedUrl, {
              method: "PUT",
              headers: { "x-upsert": "false" },
              body: form,
            });
            const responseText = response.ok ? "" : await response.text();
            if (!response.ok && !/resource already exists/i.test(responseText)) {
              throw new Error(`Storage 上傳失敗 (${response.status})`);
            }
          }
          const result = await api.completePdUpload({
            dataset: item.dataset,
            relativePath: item.relativePath,
            byteSize: item.file.size,
            mimeType: item.file.type || "application/octet-stream",
            sha256: item.sha256,
            storagePath: init.storagePath,
            lastModified: item.file.lastModified,
          });
          processed.add(importFileKey(item));
          if (result.duplicate) {
            duplicates += 1;
            updateStatus(index, "內容重複，已略過");
          } else {
            completed += 1;
            updateStatus(index, result.analysisStatus === "metadata_only" ? "已建立 metadata 索引" : "已建立文件索引");
          }
        }
      } catch (reason) {
        failed += 1;
        updateStatus(index, `失敗：${reason instanceof Error ? reason.message : "未知錯誤"}`);
      }
      setProgress(Math.round(((index + 1) / files.length) * 100));
    }

    const remaining = pendingFiles.filter((item) => !processed.has(importFileKey(item)));
    setPendingFiles(remaining);
    setInventory((current) => current ? {
      ...current,
      indexed: current.indexed + processed.size,
      pending: remaining.length,
    } : current);
    setMessage(`本批完成：新增 ${completed}、重複略過 ${duplicates}、失敗 ${failed}；尚待匯入 ${remaining.length}。`);
    setPhase("finished");
  }

  function prepareNext() {
    const next = prepareBatch(pendingFiles);
    setFiles(next);
    setProgress(0);
    setPhase(next.length ? "ready" : "finished");
    setMessage(next.length ? `下一批已準備 ${next.length} 份。` : "所有可用文件皆已匯入。");
  }

  function openFolderPicker() {
    if (!inputRef.current || running) return;
    inputRef.current.value = "";
    inputRef.current.click();
  }

  function updateStatus(index: number, status: string) {
    setFiles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status } : item));
  }

  return <>
    <PageHeader
      eyebrow="INCREMENTAL IMPORT"
      title="增量批次匯入"
      description="選擇 products 資料夾後，先以 SHA-256 盤點全部檔案，再匯入下一批最多 200 份；不覆寫既有文件，也不會自動啟動 AI。"
    />
    <Card className="p-5 md:p-6">
      <button
        type="button"
        disabled={running}
        onClick={openFolderPicker}
        className="flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-950/30 p-8 text-center transition hover:border-cyan-600 hover:bg-cyan-950/10 disabled:cursor-wait disabled:opacity-60"
      >
        <span className="rounded-2xl bg-slate-800 p-4 text-cyan-300">{phase === "inventory" ? <LoaderCircle className="animate-spin" size={30} /> : <FolderOpen size={30} />}</span>
        <span className="mt-4 text-lg font-black text-white">選擇 `/Users/woody/Documents/OpenAI/products/`</span>
        <span className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">瀏覽器只讀取你主動選擇的資料夾；OwnProduct 與 Outsourcing 分開比對、分開儲存。</span>
      </button>
      <input
        ref={(node) => { inputRef.current = node; node?.setAttribute("webkitdirectory", ""); }}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => void choose(event.target.files)}
      />

      {inventory && <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="資料夾盤點結果">
        <Metric label="資料夾檔案" value={inventory.total} />
        <Metric label="可用檔案" value={inventory.eligible} tone="cyan" />
        <Metric label="已匯入" value={inventory.indexed} tone="green" />
        <Metric label="待匯入" value={inventory.pending} tone="amber" />
        <Metric label="資料夾內重複" value={inventory.folderDuplicates} />
        <Metric label="不支援／過大" value={inventory.unsupported} />
      </div>}

      {files.length > 0 && <>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="mr-2 text-sm font-black text-white">本批 {files.length} 份</p>
          <Badge tone="accent">自製品 {mfg.length}</Badge>
          <Badge tone="accent">外購品 {buy.length}</Badge>
          <Badge>{formatBytes(files.reduce((sum, item) => sum + item.file.size, 0))}</Badge>
        </div>
        <div className="mt-4 max-h-[460px] overflow-auto rounded-xl border border-slate-700" tabIndex={0} aria-label="本批匯入文件">
          {files.map((item) => <div key={`${item.dataset}-${item.sha256}`} className="grid gap-2 border-b border-slate-800 px-4 py-3 text-sm last:border-0 md:grid-cols-[90px_minmax(0,1fr)_190px]">
            <span className={item.dataset === "mfg" ? "text-cyan-300" : "text-amber-300"}>{item.dataset === "mfg" ? "自製品" : "外購品"}</span>
            <span className="truncate text-slate-200" title={item.relativePath}>{item.relativePath}</span>
            <span className="text-xs text-slate-500">{item.status}</span>
          </div>)}
        </div>
      </>}

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} /></div>
          {message && <p role="status" className="mt-2 text-sm leading-6 text-slate-400">{message}</p>}
        </div>
        {phase === "finished" && pendingFiles.length > 0 ? (
          <Button onClick={prepareNext}><RefreshCw size={18} />準備下一批</Button>
        ) : (
          <Button disabled={!files.length || phase !== "ready"} onClick={() => void upload()}>
            {phase === "uploading" ? <LoaderCircle className="animate-spin" size={18} /> : phase === "finished" ? <CheckCircle2 size={18} /> : <UploadCloud size={18} />}
            {phase === "idle" ? "請先選擇資料夾" : phase === "inventory" ? `盤點中 ${progress}%` : phase === "uploading" ? `匯入中 ${progress}%` : phase === "finished" ? "目前已全部匯入" : `匯入本批 ${files.length} 份`}
          </Button>
        )}
      </div>
    </Card>
  </>;
}

function Metric({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "cyan" | "green" | "amber" }) {
  const colors = {
    slate: "border-slate-700 bg-slate-900/60 text-slate-200",
    cyan: "border-cyan-900 bg-cyan-950/30 text-cyan-200",
    green: "border-emerald-900 bg-emerald-950/30 text-emerald-200",
    amber: "border-amber-900 bg-amber-950/30 text-amber-200",
  };
  return <div className={`rounded-xl border p-4 ${colors[tone]}`}><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black tabular-nums">{value}</p></div>;
}

function prepareBatch(files: ImportFile[]) {
  return selectIncrementalBatch(files, BATCH_SIZE).map((item) => ({ ...item, status: "待上傳" }));
}

async function findExistingHashes(files: ImportFile[], onProgress: (checked: number, total: number) => void) {
  const existing = new Set<string>();
  let checked = 0;
  for (const dataset of ["mfg", "buy"] as const) {
    const hashes = files.filter((item) => item.dataset === dataset).map((item) => item.sha256);
    for (let index = 0; index < hashes.length; index += HASH_QUERY_SIZE) {
      const chunk = hashes.slice(index, index + HASH_QUERY_SIZE);
      const result = await api.checkPdHashes(dataset, chunk);
      result.existing.forEach((sha256) => existing.add(`${dataset}:${sha256}`));
      checked += chunk.length;
      onProgress(checked, files.length);
    }
  }
  return existing;
}

function datasetFor(relativePath: string): PdDataset | null {
  if (relativePath.includes("/OwnProduct/") || relativePath.startsWith("OwnProduct/")) return "mfg";
  if (relativePath.includes("/Outsourcing/") || relativePath.startsWith("Outsourcing/")) return "buy";
  return null;
}

function excludedName(name: string) {
  return name === ".DS_Store" || /\.log(?:\.\d+)?$|\.bak$|名片|business\s*card/i.test(name);
}

function ext(name: string) { return name.toLowerCase().split(".").pop() || ""; }
async function hashFile(file: File) { const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join(""); }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
