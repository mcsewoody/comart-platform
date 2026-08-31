import { BrainCircuit, CheckCircle2, Download, FilePlus2, FolderOpen, LoaderCircle, Play, RefreshCw, ShieldCheck, UploadCloud, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { useAuth } from "../auth/AuthProvider";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { appConfig } from "../lib/config";
import {
  dedupeByDatasetHash,
  compareSyncManifest,
  importFileKey,
  isTransientUploadStatus,
  manifestFileKey,
  quickUploadRelativePath,
  reusableManifestHash,
  selectIncrementalBatch,
  shouldUseResumableUpload,
  type ImportManifestEntry,
} from "../lib/incremental-import";
import {
  filesFromDirectory,
  loadDirectoryHandle,
  pickDefaultDirectory,
  requestDirectoryPermission,
  supportsDirectoryAccess,
  writeFileWithoutOverwrite,
  type StoredDirectoryHandle,
} from "../lib/directory-access";
import type { PdAnalysisLibraryStatus, PdAnalysisQueueStatus, PdDataset, PdSyncDocument, PdUploader } from "../lib/types";

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
  const [analysisStatus, setAnalysisStatus] = useState<PdAnalysisQueueStatus | null>(null);
  const [analysisDataset, setAnalysisDataset] = useState<PdDataset | "both">("both");
  const [analysisLimit, setAnalysisLimit] = useState(20);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [directoryHandle, setDirectoryHandle] = useState<StoredDirectoryHandle | null>(null);
  const [localFiles, setLocalFiles] = useState<ImportFile[]>([]);
  const [serverOnly, setServerOnly] = useState<PdSyncDocument[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<PdSyncDocument[]>([]);
  const [syncCurrent, setSyncCurrent] = useState(0);
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const mfg = useMemo(() => files.filter((item) => item.dataset === "mfg"), [files]);
  const buy = useMemo(() => files.filter((item) => item.dataset === "buy"), [files]);
  const running = phase === "inventory" || phase === "uploading" || quickRunning || analysisRunning || syncRunning;

  useEffect(() => {
    void loadDirectoryHandle().then(setDirectoryHandle).catch(() => setDirectoryHandle(null));
  }, []);

  const refreshAnalysisStatus = useCallback(async (silent = false) => {
    try {
      setAnalysisStatus(await api.getPdAnalysisStatus());
    } catch (reason) {
      if (!silent) setAnalysisMessage(`無法取得 AI 佇列：${reason instanceof Error ? reason.message : "未知錯誤"}`);
    }
  }, []);

  useEffect(() => {
    if (!profile?.canUpload) return;
    void refreshAnalysisStatus();
    const timer = window.setInterval(() => void refreshAnalysisStatus(true), 15_000);
    return () => window.clearInterval(timer);
  }, [profile?.canUpload, refreshAnalysisStatus]);

  if (!profile?.canUpload) {
    return <Card className="p-8 text-center"><p className="font-black text-white">你尚未列入 Product Finder 上傳者名單</p></Card>;
  }

  async function choose(selected: FileList | File[] | null) {
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
      setLocalFiles(deduped.unique);
      await refreshSync(deduped.unique);
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

  async function setOrScanDefaultDirectory(change = false) {
    if (running) return;
    try {
      const handle = change || !directoryHandle ? await pickDefaultDirectory() : directoryHandle;
      if (!await requestDirectoryPermission(handle)) throw new Error("未取得資料夾讀寫權限");
      setDirectoryHandle(handle);
      setMessage(`正在讀取預設目錄 ${handle.name}…`);
      await choose(await filesFromDirectory(handle));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setMessage(`資料夾讀取失敗：${reason instanceof Error ? reason.message : "未知錯誤"}`);
    }
  }

  async function refreshSync(local = localFiles) {
    try {
      const remote = await api.getPdSyncManifest();
      const compared = compareSyncManifest(local, remote.items);
      setServerOnly(compared.serverOnly);
      setSyncConflicts(compared.conflicts);
      setSyncCurrent(compared.current);
      setSyncMessage(compared.serverOnly.length
        ? `Supabase 有 ${compared.serverOnly.length} 份本機尚未保存，可安全補回。`
        : "Supabase 沒有本機缺少的文件。");
    } catch (reason) {
      setSyncMessage(`同步盤點失敗：${reason instanceof Error ? reason.message : "未知錯誤"}`);
    }
  }

  async function downloadServerOnly() {
    if (!directoryHandle || !serverOnly.length || syncRunning) return;
    setSyncRunning(true);
    let downloaded = 0;
    let conflicts = 0;
    let failed = 0;
    try {
      if (!await requestDirectoryPermission(directoryHandle)) throw new Error("未取得資料夾寫入權限");
      for (let index = 0; index < serverOnly.length; index += 50) {
        const batch = serverOnly.slice(index, index + 50);
        const result = await api.getPdSyncUrls(batch.map((item) => ({ dataset: item.dataset, id: item.id })));
        for (const item of result.items) {
          setSyncMessage(`正在補回 ${downloaded + conflicts + failed + 1} / ${serverOnly.length}：${item.relativePath}`);
          try {
            const response = await fetch(item.url);
            if (!response.ok) throw new Error(`下載失敗 (${response.status})`);
            const outcome = await writeFileWithoutOverwrite(directoryHandle, item.relativePath, await response.blob());
            if (outcome === "written") downloaded += 1;
            else conflicts += 1;
          } catch {
            failed += 1;
          }
        }
      }
      setSyncMessage(`本機補檔完成：新增 ${downloaded}、未覆寫衝突 ${conflicts}、失敗 ${failed}。`);
      setSyncRunning(false);
      await choose(await filesFromDirectory(directoryHandle));
    } catch (reason) {
      setSyncMessage(`補檔失敗：${reason instanceof Error ? reason.message : "未知錯誤"}`);
    } finally {
      setSyncRunning(false);
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
    void refreshAnalysisStatus(true);
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
    void refreshAnalysisStatus(true);
  }

  async function startAnalysis() {
    if (!analysisStatus?.configured || analysisRunning) return;
    setAnalysisRunning(true);
    setAnalysisMessage("正在啟動 AI 分析…");
    try {
      await api.startPdAnalysis(analysisDataset, analysisLimit);
      setAnalysisMessage(`已啟動 ${analysisDataset === "both" ? "自製品／外購品" : analysisDataset === "mfg" ? "自製品" : "外購品"} AI 分析；每個資料庫本次最多 ${analysisLimit} 份。`);
      window.setTimeout(() => void refreshAnalysisStatus(true), 3_000);
    } catch (reason) {
      setAnalysisMessage(`啟動失敗：${reason instanceof Error ? reason.message : "未知錯誤"}`);
    } finally {
      setAnalysisRunning(false);
    }
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
        onClick={() => supportsDirectoryAccess() ? void setOrScanDefaultDirectory() : openFolderPicker()}
        className="flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-950/30 p-8 text-center transition hover:border-cyan-600 hover:bg-cyan-950/10 disabled:cursor-wait disabled:opacity-60"
      >
        <span className="rounded-2xl bg-slate-800 p-4 text-cyan-300">{phase === "inventory" ? <LoaderCircle className="animate-spin" size={30} /> : <FolderOpen size={30} />}</span>
        <span className="mt-4 text-lg font-black text-white">{directoryHandle ? `掃描預設目錄：${directoryHandle.name}` : "設定預設 products 目錄"}</span>
        <span className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">第一次授權後會記住目錄；瀏覽器仍會在需要時請你確認讀寫權限。</span>
      </button>
      {directoryHandle && supportsDirectoryAccess() && <div className="mt-3 text-right"><Button variant="ghost" disabled={running} onClick={() => void setOrScanDefaultDirectory(true)}><FolderOpen size={17} />更換預設目錄</Button></div>}
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

    <Card className="mt-6 p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-emerald-950/50 p-3 text-emerald-300"><Download size={22} /></span>
          <div><h2 className="text-lg font-black text-white">C. Supabase → 預設目錄補檔</h2><p className="mt-1 text-sm leading-6 text-slate-500">讓同事上傳、但你本機沒有的文件回到相同分類路徑。同路徑已有檔案時絕不覆寫。</p></div>
        </div>
        <Button variant="secondary" disabled={!localFiles.length || syncRunning} onClick={() => void refreshSync()}><RefreshCw size={17} />重新盤點</Button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Metric label="本機與雲端一致" value={syncCurrent} tone="green" />
        <Metric label="雲端有／本機缺少" value={serverOnly.length} tone="cyan" />
        <Metric label="同路徑不同內容" value={syncConflicts.length} tone="amber" />
      </div>
      {syncConflicts.length > 0 && <div className="mt-4 max-h-40 overflow-auto rounded-xl border border-amber-900/70 bg-amber-950/20 p-3 text-xs leading-6 text-amber-200">
        <p className="mb-1 font-black">以下衝突不會自動下載或覆寫：</p>
        {syncConflicts.map((item) => <p key={`${item.dataset}-${item.id}`} className="truncate" title={item.relativePath}>{item.relativePath}</p>)}
      </div>}
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="min-w-0 flex-1 text-sm leading-6 text-slate-400">{syncMessage || (directoryHandle ? "掃描預設目錄後即可比對雲端差異。" : "請先在 A 區設定預設目錄。")}</p>
        <Button disabled={!directoryHandle || !serverOnly.length || syncRunning} onClick={() => void downloadServerOnly()}>
          {syncRunning ? <LoaderCircle className="animate-spin" size={18} /> : <Download size={18} />}
          {syncRunning ? "補檔中…" : `安全補回 ${serverOnly.length} 份`}
        </Button>
      </div>
    </Card>

    <AnalysisControl
      status={analysisStatus}
      dataset={analysisDataset}
      limit={analysisLimit}
      running={analysisRunning}
      message={analysisMessage}
      pageBusy={running}
      onDatasetChange={setAnalysisDataset}
      onLimitChange={setAnalysisLimit}
      onRefresh={() => void refreshAnalysisStatus()}
      onStart={() => void startAnalysis()}
    />
    {profile.role === "admin" && <UploaderAccessControl />}
  </>;
}

function UploaderAccessControl() {
  const [items, setItems] = useState<PdUploader[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await api.getPdUploaders()).items);
    } catch (reason) {
      setMessage(`無法取得名單：${reason instanceof Error ? reason.message : "未知錯誤"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(item: PdUploader) {
    setMessage(`正在更新 ${item.displayName}…`);
    try {
      await api.setPdUploader(item.id, !item.allowed);
      setItems((current) => current.map((value) => value.id === item.id ? { ...value, allowed: !value.allowed } : value));
      setMessage(`${item.displayName} 的 Product Finder 上傳權限已更新。`);
    } catch (reason) {
      setMessage(`更新失敗：${reason instanceof Error ? reason.message : "未知錯誤"}`);
    }
  }

  return <Card className="mt-6 p-5 md:p-6">
    <div className="flex items-start gap-3">
      <span className="rounded-xl bg-violet-950/50 p-3 text-violet-300"><ShieldCheck size={22} /></span>
      <div><h2 className="text-lg font-black text-white">E. Product Finder 上傳者</h2><p className="mt-1 text-sm leading-6 text-slate-500">這是本系統專用白名單，不會改變同事在 KMS 或其他 Platform 子系統的角色。</p></div>
    </div>
    <div className="mt-5 overflow-hidden rounded-xl border border-slate-700">
      {loading ? <p className="p-4 text-sm text-slate-400">讀取名單中…</p> : items.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-800 px-4 py-3 last:border-0 hover:bg-slate-800/50">
        <input type="checkbox" checked={item.allowed} disabled={item.platformRole === "admin"} onChange={() => void toggle(item)} className="h-4 w-4 accent-cyan-400" />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-200">{item.displayName}</span><span className="block truncate text-xs text-slate-500">{item.email} · {item.id}</span></span>
        <Badge tone={item.allowed ? "success" : "neutral"}>{item.allowed ? "可上傳／補檔" : "只能搜尋"}</Badge>
      </label>)}
    </div>
    {message && <p role="status" className="mt-3 text-sm text-slate-400">{message}</p>}
  </Card>;
}

function AnalysisControl({
  status,
  dataset,
  limit,
  running,
  message,
  pageBusy,
  onDatasetChange,
  onLimitChange,
  onRefresh,
  onStart,
}: {
  status: PdAnalysisQueueStatus | null;
  dataset: PdDataset | "both";
  limit: number;
  running: boolean;
  message: string;
  pageBusy: boolean;
  onDatasetChange: (dataset: PdDataset | "both") => void;
  onLimitChange: (limit: number) => void;
  onRefresh: () => void;
  onStart: () => void;
}) {
  const selected = status ? selectedAnalysisStatus(status, dataset) : emptyAnalysisStatus();
  const ready = selected.queued + selected.retryableFailed;
  const disabled = !status?.configured || ready === 0 || selected.processing > 0 || running || pageBusy;
  return <Card className="mt-6 overflow-hidden border-cyan-900/70 bg-gradient-to-br from-slate-900 to-cyan-950/20 p-0">
    <div className="border-b border-slate-800 p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-cyan-950/70 p-3 text-cyan-300"><BrainCircuit size={22} /></span>
          <div><h2 className="text-lg font-black text-white">D. AI 文件分析</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">由這裡啟動後端 worker，擷取 PDF、Office 與圖片的全文、摘要、關鍵字及縮圖。不會分析 CAD 或影片內容。</p></div>
        </div>
        <Button variant="ghost" disabled={running} onClick={onRefresh}><RefreshCw size={17} />更新狀態</Button>
      </div>
    </div>

    <div className="grid gap-4 p-5 md:grid-cols-2 md:p-6">
      <AnalysisLibraryCard title="自製品" status={status?.mfg || emptyAnalysisStatus()} tone="cyan" />
      <AnalysisLibraryCard title="外購品" status={status?.buy || emptyAnalysisStatus()} tone="amber" />
    </div>

    <div className="border-t border-slate-800 bg-slate-950/30 p-5 md:p-6">
      <div className="grid gap-4 lg:grid-cols-[220px_180px_minmax(0,1fr)_auto] lg:items-end">
        <label className="text-sm font-bold text-slate-300">分析資料庫
          <select value={dataset} onChange={(event) => onDatasetChange(event.target.value as PdDataset | "both")} disabled={running} className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-cyan-500">
            <option value="both">自製品／外購品</option>
            <option value="mfg">只有自製品</option>
            <option value="buy">只有外購品</option>
          </select>
        </label>
        <label className="text-sm font-bold text-slate-300">每個資料庫本次份數
          <input type="number" min={1} max={50} value={limit} onChange={(event) => onLimitChange(Math.min(50, Math.max(1, Number(event.target.value) || 1)))} disabled={running} className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-slate-100 outline-none focus:border-cyan-500" />
        </label>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm leading-6 text-slate-400">
          <span className="font-black text-white">選取範圍待處理 {ready} 份</span>
          <span className="mx-2 text-slate-700">|</span>處理中 {selected.processing} 份
        </div>
        <Button disabled={disabled} onClick={onStart} className="h-12 px-6">
          {running ? <LoaderCircle className="animate-spin" size={18} /> : <Play size={18} />}
          {running ? "啟動中…" : selected.processing > 0 ? "AI 分析中" : ready > 0 ? `開始分析 ${Math.min(ready, limit * (dataset === "both" ? 2 : 1))} 份` : "沒有待分析文件"}
        </Button>
      </div>
      <p role="status" className={`mt-3 text-sm leading-6 ${status && !status.configured ? "text-amber-300" : "text-slate-400"}`}>
        {status && !status.configured ? "尚差一次性的後端授權設定；設定後不再需要進入 GitHub。" : message || "建議先以每庫 20 份驗證搜尋品質，確認後再處理下一批。"}
      </p>
    </div>
  </Card>;
}

function AnalysisLibraryCard({ title, status, tone }: { title: string; status: PdAnalysisLibraryStatus; tone: "cyan" | "amber" }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="font-black text-white">{title}</h3><span className={tone === "cyan" ? "text-cyan-300" : "text-amber-300"}>{status.queued + status.retryableFailed} 待處理</span></div>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <AnalysisMetric label="排隊" value={status.queued} />
      <AnalysisMetric label="處理中" value={status.processing} />
      <AnalysisMetric label="可重試" value={status.retryableFailed} />
      <AnalysisMetric label="已完成" value={status.completed} />
    </div>
    {status.blockedFailed > 0 && <p className="mt-3 text-xs font-semibold text-rose-300">{status.blockedFailed} 份已失敗三次，需要管理員檢查。</p>}
  </div>;
}

function AnalysisMetric({ label, value }: { label: string; value: number }) {
  return <div><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-black tabular-nums text-slate-200">{value}</p></div>;
}

function emptyAnalysisStatus(): PdAnalysisLibraryStatus {
  return { queued: 0, processing: 0, retryableFailed: 0, blockedFailed: 0, completed: 0 };
}

function selectedAnalysisStatus(status: PdAnalysisQueueStatus, dataset: PdDataset | "both"): PdAnalysisLibraryStatus {
  if (dataset !== "both") return status[dataset];
  return {
    queued: status.mfg.queued + status.buy.queued,
    processing: status.mfg.processing + status.buy.processing,
    retryableFailed: status.mfg.retryableFailed + status.buy.retryableFailed,
    blockedFailed: status.mfg.blockedFailed + status.buy.blockedFailed,
    completed: status.mfg.completed + status.buy.completed,
  };
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

    if (shouldUseResumableUpload(item.file.size)) {
      if (!init.signedToken) throw new Error("未取得大檔續傳授權");
      onStatus("大檔續傳準備中…");
      await uploadResumable(item, storagePath, init.signedToken, onStatus);
      break;
    }

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

function uploadResumable(
  item: ImportFile,
  storagePath: string,
  signedToken: string,
  onStatus: (status: string) => void,
) {
  const projectId = new URL(appConfig.supabaseUrl).hostname.split(".")[0];
  const bucketName = item.dataset === "mfg" ? "pd_mfg_source" : "pd_buy_source";

  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(item.file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        "x-signature": signedToken,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName,
        objectName: storagePath,
        contentType: item.file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError: (error) => reject(error),
      onProgress: (uploaded, total) => {
        const percentage = total > 0 ? Math.floor((uploaded / total) * 100) : 0;
        onStatus(`大檔續傳 ${percentage}%`);
      },
      onSuccess: () => resolve(),
    });

    upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length > 0) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      })
      .catch(reject);
  });
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
