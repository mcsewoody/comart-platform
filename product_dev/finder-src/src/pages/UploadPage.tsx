import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileUp,
  LoaderCircle,
  UploadCloud,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import type { ProcessingJob, Sensitivity } from "../lib/types";
import { processingLabels } from "../lib/utils";

export function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [sensitivity, setSensitivity] = useState<Sensitivity>("general");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);

  useEffect(() => {
    void api.getJobs().then(setJobs);
  }, []);

  async function upload() {
    if (!files.length) return;
    setUploading(true);
    setMessage("");
    try {
      await api.uploadFiles(files, sensitivity);
      setMessage(`${files.length} 個檔案已加入處理佇列。`);
      setFiles([]);
      setJobs(await api.getJobs());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上傳失敗");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Ingestion"
        title="上傳與處理進度"
        description="上傳只負責把原檔寫入私有 Storage 並建立工作。AI、轉檔與 Embedding 由 GitHub Actions 每五分鐘領取。"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-6">
          <button
            type="button"
            className="flex min-h-72 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition hover:border-cyan-700 hover:bg-cyan-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-700"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <span className="rounded-2xl bg-white p-4 text-cyan-800 shadow-sm">
              <UploadCloud size={30} />
            </span>
            <span className="mt-5 text-lg font-black text-slate-950">
              拖拉檔案，或點此選擇
            </span>
            <span className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
              深度解析 JPG、PNG、PDF、PPT、Excel 與 Word。CAD、STEP、影片及超過
              100 MB 的大檔只建立索引與下載入口。
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) =>
              setFiles(Array.from(event.target.files ?? []))
            }
          />

          {files.length > 0 && (
            <div className="mt-5">
              <p className="mb-3 text-sm font-bold text-slate-800">
                已選擇 {files.length} 個檔案
              </p>
              <div className="max-h-48 overflow-auto rounded-xl border border-slate-200">
                {files.map((file) => (
                  <div
                    key={`${file.name}-${file.size}`}
                    className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm last:border-0"
                  >
                    <span className="truncate font-semibold text-slate-800">
                      {file.name}
                    </span>
                    <span className="ml-4 shrink-0 text-xs text-slate-500">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <label>
              <span className="mb-2 block text-sm font-bold text-slate-800">
                敏感等級
              </span>
              <select
                value={sensitivity}
                onChange={(event) =>
                  setSensitivity(event.target.value as Sensitivity)
                }
                className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm"
              >
                <option value="general">一般</option>
                <option value="commercial">商業敏感</option>
                <option value="highly_confidential">高度機密</option>
              </select>
            </label>
            <Button
              disabled={!files.length || uploading}
              onClick={() => void upload()}
            >
              {uploading ? (
                <LoaderCircle className="animate-spin" size={18} />
              ) : (
                <FileUp size={18} />
              )}
              {uploading ? "上傳中…" : "上傳並加入佇列"}
            </Button>
          </div>
          {message && (
            <p
              role="status"
              className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700"
            >
              {message}
            </p>
          )}
        </Card>

        <aside>
          <Card className="p-5">
            <h2 className="font-black text-slate-950">處理規則</h2>
            <ul className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
              <li className="flex gap-3">
                <CheckCircle2
                  className="mt-1 shrink-0 text-emerald-700"
                  size={17}
                />
                相同 SHA-256 不會重複建立檔案。
              </li>
              <li className="flex gap-3">
                <Clock3 className="mt-1 shrink-0 text-cyan-800" size={17} />
                新工作通常在五分鐘內開始，但 GitHub Actions 可能排隊。
              </li>
              <li className="flex gap-3">
                <AlertTriangle
                  className="mt-1 shrink-0 text-amber-700"
                  size={17}
                />
                AI 不會自動合併產品；疑似重複只建立審核建議。
              </li>
            </ul>
          </Card>
        </aside>
      </div>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-black text-slate-950">最近工作</h2>
        <Card className="overflow-hidden">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="grid gap-4 border-b border-slate-100 p-4 last:border-0 md:grid-cols-[minmax(0,1fr)_120px_180px] md:items-center"
            >
              <div>
                <p className="text-sm font-bold text-slate-950">
                  {job.documentTitle}
                </p>
                <p className="mt-1 text-xs text-slate-500">{job.message}</p>
              </div>
              <Badge
                tone={
                  job.status === "completed"
                    ? "success"
                    : job.status === "failed"
                      ? "danger"
                      : "warning"
                }
              >
                {processingLabels[job.status]}
              </Badge>
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>進度</span>
                  <span>{job.progress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-cyan-700"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </Card>
      </section>
    </>
  );
}
