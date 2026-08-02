import { ArrowUpRight, FileArchive, FileText, ImageOff } from "lucide-react";
import { Link } from "react-router-dom";
import type { DocumentSummary } from "../lib/types";
import {
  formatBytes,
  formatDate,
  processingLabels,
  sensitivityLabels,
} from "../lib/utils";
import { Badge } from "./ui";

export function DocumentRow({ document }: { document: DocumentSummary }) {
  return (
    <Link
      to={`/documents/${document.id}`}
      className="grid gap-4 border-b border-slate-100 px-4 py-4 transition last:border-b-0 hover:bg-slate-50 md:grid-cols-[minmax(0,1fr)_120px_120px_32px] md:items-center"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="relative flex h-20 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-slate-500">
          {document.thumbnailUrl ? (
            <img
              src={document.thumbnailUrl}
              alt={`${document.title} 預覽`}
              loading="lazy"
              className="h-full w-full object-contain p-1"
            />
          ) : document.extension === "zip" ? (
            <FileArchive size={24} />
          ) : (
            <ImageOff size={24} />
          )}
          <span className="absolute bottom-1 left-1 rounded bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-black text-white">
            {document.extension.toUpperCase() || <FileText size={11} />}
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-950">
            {document.title}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {document.sourcePath}
          </p>
          {document.matchReason && (
            <p className="mt-1 truncate text-xs font-semibold text-cyan-800">
              命中：{document.matchReason}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5 md:hidden">
            <Badge>{document.extension.toUpperCase()}</Badge>
            <Badge tone={document.sensitivity === "general" ? "neutral" : "warning"}>
              {sensitivityLabels[document.sensitivity]}
            </Badge>
          </div>
        </div>
      </div>
      <div className="hidden text-xs text-slate-500 md:block">
        <p>{formatBytes(document.byteSize)}</p>
        <p className="mt-1">{formatDate(document.updatedAt)}</p>
      </div>
      <div className="hidden md:block">
        <Badge
          tone={
            document.processingStatus === "completed"
              ? "success"
              : document.processingStatus === "failed"
                ? "danger"
                : "warning"
          }
        >
          {processingLabels[document.processingStatus]}
        </Badge>
      </div>
      <ArrowUpRight className="hidden text-slate-400 md:block" size={17} />
    </Link>
  );
}
