import { ArrowUpRight, FileArchive, FileText } from "lucide-react";
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
        <div className="rounded-xl bg-slate-100 p-2.5 text-slate-600">
          {document.extension === "zip" ? (
            <FileArchive size={20} />
          ) : (
            <FileText size={20} />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-950">
            {document.title}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {document.sourcePath}
          </p>
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
