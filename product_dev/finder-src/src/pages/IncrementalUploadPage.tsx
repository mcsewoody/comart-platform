import { BrainCircuit, CheckCircle2, Download, Factory, FolderOpen, LoaderCircle, Play, RefreshCw, ShieldCheck, ShoppingBag, UploadCloud, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Upload } from "tus-js-client";
import { useAuth } from "../auth/AuthProvider";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { appConfig } from "../lib/config";
import {
  dedupeByDatasetHash,
  compareSyncManifest,
  importFileKey,
  isSignedTusAuthError,
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
import { t as tr, useT } from "../i18n";

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
  unique: number;
  indexed: number;
  pending: number;
  folderDuplicates: number;
  skipped: SkippedFile[];
  reusedHashes: number;
};

type SkipReason = "outside_dataset" | "empty" | "excluded" | "oversized" | "archive" | "unsupported";

type SkippedFile = {
  relativePath: string;
  byteSize: number;
  reason: SkipReason;
};

type Phase = "idle" | "inventory" | "ready" | "uploading" | "finished";

const ALLOWED = new Set([
  "jpg", "jpeg", "png", "pdf", "ppt", "pptx", "xls", "xlsx", "doc", "docx",
  "stp", "step", "dwg", "dxf", "iges", "igs", "mp4", "mov",
]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ARCHIVE_EXTENSIONS = new Set(["zip", "7z", "rar"]);
const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  /* 🔴 存 key 不存文案：模組載入時求值一次，存死字串切語言換不掉。*/
  outside_dataset: "sk_outside_dataset",
  empty: "sk_empty",
  excluded: "sk_excluded",
  oversized: "sk_oversized",
  archive: "sk_archive",
  unsupported: "sk_unsupported",
};
const BATCH_SIZE = 200;
const HASH_QUERY_SIZE = 100;
const MANIFEST_STORAGE_KEY = "pd-document-import-manifest-v1";

export type ImportToolMode = "batch" | "quick" | "sync" | "analysis";

