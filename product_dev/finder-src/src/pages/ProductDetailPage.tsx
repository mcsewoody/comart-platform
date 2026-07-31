import {
  ArrowLeft,
  Box,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Languages,
  Ruler,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, Badge, Button, ConfirmationBadge } from "../components/ui";
import { api } from "../lib/api";
import type { Category, ProductDetail, SupplierOption } from "../lib/types";
import { formatBytes, formatDate } from "../lib/utils";
import { useAuth } from "../auth/AuthProvider";

export function ProductDetailPage() {
  const { id = "" } = useParams();
  const { profile } = useAuth();
  const [product, setProduct] = useState<ProductDetail | null | undefined>();
  const [editing, setEditing] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([]);

  useEffect(() => {
    void api.getCategories().then(setCategories);
    void api.getSuppliers().then(setSupplierOptions);
    void api.getProduct(id).then(async (result) => {
      if (result) {
        const thumbnailUrl = await api.getProductThumbnailUrl(result.id);
        setProduct({ ...result, thumbnailUrl });
      } else {
        setProduct(result);
      }
    });
  }, [id]);

  if (product === undefined) {
    return <p className="text-sm text-slate-500">載入產品資料…</p>;
  }
  if (!product) {
    return <p className="text-sm font-semibold text-red-700">找不到此產品。</p>;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const list = (name: string) =>
      String(form.get(name) ?? "")
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
    await api.updateProduct(product!.id, {
      nameOriginal: String(form.get("nameOriginal") ?? ""),
      nameZhTw: String(form.get("nameZhTw") ?? ""),
      nameEn: String(form.get("nameEn") ?? ""),
      nameVi: String(form.get("nameVi") ?? ""),
      brand: String(form.get("brand") ?? ""),
      modelNumbers: list("modelNumbers"),
      functions: list("functions"),
      keywords: list("keywords"),
      categoryId: String(form.get("categoryId") ?? "") || null,
      suppliers: supplierOptions
        .filter((supplier) => form.get(`supplier-${supplier.id}`) === "on")
        .map((supplier) => ({
          id: supplier.id,
          role: String(form.get(`supplier-role-${supplier.id}`) ?? "unknown"),
        })),
    });
    setEditing(false);
    const refreshed = await api.getProduct(product!.id);
    if (refreshed) {
      const thumbnailUrl = await api.getProductThumbnailUrl(refreshed.id);
      setProduct({ ...refreshed, thumbnailUrl });
    } else {
      setProduct(refreshed);
    }
  }

  return (
    <>
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft size={17} />
        回到搜尋
      </Link>

      {profile?.role !== "viewer" && (
        <div className="mb-5 flex justify-end">
          <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
            {editing ? "取消編輯" : "人工修正產品欄位"}
          </Button>
        </div>
      )}
      {editing && (
        <Card className="mb-6 p-6">
          <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
            {[
              ["nameZhTw", "繁中名稱", product.nameZhTw],
              ["nameOriginal", "來源原名", product.nameOriginal],
              ["nameEn", "英文名稱", product.nameEn],
              ["nameVi", "越南文名稱", product.nameVi],
              ["brand", "品牌", product.brand ?? ""],
              ["modelNumbers", "型號（逗號分隔）", product.modelNumbers.join(", ")],
              ["functions", "功能（逗號分隔）", product.functions.join(", ")],
              ["keywords", "關鍵字（逗號分隔）", product.keywords.join(", ")],
            ].map(([name, label, value]) => (
              <label key={name} className="text-xs font-bold text-slate-600">
                {label}
                <input
                  name={name}
                  defaultValue={value}
                  required={name.startsWith("name")}
                  className="mt-1.5 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm"
                />
              </label>
            ))}
            <label className="text-xs font-bold text-slate-600">
              正式分類
              <select
                name="categoryId"
                defaultValue={product.category?.id ?? ""}
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm"
              >
                <option value="">未分類</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nameZhTw}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="rounded-xl border border-slate-200 p-4 md:col-span-2">
              <legend className="px-2 text-xs font-black text-slate-700">
                廠商與角色（可複選）
              </legend>
              {supplierOptions.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {supplierOptions.map((supplier) => {
                    const current = product.suppliers.find((item) => item.id === supplier.id);
                    return (
                      <div key={supplier.id} className="rounded-xl bg-slate-50 p-3">
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-900">
                          <input
                            type="checkbox"
                            name={`supplier-${supplier.id}`}
                            defaultChecked={Boolean(current)}
                            className="h-4 w-4 accent-cyan-600"
                          />
                          {supplier.name}
                        </label>
                        <select
                          name={`supplier-role-${supplier.id}`}
                          defaultValue={current?.role ?? "unknown"}
                          className="mt-2 h-9 w-full rounded-lg border border-slate-300 px-2 text-xs"
                        >
                          <option value="manufacturer">原廠</option>
                          <option value="trader">貿易商</option>
                          <option value="partner">合作夥伴</option>
                          <option value="unknown">角色待確認</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500">請先在管理頁建立廠商主檔。</p>
              )}
            </fieldset>
            <div className="md:col-span-2 flex justify-end">
              <Button>儲存並標記人工確認</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="grid md:grid-cols-[42%_58%]">
              <div className="flex min-h-80 items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#dff8f6,transparent_32%),linear-gradient(145deg,#f8fafc,#e5e9e8)] p-8">
                {product.thumbnailUrl ? (
                  <img
                    src={product.thumbnailUrl}
                    alt={`${product.nameZhTw} 來源代表圖`}
                    className="max-h-80 w-full object-contain"
                  />
                ) : (
                  <div className="text-center text-slate-400">
                    <Box className="mx-auto" size={52} />
                    <p className="mt-3 text-sm font-semibold">
                      尚未選取來源代表圖
                    </p>
                  </div>
                )}
              </div>
              <div className="p-6 md:p-8">
                <div className="flex flex-wrap items-center gap-2">
                  <ConfirmationBadge status={product.confirmationStatus} />
                  <Badge>{product.category?.nameZhTw ?? "待分類"}</Badge>
                </div>
                <p className="mt-6 text-sm font-black uppercase tracking-[0.12em] text-cyan-800">
                  {product.modelNumbers.join(" · ")}
                </p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                  {product.nameZhTw}
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  {product.nameOriginal}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {product.functions.map((item) => (
                    <Badge key={item} tone="accent">
                      {item}
                    </Badge>
                  ))}
                </div>
                <dl className="mt-8 grid grid-cols-2 gap-5 border-t border-slate-100 pt-6 text-sm">
                  <div>
                    <dt className="text-xs font-bold text-slate-500">品牌</dt>
                    <dd className="mt-1 font-bold text-slate-950">
                      {product.brand ?? "未辨識"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-slate-500">廠商</dt>
                    <dd className="mt-1 font-bold text-slate-950">
                      {product.suppliers[0]?.name ?? "待確認"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-slate-500">
                      來源文件
                    </dt>
                    <dd className="mt-1 font-bold text-slate-950">
                      {product.documentCount} 份
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-slate-500">
                      最後更新
                    </dt>
                    <dd className="mt-1 font-bold text-slate-950">
                      {formatDate(product.updatedAt)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-xl bg-slate-100 p-2.5 text-slate-700">
                <Languages size={20} />
              </div>
              <div>
                <h2 className="font-black text-slate-950">多語名稱</h2>
                <p className="text-xs text-slate-500">保留原文，不改寫型號與品牌</p>
              </div>
            </div>
            <dl className="grid gap-4 md:grid-cols-3">
              {[
                ["English", product.nameEn],
                ["Tiếng Việt", product.nameVi],
                ["來源原文", product.nameOriginal],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-4">
                  <dt className="text-xs font-bold text-slate-500">{label}</dt>
                  <dd className="mt-2 text-sm font-semibold leading-6 text-slate-900">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-xl bg-slate-100 p-2.5 text-slate-700">
                <Ruler size={20} />
              </div>
              <div>
                <h2 className="font-black text-slate-950">規格</h2>
                <p className="text-xs text-slate-500">數值、單位與來源原文分開保存</p>
              </div>
            </div>
            {product.specifications.length ? (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3">項目</th>
                      <th className="px-4 py-3">辨識值</th>
                      <th className="hidden px-4 py-3 md:table-cell">來源原文</th>
                      <th className="px-4 py-3">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.specifications.map((spec) => (
                      <tr key={spec.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-semibold">{spec.name}</td>
                        <td className="px-4 py-3">
                          {spec.valueNumber ?? spec.valueText} {spec.unit}
                        </td>
                        <td className="hidden px-4 py-3 text-slate-500 md:table-cell">
                          {spec.sourceText}
                        </td>
                        <td className="px-4 py-3">
                          <ConfirmationBadge status={spec.confirmationStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">尚無結構化規格。</p>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-black text-slate-950">
              <FileText size={19} />
              來源文件
            </h2>
            <div className="mt-4 space-y-3">
              {product.documents.map((document) => (
                <Link
                  key={document.id}
                  to={`/documents/${document.id}`}
                  className="block rounded-xl border border-slate-200 p-4 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-950">
                        {document.title}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatBytes(document.byteSize)} · v{document.version}
                      </p>
                    </div>
                    <ExternalLink className="text-slate-400" size={16} />
                  </div>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-black text-slate-950">
              <CheckCircle2 size={19} />
              欄位證據
            </h2>
            <div className="mt-4 space-y-4">
              {product.evidence.map((evidence) => (
                <details
                  key={evidence.id}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <summary className="cursor-pointer text-sm font-bold text-slate-900">
                    {evidence.fieldName} · {evidence.sourceLocator}
                  </summary>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    {evidence.sourceLabel}
                  </p>
                  {evidence.excerpt && (
                    <blockquote className="mt-2 border-l-2 border-cyan-700 pl-3 text-sm text-slate-700">
                      {evidence.excerpt}
                    </blockquote>
                  )}
                </details>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-3">
              <Box className="mt-0.5 text-slate-500" size={19} />
              <div>
                <h2 className="font-black text-slate-950">已確認報價摘要</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {product.latestConfirmedQuote
                    ? `${product.latestConfirmedQuote.currency} ${product.latestConfirmedQuote.unitPrice}`
                    : "目前沒有已人工確認的報價。未確認價格不會顯示在產品主檔。"}
                </p>
              </div>
            </div>
          </Card>

          <Button variant="secondary" className="w-full" disabled>
            <Download size={17} />
            匯出產品摘要（第二階段）
          </Button>
        </aside>
      </div>
    </>
  );
}
