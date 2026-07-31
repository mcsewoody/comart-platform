import { ArrowUpRight, Boxes, FileText, Factory } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProductSummary } from "../lib/types";
import { formatDate } from "../lib/utils";
import { Badge, Card, ConfirmationBadge } from "./ui";

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <Card className="group overflow-hidden transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg">
      <Link
        to={`/products/${product.id}`}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-700"
      >
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(54,197,190,0.16),transparent_38%),linear-gradient(145deg,#121d2a,#0b111a)]">
          {product.thumbnailUrl ? (
            <img
              src={product.thumbnailUrl}
              alt={`${product.nameZhTw} 來源代表圖`}
              className="h-full w-full object-contain p-4"
            />
          ) : (
            <div className="text-center text-slate-400">
              <Boxes className="mx-auto" size={42} />
              <p className="mt-2 text-xs font-semibold">尚未選取來源代表圖</p>
            </div>
          )}
          <span className="absolute left-4 top-4 rounded-lg bg-white/90 px-2 py-1 text-[11px] font-bold text-slate-600 shadow-sm">
            {product.category?.nameZhTw ?? "待分類"}
          </span>
          <span className="absolute right-4 top-4 rounded-full bg-slate-950 p-2 text-white opacity-0 transition group-hover:opacity-100">
            <ArrowUpRight size={16} />
          </span>
        </div>
        <div className="p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold uppercase tracking-[0.08em] text-cyan-800">
                {product.modelNumbers.join(" · ") || "型號待確認"}
              </p>
              <h2 className="mt-1 line-clamp-2 text-lg font-black leading-6 text-slate-950">
                {product.nameZhTw}
              </h2>
            </div>
            <ConfirmationBadge status={product.confirmationStatus} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {product.functions.slice(0, 3).map((item) => (
              <Badge key={item}>{item}</Badge>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <Factory size={14} />
              {product.suppliers[0]?.name ?? "廠商待確認"}
            </span>
            <span className="flex items-center justify-end gap-1.5">
              <FileText size={14} />
              {product.documentCount} 份來源
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Boxes size={13} />
              {product.brand ?? "無品牌"}
            </span>
            <span>更新 {formatDate(product.updatedAt)}</span>
          </div>
        </div>
      </Link>
    </Card>
  );
}