export function IncrementalUploadPage({ mode }: { mode: ImportToolMode }) {
  const t = useT();
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
  const [quickFiles, setQuickFiles] = useState<File[]>([]);
  const [quickStatuses, setQuickStatuses] = useState<string[]>([]);
  const [quickRunning, setQuickRunning] = useState(false);
  const [quickMessage, setQuickMessage] = useState("");
  const [quickDragActive, setQuickDragActive] = useState(false);
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
      if (!silent) setAnalysisMessage(t("u_ai_queue_failed", { m: reason instanceof Error ? reason.message : t("u_unknown_err") }));
    }
  }, [t]);

  useEffect(() => {
    if (mode !== "analysis" || !profile?.canUpload) return;
    void refreshAnalysisStatus();
    const timer = window.setInterval(() => void refreshAnalysisStatus(true), 15_000);
    return () => window.clearInterval(timer);
  }, [mode, profile?.canUpload, refreshAnalysisStatus]);

  const hasModeAccess = mode === "sync" ? profile?.canSync : profile?.canUpload;
  if (!hasModeAccess) {
    return <Card className="p-8 text-center"><p className="font-semibold text-white">{mode === "sync" ? t("u_no_sync_perm") : t("u_no_upload_perm")}</p></Card>;
  }

  async function choose(selected: FileList | File[] | null) {
    if (!selected?.length || running) return;
    setPhase("inventory");
    setFiles([]);
    setPendingFiles([]);
    setInventory(null);
    setProgress(0);

    const selectedFiles = Array.from(selected);
    const skipped: SkippedFile[] = [];
    const candidates = selectedFiles.flatMap((file) => {
      const relativePath = (file.webkitRelativePath || file.name).replaceAll("\\", "/");
      const dataset = datasetFor(relativePath);
      const extension = ext(file.name);
      const reason = skippedReason(file, dataset, extension);
      if (reason) {
        skipped.push({ relativePath, byteSize: file.size, reason });
        return [];
      }
      if (!dataset) return [];
      return [{ file, dataset, relativePath, sha256: "", status: tr("u_st_pending") } satisfies ImportFile];
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
        setMessage(t("u_scanning", { i: index + 1, n: candidates.length, c: reusedHashes }));
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
      if (mode === "sync") await refreshSync(deduped.unique);
      const existing = await findExistingHashes(deduped.unique, (checked, total) => {
        setMessage(t("u_comparing", { i: checked, n: total }));
        setProgress(75 + Math.round((checked / Math.max(total, 1)) * 25));
      });
      const pending = deduped.unique.filter((item) => !existing.has(importFileKey(item)));
      const batch = prepareBatch(pending);

      setInventory({
        total: selectedFiles.length,
        eligible: hashed.length,
        unique: deduped.unique.length,
        indexed: existing.size,
        pending: pending.length,
        folderDuplicates: deduped.duplicates,
        skipped,
        reusedHashes,
      });
      setPendingFiles(pending);
      setFiles(batch);
      setProgress(0);
      setPhase(batch.length ? "ready" : "finished");
      setMessage(batch.length
        ? t("u_inv_done", { c: reusedHashes, n: batch.length })
        : t("u_inv_none", { c: reusedHashes }));
    } catch (reason) {
      setPhase("idle");
      setProgress(0);
      setMessage(t("u_inv_failed", { m: reason instanceof Error ? reason.message : t("u_unknown_err") }));
    }
  }

  async function setOrScanDefaultDirectory(change = false) {
    if (running) return;
    try {
      const handle = change || !directoryHandle ? await pickDefaultDirectory() : directoryHandle;
      if (!await requestDirectoryPermission(handle)) throw new Error(t("u_e_dir_read"));
      setDirectoryHandle(handle);
      setMessage(t("u_reading_dir", { n: handle.name }));
      await choose(await filesFromDirectory(handle));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setMessage(t("u_dir_failed", { m: reason instanceof Error ? reason.message : t("u_unknown_err") }));
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
        ? t("u_sync_avail", { n: compared.serverOnly.length })
        : t("u_sync_none"));
    } catch (reason) {
      setSyncMessage(t("u_sync_failed", { m: reason instanceof Error ? reason.message : t("u_unknown_err") }));
    }
  }

  async function downloadServerOnly() {
    if (!directoryHandle || !serverOnly.length || syncRunning) return;
    setSyncRunning(true);
    let downloaded = 0;
    let conflicts = 0;
    let failed = 0;
    try {
      if (!await requestDirectoryPermission(directoryHandle)) throw new Error(t("u_e_dir_write"));
      for (let index = 0; index < serverOnly.length; index += 50) {
        const batch = serverOnly.slice(index, index + 50);
        const result = await api.getPdSyncUrls(batch.map((item) => ({ dataset: item.dataset, id: item.id })));
        for (const item of result.items) {
          setSyncMessage(t("u_sync_progress", { i: downloaded + conflicts + failed + 1, n: serverOnly.length, p: item.relativePath }));
          try {
            const response = await fetch(item.url);
            if (!response.ok) throw new Error(t("u_e_download", { s: response.status }));
            const outcome = await writeFileWithoutOverwrite(directoryHandle, item.relativePath, await response.blob());
            if (outcome === "written") downloaded += 1;
            else conflicts += 1;
          } catch {
            failed += 1;
          }
        }
      }
      setSyncMessage(t("u_sync_done", { a: downloaded, c: conflicts, f: failed }));
      setSyncRunning(false);
      await choose(await filesFromDirectory(directoryHandle));
    } catch (reason) {
      setSyncMessage(t("u_sync_fail2", { m: reason instanceof Error ? reason.message : t("u_unknown_err") }));
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
      updateStatus(index, t("u_st_preparing"));
      try {
        const outcome = await uploadOne(item, (status) => updateStatus(index, status));
        processed.add(importFileKey(item));
        if (outcome === "duplicate") {
          duplicates += 1;
          updateStatus(index, t("u_st_duplicate"));
        } else {
          completed += 1;
        }
      } catch (reason) {
        failed += 1;
        updateStatus(index, t("u_st_failed", { m: reason instanceof Error ? reason.message : t("u_unknown_err") }));
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
    setMessage(t("u_batch_done", { a: completed, d: duplicates, f: failed, r: remaining.length }));
    setPhase("finished");
  }

  function chooseQuick(selected: FileList | File[] | null) {
    if (!selected || quickRunning) return;
    const selectedFiles = Array.from(selected);
    if (selectedFiles.length !== 1) {
      setQuickFiles([]);
      setQuickStatuses([]);
      setQuickMessage(t("u_q_one_only"));
      return;
    }
    const file = selectedFiles[0];
    if (!ALLOWED.has(ext(file.name)) || file.size <= 0 || file.size > MAX_FILE_BYTES || excludedName(file.name)) {
      setQuickFiles([]);
      setQuickStatuses([]);
      setQuickMessage(t("u_q_invalid"));
      return;
    }
    setQuickFiles([file]);
    setQuickStatuses([t("u_st_pending")]);
    setQuickMessage(t("u_q_selected"));
  }

  async function quickUpload() {
    if (!quickFiles.length || quickRunning || running) return;
    try {
      quickUploadRelativePath(quickDataset, "", quickFiles[0].name);
    } catch (reason) {
      setQuickMessage(reason instanceof Error ? reason.message : t("u_q_bad_name"));
      return;
    }

    setQuickRunning(true);
    let completed = 0;
    let duplicates = 0;
    let failed = 0;
    for (let index = 0; index < quickFiles.length; index += 1) {
      const file = quickFiles[index];
      updateQuickStatus(index, t("u_st_hashing"));
      try {
        const item: ImportFile = {
          file,
          dataset: quickDataset,
          relativePath: quickUploadRelativePath(quickDataset, "", file.name),
          sha256: await hashFile(file),
          status: t("u_st_preparing"),
        };
        const outcome = await uploadOne(item, (status) => updateQuickStatus(index, status));
        if (outcome === "duplicate") {
          duplicates += 1;
          updateQuickStatus(index, t("u_st_duplicate"));
        } else {
          completed += 1;
        }
      } catch (reason) {
        failed += 1;
        updateQuickStatus(index, t("u_st_failed", { m: reason instanceof Error ? reason.message : t("u_unknown_err") }));
      }
    }
    setQuickMessage(t("u_q_done", { a: completed, d: duplicates, f: failed }));
    if (failed === 0) {
      setQuickFiles([]);
      setQuickStatuses([]);
      if (quickInputRef.current) quickInputRef.current.value = "";
    }
    setQuickRunning(false);
  }

  async function startAnalysis() {
    if (!analysisStatus?.configured || analysisRunning) return;
    setAnalysisRunning(true);
    setAnalysisMessage(t("u_ai_starting"));
    try {
      await api.startPdAnalysis(analysisDataset, analysisLimit);
      setAnalysisMessage(t("u_ai_started", { d: analysisDataset === "both" ? t("u_both") : analysisDataset === "mfg" ? t("u_mfg") : t("u_buy"), n: analysisLimit }));
      window.setTimeout(() => void refreshAnalysisStatus(true), 3_000);
    } catch (reason) {
      setAnalysisMessage(t("u_ai_start_failed", { m: reason instanceof Error ? reason.message : t("u_unknown_err") }));
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
    setMessage(next.length ? t("u_next_ready", { n: next.length }) : t("u_all_done"));
  }

  function openFolderPicker() {
    if (!inputRef.current || running) return;
    inputRef.current.value = "";
    inputRef.current.click();
  }

  function downloadSkippedReport() {
    if (!inventory?.skipped.length) return;
    const rows = [
      [t("u_sk_reason"), t("u_sk_size"), t("u_sk_path")],
      ...inventory.skipped.map((item) => [SKIP_REASON_LABELS[item.reason], formatBytes(item.byteSize), item.relativePath]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `product-finder-skipped-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function updateStatus(index: number, status: string) {
    setFiles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status } : item));
  }

  const pageCopy = {
    batch: { eyebrow: "BATCH IMPORT", title: t("u_h_batch"), description: t("u_h_batch_d") },
    quick: { eyebrow: "MANUAL UPLOAD", title: t("u_h_quick"), description: t("u_h_quick_d") },
    sync: { eyebrow: "DIRECTORY SYNC", title: t("u_h_sync"), description: t("u_h_sync_d") },
    analysis: { eyebrow: "AI ANALYSIS", title: t("u_h_analysis"), description: t("u_h_analysis_d") },
  }[mode];

  return <>
    <PageHeader
      eyebrow={pageCopy.eyebrow}
      title={pageCopy.title}
      description={pageCopy.description}
    />
    <Link to={mode === "quick" ? "/" : "/upload"} className="mb-5 inline-flex rounded-lg px-1 py-1 text-sm font-bold text-slate-400 hover:text-cyan-300">← {mode === "quick" ? t("u_back_search") : t("u_back_tools")}</Link>
    <input
      ref={(node) => { inputRef.current = node; node?.setAttribute("webkitdirectory", ""); }}
      type="file"
      multiple
      className="hidden"
      onChange={(event) => void choose(event.target.files)}
    />
    {mode === "batch" && <Card className="p-5 md:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-xl bg-cyan-950/50 p-3 text-cyan-300"><RefreshCw size={22} /></span>
        <div><h2 className="text-[15px] font-semibold text-white">{t("u_scan_title")}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{t("u_scan_desc")}</p></div>
      </div>
      <button
        type="button"
        disabled={running}
        onClick={() => supportsDirectoryAccess() ? void setOrScanDefaultDirectory() : openFolderPicker()}
        className="flex min-h-52 w-full flex-col items-center justify-center rounded-[14px] border-2 border-dashed border-slate-700 bg-slate-950/30 p-8 text-center transition hover:border-cyan-600 hover:bg-cyan-950/10 disabled:cursor-wait disabled:opacity-60"
      >
        <span className="rounded-[14px] bg-slate-800 p-4 text-cyan-300">{phase === "inventory" ? <LoaderCircle className="animate-spin" size={30} /> : <FolderOpen size={30} />}</span>
        <span className="mt-4 text-[15px] font-semibold text-white">{directoryHandle ? t("u_scan_dir", { n: directoryHandle.name }) : t("u_set_dir")}</span>
        <span className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{t("u_dir_hint")}</span>
      </button>
      {directoryHandle && supportsDirectoryAccess() && <div className="mt-3 text-right"><Button variant="ghost" disabled={running} onClick={() => void setOrScanDefaultDirectory(true)}><FolderOpen size={17} />{t("u_change_default_dir")}</Button></div>}
      {inventory && <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label={t("u_inv_aria")}>
        <Metric label={t("u_m_total")} value={inventory.total} />
        <Metric label={t("u_m_eligible")} value={inventory.eligible} tone="cyan" />
        <Metric label={t("u_m_unique")} value={inventory.unique} tone="cyan" />
        <Metric label={t("u_m_indexed")} value={inventory.indexed} tone="green" />
        <Metric label={t("u_m_pending")} value={inventory.pending} tone="amber" />
        <Metric label={t("u_m_dupes")} value={inventory.folderDuplicates} />
      </div>}
      {inventory && inventory.skipped.length > 0 && <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/35 p-4" aria-label={t("u_skipped_aria")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-200">{t("u_skipped_n", { n: inventory.skipped.length })}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {skipReasonSummary(inventory.skipped).map(([reason, count]) => <Badge key={reason}>{SKIP_REASON_LABELS[reason]} {count}</Badge>)}
            </div>
          </div>
          <Button variant="ghost" onClick={downloadSkippedReport}><Download size={17} />{t("u_dl_skipped")}</Button>
        </div>
      </div>}

      {files.length > 0 && <>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="mr-2 text-sm font-semibold text-white">{t("u_batch_n", { n: files.length })}</p>
          <Badge tone="accent">{t("u_mfg")} {mfg.length}</Badge>
          <Badge tone="accent">{t("u_buy")} {buy.length}</Badge>
          <Badge>{formatBytes(files.reduce((sum, item) => sum + item.file.size, 0))}</Badge>
        </div>
        <div className="mt-4 max-h-[460px] overflow-auto rounded-xl border border-slate-700" tabIndex={0} aria-label={t("u_batch_aria")}>
          {files.map((item) => <div key={`${item.dataset}-${item.sha256}`} className="grid gap-2 border-b border-slate-800 px-4 py-3 text-sm last:border-0 md:grid-cols-[90px_minmax(0,1fr)_190px]">
            <span className={item.dataset === "mfg" ? "text-cyan-300" : "text-amber-300"}>{item.dataset === "mfg" ? t("u_mfg") : t("u_buy")}</span>
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
          <Button onClick={prepareNext}><RefreshCw size={18} />{t("u_next_batch")}</Button>
        ) : (
          <Button disabled={!files.length || phase !== "ready"} onClick={() => void upload()}>
            {phase === "uploading" ? <LoaderCircle className="animate-spin" size={18} /> : phase === "finished" ? <CheckCircle2 size={18} /> : <UploadCloud size={18} />}
            {phase === "idle" ? t("u_pick_dir_first") : phase === "inventory" ? t("u_inv_pct", { p: progress }) : phase === "uploading" ? t("u_imp_pct", { p: progress }) : phase === "finished" ? t("u_all_imported") : t("u_import_n", { n: files.length })}
          </Button>
        )}
      </div>
    </Card>}

    {mode === "quick" && <Card className="p-5 md:p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-amber-950/50 p-3 text-amber-300"><Zap size={22} /></span>
        <div><h2 className="text-[15px] font-semibold text-white">{t("u_h_quick")}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{t("u_q_desc")}</p></div>
      </div>
      <fieldset className="mt-6">
        <legend className="text-sm font-bold text-slate-300">{t("u_q_step1")}</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("u_q_lib_aria")}>
          <button type="button" role="radio" aria-checked={quickDataset === "mfg"} disabled={quickRunning} onClick={() => setQuickDataset("mfg")} className={`flex min-h-20 items-center gap-4 rounded-[14px] border-2 px-5 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-400 ${quickDataset === "mfg" ? "border-cyan-400 bg-cyan-950/50 text-white" : "border-slate-700 bg-slate-950/50 text-slate-400 hover:border-slate-500"}`}><Factory size={27} className={quickDataset === "mfg" ? "text-cyan-300" : "text-slate-500"} /><span><span className="block text-[15px] font-semibold">{t("u_mfg")}</span><span className="mt-1 block text-xs">OwnProduct</span></span>{quickDataset === "mfg" && <CheckCircle2 className="ml-auto text-cyan-300" size={22} />}</button>
          <button type="button" role="radio" aria-checked={quickDataset === "buy"} disabled={quickRunning} onClick={() => setQuickDataset("buy")} className={`flex min-h-20 items-center gap-4 rounded-[14px] border-2 px-5 text-left transition focus:outline-none focus:ring-2 focus:ring-amber-400 ${quickDataset === "buy" ? "border-amber-400 bg-amber-950/40 text-white" : "border-slate-700 bg-slate-950/50 text-slate-400 hover:border-slate-500"}`}><ShoppingBag size={27} className={quickDataset === "buy" ? "text-amber-300" : "text-slate-500"} /><span><span className="block text-[15px] font-semibold">{t("u_buy")}</span><span className="mt-1 block text-xs">Outsourcing</span></span>{quickDataset === "buy" && <CheckCircle2 className="ml-auto text-amber-300" size={22} />}</button>
        </div>
      </fieldset>

      <div className="mt-6">
        <p className="text-sm font-bold text-slate-300">{t("u_q_step2")}</p>
        <button type="button" disabled={quickRunning} onDragEnter={(event) => { event.preventDefault(); setQuickDragActive(true); }} onDragOver={(event) => { event.preventDefault(); setQuickDragActive(true); }} onDragLeave={() => setQuickDragActive(false)} onDrop={(event) => { event.preventDefault(); setQuickDragActive(false); chooseQuick(event.dataTransfer.files); }} onClick={() => { if (!quickInputRef.current) return; quickInputRef.current.value = ""; quickInputRef.current.click(); }} className={`mt-3 flex min-h-44 w-full flex-col items-center justify-center rounded-[14px] border-2 border-dashed p-6 text-center transition focus:outline-none focus:ring-2 focus:ring-cyan-400 ${quickDragActive ? "border-cyan-300 bg-cyan-950/50" : "border-slate-700 bg-slate-950/50 hover:border-cyan-700 hover:bg-cyan-950/20"}`}>
          <UploadCloud size={34} className={quickDragActive ? "text-cyan-200" : "text-cyan-400"} />
          <span className="mt-3 text-base font-semibold text-white">{quickDragActive ? t("u_q_drop_active") : t("u_q_drop")}</span>
          <span className="mt-1 text-sm text-slate-500">{t("u_q_or_pick")}</span>
        </button>
        <input ref={quickInputRef} type="file" className="hidden" onChange={(event) => chooseQuick(event.target.files)} />
      </div>

      {quickFiles.length > 0 && <div className="mt-5 overflow-hidden rounded-xl border border-slate-700">
        {quickFiles.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}`} className="grid gap-2 border-b border-slate-800 px-4 py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1fr)_120px_190px]">
          <span className="truncate text-slate-200" title={file.name}>{file.name}</span>
          <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
          <span className="text-xs text-slate-500">{quickStatuses[index]}</span>
        </div>)}
      </div>}

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="min-w-0 flex-1 text-sm leading-6 text-slate-400">{quickMessage || t("u_q_hint")}</p>
        <Button disabled={!quickFiles.length || quickRunning || running} onClick={() => void quickUpload()}>
          {quickRunning ? <LoaderCircle className="animate-spin" size={18} /> : <UploadCloud size={18} />}
          {quickRunning ? t("u_st_uploading") : quickFiles.length ? t("u_q_btn_up") : t("u_q_btn_pick")}
        </Button>
      </div>
    </Card>}

    {mode === "sync" && <>
    <Card className="p-5 md:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-xl bg-cyan-950/50 p-3 text-cyan-300"><FolderOpen size={22} /></span>
        <div><h2 className="text-[15px] font-semibold text-white">{t("u_s_dir_title")}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{t("u_s_dir_desc")}</p></div>
      </div>
      <Button disabled={running} onClick={() => supportsDirectoryAccess() ? void setOrScanDefaultDirectory() : openFolderPicker()}>
        {phase === "inventory" ? <LoaderCircle className="animate-spin" size={18} /> : <FolderOpen size={18} />}
        {directoryHandle ? t("u_scan_dir", { n: directoryHandle.name }) : t("u_set_dir")}
      </Button>
      {directoryHandle && supportsDirectoryAccess() && <Button className="ml-3" variant="ghost" disabled={running} onClick={() => void setOrScanDefaultDirectory(true)}>{t("u_change_dir")}</Button>}
      {message && <p role="status" className="mt-3 text-sm leading-6 text-slate-400">{message}</p>}
    </Card>
    <Card className="mt-6 p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-emerald-950/50 p-3 text-emerald-300"><Download size={22} /></span>
          <div><h2 className="text-[15px] font-semibold text-white">{t("u_s_title")}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{t("u_s_desc")}</p></div>
        </div>
        <Button variant="secondary" disabled={!localFiles.length || syncRunning} onClick={() => void refreshSync()}><RefreshCw size={17} />{t("u_s_rescan")}</Button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Metric label={t("u_s_same")} value={syncCurrent} tone="green" />
        <Metric label={t("u_s_missing")} value={serverOnly.length} tone="cyan" />
        <Metric label={t("u_s_conflict")} value={syncConflicts.length} tone="amber" />
      </div>
      {syncConflicts.length > 0 && <div className="mt-4 max-h-40 overflow-auto rounded-xl border border-amber-900/70 bg-amber-950/20 p-3 text-xs leading-6 text-amber-200">
        <p className="mb-1 font-semibold">{t("u_s_conflict_note")}</p>
        {syncConflicts.map((item) => <p key={`${item.dataset}-${item.id}`} className="truncate" title={item.relativePath}>{item.relativePath}</p>)}
      </div>}
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="min-w-0 flex-1 text-sm leading-6 text-slate-400">{syncMessage || (directoryHandle ? t("u_s_hint_scan") : t("u_s_hint_set"))}</p>
        <Button disabled={!directoryHandle || !serverOnly.length || syncRunning} onClick={() => void downloadServerOnly()}>
          {syncRunning ? <LoaderCircle className="animate-spin" size={18} /> : <Download size={18} />}
          {syncRunning ? t("u_s_running") : t("u_s_btn", { n: serverOnly.length })}
        </Button>
      </div>
    </Card></>}

    {mode === "analysis" && <AnalysisControl
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
    />}
  </>;
}

