import {
  ArrowLeft,
  Boxes,
  Download,
  FileText,
  FolderOpen,
  LockKeyhole,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import type { DocumentSummary } from "../lib/types";
import {
  formatBytes,
  formatDate,
  processingLabels,
  sensitivityLabels,
} from "../lib/utils";

export function DocumentDetailPage() {
  const { id = "" } = useParams();
  const [document, setDocument] = useState<DocumentSummary | null | undefined>();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setPreviewUrl(null);
    void api.getDocument(id).then(async (result) => {
      setDocument(result);
      if (result) {
        const kind = isImageExtension(result.extension) ? "source" : "preview";
        setPreviewUrl(await api.getFileUrl(result.id, kind));
      }
    });
  }, [id]);

  async function download() {
    const url = await api.getFileUrl(id, "source");
    if (url) window.location.assign(url);
  }

  if (document === undefined) return <p>載入文件…</p>;
  if (!document) return <p>找不到文件。</p>;

  return (
    <>
      <Link
        to="/documents"
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600"
      >
        <ArrowLeft size={17} />
        回到文件搜尋
      </Link>
      <PageHeader
        eyebrow={`${document.extension.toUpperCase()} · Version ${document.version}`}
        title={document.title}
        description={document.sourcePath}
        action={
          <Button onClick={() => void download()}>
            <Download size={17} />
            下載原檔
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-h-[680px] overflow-hidden">
          <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-slate-50 px-4">
            <p className="text-sm font-bold text-slate-700">文件預覽</p>
            <Badge tone="success">{processingLabels[document.processingStatus]}</Badge>
          </div>
          <div className="flex min-h-[628px] items-center justify-center bg-slate-100 text-center">
            {previewUrl && isImageExtension(document.extension) ? (
              <img
                src={previewUrl}
                alt={`${document.title} 預覽`}
                className="max-h-[628px] max-w-full object-contain"
              />
            ) : previewUrl ? (
              <iframe
                src={previewUrl}
                title={`${document.title} 預覽`}
                className="h-[628px] w-full border-0 bg-white"
              />
            ) : (
            <div className="p-8">
              <FileText className="mx-auto text-slate-400" size={54} />
              <p className="mt-4 font-bold text-slate-700">
                {isImageExtension(document.extension)
                  ? "圖片預覽暫時無法載入"
                  : document.extension.toLowerCase() === "pdf"
                    ? "PDF 預覽暫時無法載入"
                    : "Office 預覽由背景工作器轉為 PDF"}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                可先使用右上角「下載原檔」。
              </p>
            </div>
            )}
          </div>
        </Card>

        <aside className="space-y-5">
          <Card className="p-5">
            <h2 className="font-black text-slate-950">文件資訊</h2>
            <dl className="mt-4 space-y-4 text-sm">
              <Info label="檔案大小" value={formatBytes(document.byteSize)} />
              <Info
                label="頁面／工作表"
                value={document.pageCount?.toString() ?? "未取得"}
              />
              <Info label="最後更新" value={formatDate(document.updatedAt)} />
              <Info
                label="敏感等級"
                value={sensitivityLabels[document.sensitivity]}
              />
              <Info label="文件類型" value={document.documentType} />
            </dl>
          </Card>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <FolderOpen className="mt-0.5 text-cyan-800" size={19} />
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-950">來源位置</p>
                <p className="mt-2 break-words text-xs leading-5 text-slate-500">
                  {document.sourcePath}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <LockKeyhole className="mt-0.5 text-slate-600" size={19} />
              <div>
                <p className="text-sm font-black text-slate-950">下載會被記錄</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  系統會記錄使用者、檔案、時間與敏感等級；下載連結短時間後失效。
                </p>
              </div>
            </div>
          </Card>
        </aside>
      </div>
      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-slate-700 bg-slate-800/60 p-5">
          <h2 className="flex items-center gap-2 font-black text-slate-100">
            <Boxes className="text-cyan-300" size={19} />
            AI 文件分析
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            完整產品、產品候選、變體、設計資產與零件都會列在這裡；沒有項目時會明確說明原因。
          </p>
        </div>
        {document.analysis?.summary && (
          <div className="border-b border-slate-700 bg-slate-900/40 px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              文件摘要
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {document.analysis.summary}
            </p>
          </div>
        )}
        {document.analysis?.status === "legacy" && (
          <div className="border-b border-amber-700/40 bg-amber-950/30 px-5 py-4 text-sm leading-6 text-amber-200">
            這是舊版 AI 分析。當時沒有保存「建立理由」與「身分證據」，不是檔案內容不存在；重新分析後才會補齊。
          </div>
        )}
        {document.analysis?.status === "not_analyzed" && (
          <div className="border-b border-slate-700 bg-slate-900/40 px-5 py-4 text-sm leading-6 text-slate-300">
            這份文件尚未完成 AI 分析，因此目前沒有文件摘要、建立理由或身分證據。
          </div>
        )}
        {document.extractedItems?.length ? (
          <div className="divide-y divide-slate-700">
            {document.extractedItems.map((item) => (
              <article
                key={item.id}
                className="grid gap-3 p-5 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={item.kind === "product_candidate" ? "warning" : "neutral"}>
                      {itemKindLabels[item.kind]}
                    </Badge>
                    <strong className="text-slate-100">{item.name}</strong>
                    {!!item.modelNumbers.length && (
                      <span className="text-xs font-bold text-slate-500">
                        {item.modelNumbers.join("、")}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {item.rationale || (
                      document.analysis?.status === "legacy"
                        ? "舊版分析未保存建立理由。"
                        : "AI 未提供建立理由，需重新分析或人工補充。"
                    )}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    身分證據：
                    {item.identitySignals.length
                      ? item.identitySignals
                          .map((signal) => identitySignalLabels[signal] || signal)
                          .join("、")
                      : "無足夠身分證據"}
                  </p>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-lg font-black text-cyan-300">
                    {Math.round(item.confidence * 100)}%
                  </p>
                  <p className="text-xs text-slate-500">AI 自評信心</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <Boxes className="mx-auto text-slate-600" size={38} />
            <p className="mt-4 font-bold text-slate-200">
              {document.analysis?.status === "current"
                ? "AI 未辨識到產品型項"
                : "目前沒有可顯示的辨識項目"}
            </p>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              {document.analysis?.status === "current"
                ? "這可能是合約、會議、供應商資料，或圖片／Office 內容不足以證明一個可獨立識別的產品。文件仍保留於全文索引。"
                : "舊版分析需要重新執行 v2，才能補上產品類型、建立理由與身分證據。"}
            </p>
          </div>
        )}
      </Card>
    </>
  );
}

function isImageExtension(extension: string) {
  return ["jpg", "jpeg", "png"].includes(extension.toLowerCase());
}

const itemKindLabels = {
  complete_product: "完整產品",
  product_variant: "產品變體",
  design_asset: "設計資產",
  component: "零件／模組",
  commercial_line_item: "商業品項",
  product_candidate: "產品候選",
};

const identitySignalLabels: Record<string, string> = {
  explicit_product_name: "文件內明確產品名稱",
  model_number: "型號",
  complete_product_image: "完整產品影像",
  function_description: "功能說明",
  specification_set: "規格組",
  pricing_line: "價格品項",
  filename_or_folder_only: "僅檔名／資料夾",
};

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
