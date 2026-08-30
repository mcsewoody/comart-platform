import { CheckCircle2, FilePlus2, FolderOpen, LoaderCircle, RefreshCw, UploadCloud, Zap } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import {
  dedupeByDatasetHash,
  importFileKey,
  isTransientUploadStatus,
  manifestFileKey,
  quickUploadRelativePath,
  reusableManifestHash,
  selectIncrementalBatch,
  type ImportManifestEntry,
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
  reusedHashes: number;
};

type Phase = "idle" | "inventory" | "ready" | "uploading" | "finished";

const ALLOWED = new Set([
  "jpg", "jpeg", "png", "pdf", "ppt", "pptx", "xls", "xlsx", "doc", "docx",
  "stp", "step", "dwg", "dxf", "iges", "igs", "mp4", "mov",
]);
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const BATCH_SIZE = 200;
const HASH_QUERY_SIZE = 100;
const QUICK_UPLOAD_LIMIT = 10;
const MANIFEST_STORAGE_KEY = "pd-document-import-manifest-v1";

export function IncrementalUploadPage() {
  const { profile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ImportFile[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [quickDataset, setQuickDataset] = useState<PdDataset>("mfg");
  const [quickPath, setQuickPath] = useState("");
  const [quickFiles, setQuickFiles] = useState<File[]>([]);
  const [quickStatuses, setQuickStatuses] = useState<string[]>([]);
  const [quickRunning, setQuickRunning] = useState(false);
  const [quickMessage, setQuickMessage] = useState("");
  const mfg = useMemo(() => files.filter((item) => item.dataset === "mfg"), [files]);
  const buy = useMemo(() => files.filter((item) => item.dataset === "buy"), [files]);
  const running = phase === "inventory" || phase === "uploading" || quickRunning;

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
      const manifest = loadManifest();
      const nextManifest: Record<string, ImportManifestEntry> = {};
      let reusedHashes = 0;
      for (let index = 0; index < candidates.length; index += 1) {
        const item = candidates[index];
        const cacheKey = manifestFileKey(item);
        const cachedHash = reusableManifestHash(manifest[cacheKey], item.file);
        const sha256 = cachedHash || await hashFile(item.file);
        if (cachedHash) reusedHashes += 1;
        setMessage(`正在掃描變更 ${index + 1} / ${candidates.length}；沿用 ${reusedHashes} 份快取…`);
        hashed.push({ ...item, sha256 });
        nextManifest[cacheKey] = {
          byteSize: item.file.size,
          lastModified: item.file.lastModified,
          sha256,
        };
        setProgress(Math.round(((index + 1) / Math.max(candidates.length, 1)) * 75));
      }
      saveManifest(nextManifest);

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
        reusedHashes,
      });
      setPendingFiles(pending);
      setFiles(batch);
      setProgress(0);
      setPhase(batch.length ? "ready" : "finished");
      setMessage(batch.length
        ? `盤點完成，沿用 ${reusedHashes} 份快取。本批準備 ${batch.length} 份；匯入後不會自動執行 AI。`
        : `盤點完成，沿用 ${reusedHashes} 份快取；目前沒有待匯入的新文件。`);
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
        const outcome = await uploadOne(item, (status) => updateStatus(index, status));
        processed.add(importFileKey(item));
        if (outcome === "duplicate") {
          duplicates += 1;
          updateStatus(index, "內容重複，已略過");
        } else {
          completed += 1;
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

  function chooseQuick(selected: FileList | null) {
    if (!selected || quickRunning) return;
    const next = Array.from(selected)
      .filter((file) => ALLOWED.has(ext(file.name)) && file.size > 0 && file.size <= MAX_FILE_BYTES && !excludedName(file.name))
      .slice(0, QUICK_UPLOAD_LIMIT);
    setQuickFiles(next);
    setQuickStatuses(next.map(() => "待上傳"));
    setQuickMessage(next.length
      ? `已選擇 ${next.length} 份；請確認資料庫與分類路徑。`
      : "沒有可上傳的檔案；請檢查格式或檔案大小。" );
  }

  async function quickUpload() {
    if (!quickFiles.length || quickRunning || running) return;
    try {
      quickUploadRelativePath(quickDataset, quickPath, quickFiles[0].name);
    } catch (reason) {
      setQuickMessage(reason instanceof Error ? reason.message : "分類路徑無效");
      return;
    }

    setQuickRunning(true);
    let completed = 0;
    let duplicates = 0;
    let failed = 0;
    for (let index = 0; index < quickFiles.length; index += 1) {
      const file = quickFiles[index];
      updateQuickStatus(index, "計算雜湊…");
      try {
        const item: ImportFile = {
          file,
          dataset: quickDataset,
          relativePath: quickUploadRelativePath(quickDataset, quickPath, file.name),
          sha256: await hashFile(file),
          status: "準備上傳…",
        };
        const outcome = await uploadOne(item, (status) => updateQuickStatus(index, status));
        if (outcome === "duplicate") {
          duplicates += 1;
          updateQuickStatus(index, "內容重複，已略過");
        } else {
          completed += 1;
        }
      } catch (reason) {
        failed += 1;
        updateQuickStatus(index, `失敗：${reason instanceof Error ? reason.message : "未知錯誤"}`);
      }
    }
    setQuickMessage(`快速上傳完成：新增 ${completed}、重複略過 ${duplicates}、失敗 ${failed}；不會自動執行 AI。`);
    setQuickRunning(false);
  }

  function updateQuickStatus(index: number, status: string) {
    setQuickStatuses((current) => current.map((item, itemIndex) => itemIndex === index ? status : item));
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
      title="文件匯入"
      description="大量新增使用資料夾快速掃描；只有 1～10 份時可直接快速上傳。兩種方式都不覆寫既有文件，也不會自動啟動 AI。"
    />
    <Card className="p-5 md:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-xl bg-cyan-950/50 p-3 text-cyan-300"><RefreshCw size={22} /></span>
        <div><h2 className="text-lg font-black text-white">A. 資料夾快速掃描</h2><p className="mt-1 text-sm leading-6 text-slate-500">建議日常使用。沿用上次 SHA-256 快取，只重新讀取新增或內容變更的檔案。</p></div>
      </div>
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

    <Card className="mt-6 p-5 md:p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-amber-950/50 p-3 text-amber-300"><Zap size={22} /></span>
        <div><h2 className="text-lg font-black text-white">B. 少量快速上傳</h2><p className="mt-1 text-sm leading-6 text-slate-500">適合臨時新增 1～10 份。請填寫原本應放入的相對資料夾，確保廠商與產品分類不遺失。</p></div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[180px_minmax(260px,1fr)_auto] lg:items-end">
        <label className="text-sm font-bold text-slate-300">文件資料庫
          <select value={quickDataset} onChange={(event) => setQuickDataset(event.target.value as PdDataset)} disabled={quickRunning} className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-cyan-500">
            <option value="mfg">自製品</option>
            <option value="buy">外購品</option>
          </select>
        </label>
        <label className="text-sm font-bold text-slate-300">分類路徑（不含 OwnProduct／Outsourcing）
          <input
            value={quickPath}
            onChange={(event) => setQuickPath(event.target.value)}
            disabled={quickRunning}
            placeholder={quickDataset === "mfg" ? "例如：素亦/手機指環架" : "例如：供應商名稱/三合一充電"}
            className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-500"
          />
        </label>
        <Button variant="secondary" disabled={quickRunning} onClick={() => {
          if (!quickInputRef.current) return;
          quickInputRef.current.value = "";
          quickInputRef.current.click();
        }}><FilePlus2 size={18} />選擇 1～10 份</Button>
        <input ref={quickInputRef} type="file" multiple className="hidden" onChange={(event) => chooseQuick(event.target.files)} />
      </div>

      {quickFiles.length > 0 && <div className="mt-5 overflow-hidden rounded-xl border border-slate-700">
        {quickFiles.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}`} className="grid gap-2 border-b border-slate-800 px-4 py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1fr)_120px_190px]">
          <span className="truncate text-slate-200" title={file.name}>{file.name}</span>
          <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
          <span className="text-xs text-slate-500">{quickStatuses[index]}</span>
        </div>)}
      </div>}

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="min-w-0 flex-1 text-sm leading-6 text-slate-400">{quickMessage || "檔案會進入所選邏輯資料庫；外購品分類路徑第一層請填廠商名稱。"}</p>
        <Button disabled={!quickFiles.length || !quickPath.trim() || quickRunning || running} onClick={() => void quickUpload()}>
          {quickRunning ? <LoaderCircle className="animate-spin" size={18} /> : <UploadCloud size={18} />}
          {quickRunning ? "上傳中…" : quickFiles.length ? `快速上傳 ${quickFiles.length} 份` : "請先選擇檔案"}
        </Button>
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

async function uploadOne(item: ImportFile, onStatus: (status: string) => void): Promise<"completed" | "duplicate"> {
  let storagePath: string | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const init = await api.initPdUpload({
      dataset: item.dataset,
      relativePath: item.relativePath,
      byteSize: item.file.size,
      sha256: item.sha256,
    });
    if (init.duplicate) return "duplicate";
    if (!init.storagePath) throw new Error("未取得上傳位置");
    storagePath = init.storagePath;

    if (init.storageExists) {
      onStatus("原檔已存在，補建索引…");
      break;
    }
    if (!init.signedUrl) throw new Error("未取得 signed upload URL");

    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", item.file);
    onStatus(attempt === 1 ? "上傳中…" : `第 ${attempt} 次重試上傳…`);

    let response: Response;
    try {
      response = await fetch(init.signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: form,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Storage 上傳失敗");
      if (attempt === 3) throw lastError;
      onStatus(`Storage 連線暫時失敗，第 ${attempt + 1} 次重試…`);
      await delay(700 * attempt);
      continue;
    }

    const responseText = response.ok ? "" : await response.text();
    if (response.ok || /resource already exists/i.test(responseText)) break;

    lastError = new Error(`Storage 上傳失敗 (${response.status})`);
    if (!isTransientUploadStatus(response.status) || attempt === 3) throw lastError;

    onStatus(`Storage 暫時失敗，第 ${attempt + 1} 次重試…`);
    await delay(700 * attempt);
  }

  if (!storagePath) throw lastError || new Error("Storage 上傳失敗");

  const result = await api.completePdUpload({
    dataset: item.dataset,
    relativePath: item.relativePath,
    byteSize: item.file.size,
    mimeType: item.file.type || "application/octet-stream",
    sha256: item.sha256,
    storagePath,
    lastModified: item.file.lastModified,
  });
  if (result.duplicate) return "duplicate";
  onStatus(result.analysisStatus === "metadata_only" ? "已建立 metadata 索引" : "已建立文件索引");
  return "completed";
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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

function loadManifest(): Record<string, ImportManifestEntry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(MANIFEST_STORAGE_KEY) || "{}") as Record<string, ImportManifestEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveManifest(manifest: Record<string, ImportManifestEntry>) {
  try {
    localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(manifest));
  } catch {
    // Storage may be unavailable or full; the next scan safely falls back to hashing all files.
  }
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