export function UploaderAccessPage() {
  const t = useT();
  const { profile } = useAuth();
  const [items, setItems] = useState<PdUploader[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getPdUploaders();
      setItems(result.items);
      setMessage(t("u_us_synced", { n: result.items.length }));
    } catch (reason) {
      setMessage(t("u_us_list_failed", { m: reason instanceof Error ? reason.message : t("u_unknown_err") }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { if (profile?.role === "admin") void load(); }, [load, profile?.role]);

  async function toggle(item: PdUploader, permission: "upload" | "sync") {
    const currentAllowed = permission === "upload" ? item.uploadAllowed : item.syncAllowed;
    setMessage(t("u_us_updating", { n: item.displayName }));
    try {
      await api.setPdUploader(item.id, permission, !currentAllowed);
      setItems((current) => current.map((value) => value.id === item.id ? {
        ...value,
        [permission === "upload" ? "uploadAllowed" : "syncAllowed"]: !currentAllowed,
      } : value));
      setMessage(t("u_us_updated", { n: item.displayName, p: permission === "upload" ? t("u_us_p_upload") : t("u_us_p_sync") }));
    } catch (reason) {
      setMessage(t("u_us_update_failed", { m: reason instanceof Error ? reason.message : t("u_unknown_err") }));
    }
  }

  if (profile?.role !== "admin") {
    return <Card className="p-8 text-center"><p className="font-semibold text-white">{t("u_us_admin_only")}</p></Card>;
  }

  return <>
    <PageHeader eyebrow="USERS" title="Users" description={t("u_us_desc")} action={<Button variant="secondary" disabled={loading} onClick={() => void load()}>{loading ? <LoaderCircle className="animate-spin" size={17} /> : <RefreshCw size={17} />}{t("u_us_resync")}</Button>} />
    <Link to="/upload" className="mb-5 inline-flex rounded-lg px-1 py-1 text-sm font-bold text-slate-400 hover:text-cyan-300">← {t("u_back_tools")}</Link>
    <Card className="p-5 md:p-6">
    <div className="flex items-start gap-3">
      <span className="rounded-xl bg-violet-950/50 p-3 text-violet-300"><ShieldCheck size={22} /></span>
      <div><h2 className="text-[15px] font-semibold text-white">Users</h2><p className="mt-1 text-sm leading-6 text-slate-500">{t("u_us_note")}</p></div>
    </div>
    <div className="mt-5 overflow-hidden rounded-xl border border-slate-700">
      {loading ? <p className="p-4 text-sm text-slate-400">{t("u_us_loading")}</p> : items.map((item) => <div key={item.id} className="grid gap-3 border-b border-slate-800 px-4 py-3 last:border-0 hover:bg-slate-800/50 md:grid-cols-[minmax(0,1fr)_150px_190px] md:items-center">
        <span className="min-w-0"><span className="flex items-center gap-2"><span className="truncate text-sm font-bold text-slate-200">{item.displayName}</span><Badge tone={item.platformActive ? "success" : "neutral"}>{item.platformActive ? t("u_us_active") : t("u_us_inactive")}</Badge></span><span className="block truncate text-xs text-slate-500">{item.email} · {item.id}{item.platformStatus ? ` · ${item.platformStatus}` : ""}</span></span>
        <label className={`flex items-center gap-2 text-sm font-semibold ${item.platformActive ? "cursor-pointer text-slate-300" : "cursor-not-allowed text-slate-600"}`}><input type="checkbox" checked={item.uploadAllowed} disabled={!item.platformActive || item.platformRole === "admin"} onChange={() => void toggle(item, "upload")} className="h-4 w-4 accent-cyan-400" />{t("u_us_p_upload")}</label>
        <label className={`flex items-center gap-2 text-sm font-semibold ${item.platformActive ? "cursor-pointer text-amber-300" : "cursor-not-allowed text-slate-600"}`}><input type="checkbox" checked={item.syncAllowed} disabled={!item.platformActive} onChange={() => void toggle(item, "sync")} className="h-4 w-4 accent-amber-400" />{t("u_us_p_sync")}</label>
      </div>)}
    </div>
    {message && <p role="status" className="mt-3 text-sm text-slate-400">{message}</p>}
  </Card></>;
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
  const t = useT();
  const selected = status ? selectedAnalysisStatus(status, dataset) : emptyAnalysisStatus();
  const ready = selected.queued + selected.retryableFailed;
  const disabled = !status?.configured || ready === 0 || selected.processing > 0 || running || pageBusy;
  return <Card className="mt-6 overflow-hidden border-cyan-900/70 bg-gradient-to-br from-slate-900 to-cyan-950/20 p-0">
    <div className="border-b border-slate-800 p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-cyan-950/70 p-3 text-cyan-300"><BrainCircuit size={22} /></span>
          <div><h2 className="text-[15px] font-semibold text-white">{t("u_ai_title")}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{t("u_ai_desc")}</p></div>
        </div>
        <Button variant="ghost" disabled={running} onClick={onRefresh}><RefreshCw size={17} />{t("u_ai_refresh")}</Button>
      </div>
    </div>

    <div className="grid gap-4 p-5 md:grid-cols-2 md:p-6">
      <AnalysisLibraryCard title={t("u_mfg")} status={status?.mfg || emptyAnalysisStatus()} tone="cyan" />
      <AnalysisLibraryCard title={t("u_buy")} status={status?.buy || emptyAnalysisStatus()} tone="amber" />
    </div>

    <div className="border-t border-slate-800 bg-slate-950/30 p-5 md:p-6">
      <div className="grid gap-4 lg:grid-cols-[220px_180px_minmax(0,1fr)_auto] lg:items-end">
        <label className="text-sm font-bold text-slate-300">{t("u_ai_lib")}
          <select value={dataset} onChange={(event) => onDatasetChange(event.target.value as PdDataset | "both")} disabled={running} className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-cyan-500">
            <option value="both">{t("u_both")}</option>
            <option value="mfg">{t("u_ai_only_mfg")}</option>
            <option value="buy">{t("u_ai_only_buy")}</option>
          </select>
        </label>
        <label className="text-sm font-bold text-slate-300">{t("u_ai_limit")}
          <input type="number" min={1} max={50} value={limit} onChange={(event) => onLimitChange(Math.min(50, Math.max(1, Number(event.target.value) || 1)))} disabled={running} className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-slate-100 outline-none focus:border-cyan-500" />
        </label>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm leading-6 text-slate-400">
          <span className="font-semibold text-white">{t("u_ai_ready", { n: ready })}</span>
          <span className="mx-2 text-slate-700">|</span>{t("u_ai_processing_n", { n: selected.processing })}
        </div>
        <Button disabled={disabled} onClick={onStart} className="h-12 px-6">
          {running ? <LoaderCircle className="animate-spin" size={18} /> : <Play size={18} />}
          {running ? t("u_ai_starting_btn") : selected.processing > 0 ? t("u_ai_running") : ready > 0 ? t("u_ai_start_n", { n: Math.min(ready, limit * (dataset === "both" ? 2 : 1)) }) : t("u_ai_none")}
        </Button>
      </div>
      <p role="status" className={`mt-3 text-sm leading-6 ${status && !status.configured ? "text-amber-300" : "text-slate-400"}`}>
        {status && !status.configured ? t("u_ai_setup") : message || t("u_ai_tip")}
      </p>
    </div>
  </Card>;
}

function AnalysisLibraryCard({ title, status, tone }: { title: string; status: PdAnalysisLibraryStatus; tone: "cyan" | "amber" }) {
  const t = useT();
  return <div className="rounded-[14px] border border-slate-800 bg-slate-950/55 p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-white">{title}</h3><span className={tone === "cyan" ? "text-cyan-300" : "text-amber-300"}>{status.queued + status.retryableFailed} {t("u_ai_pending")}</span></div>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <AnalysisMetric label={t("u_ai_m_queued")} value={status.queued} />
      <AnalysisMetric label={t("u_ai_m_processing")} value={status.processing} />
      <AnalysisMetric label={t("u_ai_m_retryable")} value={status.retryableFailed} />
      <AnalysisMetric label={t("u_ai_m_completed")} value={status.completed} />
    </div>
    {status.blockedFailed > 0 && <p className="mt-3 text-xs font-semibold text-rose-300">{t("u_ai_blocked", { n: status.blockedFailed })}</p>}
  </div>;
}

function AnalysisMetric({ label, value }: { label: string; value: number }) {
  return <div><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-1 text-[15px] font-semibold tabular-nums text-slate-200">{value}</p></div>;
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
  return <div className={`rounded-xl border p-4 ${colors[tone]}`}><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-[16px] font-semibold tabular-nums">{value}</p></div>;
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
    if (!init.storagePath) throw new Error(tr("u_e_no_path"));
    storagePath = init.storagePath;

    if (init.storageExists) {
      onStatus(tr("u_st_exists"));
      break;
    }
    if (!init.signedUrl) throw new Error(tr("u_e_no_url"));

    if (shouldUseResumableUpload(item.file.size)) {
      if (!init.signedToken) throw new Error(tr("u_e_no_token"));
      onStatus(tr("u_st_big_prep"));
      try {
        await uploadResumable(item, storagePath, init.signedToken, onStatus);
        break;
      } catch (error) {
        if (!isSignedTusAuthError(error)) throw error;
        onStatus(tr("u_st_big_fallback"));
      }
    }

    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", item.file);
    onStatus(attempt === 1 ? tr("u_st_uploading") : tr("u_st_retry", { n: attempt }));

    let response: Response;
    try {
      response = await fetch(init.signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: form,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(tr("u_e_storage"));
      if (attempt === 3) throw lastError;
      onStatus(tr("u_st_conn_retry", { n: attempt + 1 }));
      await delay(700 * attempt);
      continue;
    }

    const responseText = response.ok ? "" : await response.text();
    if (response.ok || /resource already exists/i.test(responseText)) break;

    lastError = storageUploadError(item.file, response.status, responseText);
    if (!isTransientUploadStatus(response.status) || attempt === 3) throw lastError;

    onStatus(tr("u_st_tmp_retry", { n: attempt + 1 }));
    await delay(700 * attempt);
  }

  if (!storagePath) throw lastError || new Error(tr("u_e_storage"));

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
  onStatus(result.analysisStatus === "metadata_only" ? tr("u_st_meta_idx") : tr("u_st_doc_idx"));
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
        onStatus(tr("u_st_big_pct", { p: percentage }));
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
  return selectIncrementalBatch(files, BATCH_SIZE).map((item) => ({ ...item, status: tr("u_st_pending") }));
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
  /* 🔴 這裡的「名片」是**比對實際檔名**的規則，不是介面文字 —— 不可以翻譯。
     i18n 掃描時會把它當成漏翻的中文，那是誤判。*/
  return name === ".DS_Store" || /\.log(?:\.\d+)?$|\.bak$|名片|business\s*card/i.test(name);
}

function skippedReason(file: File, dataset: PdDataset | null, extension: string): SkipReason | null {
  if (!dataset) return "outside_dataset";
  if (file.size <= 0) return "empty";
  if (excludedName(file.name)) return "excluded";
  if (file.size > MAX_FILE_BYTES) return "oversized";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (!ALLOWED.has(extension)) return "unsupported";
  return null;
}

function skipReasonSummary(files: SkippedFile[]) {
  const counts = new Map<SkipReason, number>();
  files.forEach((file) => counts.set(file.reason, (counts.get(file.reason) || 0) + 1));
  return [...counts.entries()];
}

function storageUploadError(file: File, status: number, responseText: string) {
  const detail = storageErrorDetail(responseText);
  if (status === 413 || /EntityTooLarge|maximum allowed size|exceeded.*size/i.test(responseText)) {
    return new Error(tr("u_e_too_big", { s: formatBytes(file.size) }));
  }
  return new Error(tr("u_e_storage_s", { s: status, d: detail ? `：${detail}` : "" }));
}

function storageErrorDetail(responseText: string) {
  let value: unknown = responseText;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof value !== "string") break;
    try { value = JSON.parse(value); } catch { break; }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message = record.message || record.error || record.code;
    if (typeof message === "string") return message.slice(0, 240);
  }
  return typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, 240) : "";
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function ext(name: string) { return name.toLowerCase().split(".").pop() || ""; }
async function hashFile(file: File) { const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join(""); }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
