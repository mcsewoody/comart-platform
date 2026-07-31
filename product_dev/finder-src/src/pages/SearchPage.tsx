import { FileQuestion, Filter, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ProductCard } from "../components/ProductCard";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import type {
  Category,
  ConfirmationStatus,
  ProductSummary,
  SearchFilters,
  SupplierOption,
} from "../lib/types";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    void api.getCategories().then(setCategories);
    void api.getSuppliers().then(setSuppliers);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api.searchProducts(params.get("q") ?? "", filters).then((result) => {
      if (!active) return;
      setProducts(result.items);
      setElapsed(result.elapsedMs);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [filters, params]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (query.trim()) next.set("q", query.trim());
    else next.delete("q");
    setParams(next);
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <>
      <PageHeader
        eyebrow="Product intelligence"
        title="找到既有產品，不從零開始"
        description="輸入型號、廠商、產品類別，或用自然語句描述需求。精確型號優先，再融合全文與跨語言語意結果。"
      />

      <form
        onSubmit={submit}
        role="search"
        className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              size={21}
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-12 w-full rounded-xl border-0 bg-slate-50 pl-12 pr-10 text-base font-medium text-slate-950 outline-none ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-cyan-700"
              placeholder="例如：ID-001A、可折疊三合一桌面充、17mm 球頭支架"
              aria-label="搜尋產品"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                aria-label="清除搜尋"
              >
                <X size={17} />
              </button>
            )}
          </div>
          <Button type="submit" className="h-12 px-6">
            搜尋
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-12 px-3 md:px-4"
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
            aria-label="搜尋篩選"
          >
            <SlidersHorizontal size={18} />
            <span className="hidden md:inline">篩選</span>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-cyan-100 px-1.5 text-[11px] text-cyan-900">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        {filtersOpen && (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectFilter
              label="產品類別"
              value={filters.categoryId ?? ""}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  categoryId: value || undefined,
                }))
              }
              options={categories.map((category) => ({
                value: category.id,
                label: category.nameZhTw,
              }))}
            />
            <SelectFilter
              label="廠商"
              value={filters.supplierId ?? ""}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  supplierId: value || undefined,
                }))
              }
              options={suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              }))}
              placeholder="全部廠商"
            />
            <SelectFilter
              label="來源格式"
              value={filters.extension ?? ""}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  extension: value || undefined,
                }))
              }
              options={["pdf", "jpg", "png", "pptx", "xlsx", "docx"].map(
                (item) => ({ value: item, label: item.toUpperCase() }),
              )}
            />
            <SelectFilter
              label="確認狀態"
              value={filters.confirmationStatus ?? ""}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  confirmationStatus:
                    (value as ConfirmationStatus) || undefined,
                }))
              }
              options={[
                { value: "human_confirmed", label: "已人工確認" },
                { value: "ai_high_confidence", label: "AI 高信心" },
                { value: "needs_review", label: "待確認" },
                { value: "conflict", label: "有衝突" },
              ]}
            />
            <label className="flex h-10 items-center gap-2 self-end rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={filters.uncategorized ?? false}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    uncategorized: event.target.checked || undefined,
                  }))
                }
                className="h-4 w-4 accent-cyan-600"
              />
              僅顯示未分類
            </label>
            <label className="flex h-10 items-center gap-2 self-end rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={filters.withoutSupplier ?? false}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    withoutSupplier: event.target.checked || undefined,
                  }))
                }
                className="h-4 w-4 accent-cyan-600"
              />
              僅顯示未連結廠商
            </label>
          </div>
        )}
      </form>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {loading ? "搜尋中…" : `${products.length} 個產品 · ${elapsed} ms`}
        </p>
        {activeFilterCount > 0 && (
          <button
            className="flex items-center gap-1.5 text-sm font-semibold text-cyan-800 hover:text-cyan-950"
            onClick={() => setFilters({})}
          >
            <Filter size={15} />
            清除篩選
          </button>
        )}
      </div>

      {!loading && products.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={<FileQuestion size={26} />}
            title="沒有找到相符產品"
            description="嘗試縮短型號、改用功能描述，或切換到文件搜尋查看尚未建立產品主檔的來源。"
          />
        </div>
      ) : (
        <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </>
  );
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
  placeholder = "全部",
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-bold text-slate-600">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-cyan-700 focus:ring-2 focus:ring-cyan-100"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
