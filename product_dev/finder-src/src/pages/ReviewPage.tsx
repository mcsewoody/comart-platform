import {
  ArrowRight,
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  Factory,
  GitCompareArrows,
  Link2,
  Layers3,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import type {
  BatchApprovalResult,
  Category,
  MappingSuggestion,
  ProductReviewGap,
  ProductReviewGapKind,
  ReviewTask,
  SupplierOption,
  SupplierRef,
} from "../lib/types";
import { formatDate } from "../lib/utils";

const taskIcons = {
  field_conflict: ShieldAlert,
  product_split: Layers3,
  supplier: Factory,
  duplicate: GitCompareArrows,
};

type ReviewGroup = {
  documentId: string;
  documentTitle: string;
  tasks: ReviewTask[];
};

function groupReviewTasks(tasks: ReviewTask[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const task of tasks) {
    if (!task.documentId) continue;
    const group = groups.get(task.documentId) ?? {
      documentId: task.documentId,
      documentTitle: task.documentTitle,
      tasks: [],
    };
    group.tasks.push(task);
    groups.set(task.documentId, group);
  }
  return [...groups.values()].sort((a, b) =>
    b.tasks.length - a.tasks.length || a.documentTitle.localeCompare(b.documentTitle),
  );
}

export function ReviewPage() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchApprovalResult | null>(null);
  const [error, setError] = useState("");
  const groups = useMemo(() => groupReviewTasks(tasks), [tasks]);

  useEffect(() => {
    void api.getReviewTasks().then(setTasks);
  }, []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  async function approveSelected() {
    setBusy(true);
    setError("");
    try {
      const approvedIds = [...selected];
      const nextResult = await api.batchApproveDocuments(approvedIds);
      setResult(nextResult);
      setTasks((current) =>
        current.filter((task) => !task.documentId || !selected.has(task.documentId)),
      );
      setSelected(new Set());
      setConfirming(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "批次審核失敗");
    } finally {
      setBusy(false);
    }
  }

  const allSelected = groups.length > 0 && selected.size === groups.length;

  return (
    <>
      <PageHeader
        eyebrow="Human in the loop"
        title="以來源文件審核 AI 結果"
        description="一份文件可能產生多個欄位提醒。只確認文件裡實際出現的資料；不適用或沒有證據的欄位可以保持空白。"
      />

      <MasterMappingPanel />
      <ProductGapPanel />

      {groups.length > 0 && (
      <Card className="mb-5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="danger">
                {tasks.filter((item) => item.priority === "high").length} 個高優先提醒
              </Badge>
              <Badge>{groups.length} 份文件待審</Badge>
              <Badge>{tasks.length} 個欄位提醒</Badge>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              「接受目前結果」只確認已抽出的值，不會要求品牌、型號、廠商、規格全部存在；沒有產品的合約、會議或供應商文件也能直接完成文件審核。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(groups.map((g) => g.documentId)))
              }
            >
              {allSelected ? "取消全選" : "全選所有文件"}
            </Button>
            <Button
              disabled={selected.size === 0 || busy}
              onClick={() => setConfirming(true)}
            >
              <CheckCheck size={17} />
              批次接受 {selected.size || ""} 份
            </Button>
          </div>
        </div>

        {confirming && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="font-black text-amber-950">
              確認接受所選 {selected.size} 份文件目前的 AI 結果？
            </p>
            <p className="mt-1 text-sm leading-6 text-amber-800">
              有值的欄位會標成人工確認並防止 AI 重跑覆蓋；空白欄位維持空白。這不會合併產品，也不會刪除來源文件。
            </p>
            <div className="mt-3 flex gap-2">
              <Button disabled={busy} onClick={() => void approveSelected()}>
                {busy ? "處理中…" : "確認批次接受"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                返回檢查
              </Button>
            </div>
          </div>
        )}

        {result && (
          <p className="mt-4 text-sm font-bold text-emerald-700" role="status">
            已完成 {result.documentsApproved} 份文件、確認 {result.productsConfirmed} 個產品，關閉 {result.reviewTasksResolved} 個欄位提醒。
          </p>
        )}
        {error && (
          <p className="mt-4 text-sm font-bold text-red-700" role="alert">
            {error}
          </p>
        )}
      </Card>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<CheckCheck size={28} />}
          title="目前沒有待審文件"
          description="所有來源文件的 AI 結果都已處理。"
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <DocumentReviewGroup
              key={group.documentId}
              group={group}
              checked={selected.has(group.documentId)}
              onToggle={() => toggle(group.documentId)}
            />
          ))}
        </div>
      )}
    </>
  );
}

const gapLabels: Record<ProductReviewGapKind, string> = {
  category: "缺正式分類",
  supplier: "缺廠商",
  model: "缺型號",
  thumbnail: "缺代表圖",
};

function ProductGapPanel() {
  const [items, setItems] = useState<ProductReviewGap[]>([]);
  const [filter, setFilter] = useState<ProductReviewGapKind | "all">("all");
  const [field, setField] = useState<"category" | "supplier" | "model">("category");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierRole, setSupplierRole] = useState<SupplierRef["role"]>("manufacturer");
  const [models, setModels] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [nextItems, nextCategories, nextSuppliers] = await Promise.all([
      api.getProductReviewGaps(),
      api.getCategories(),
      api.getSuppliers(),
    ]);
    setItems(nextItems);
    setCategories(nextCategories);
    setSuppliers(nextSuppliers);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = filter === "all"
    ? items
    : items.filter((item) => item.missing.includes(filter));
  const eligible = visible.filter((item) => item.missing.includes(field));
  const selectedItems = items.filter((item) => selected.has(item.product.id));
  const allEligibleSelected = eligible.length > 0
    && eligible.every((item) => selected.has(item.product.id));

  function changeField(nextField: "category" | "supplier" | "model") {
    setField(nextField);
    setSelected(new Set());
    setConfirming(false);
    setError("");
    setMessage("");
  }

  function toggle(productId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    setConfirming(false);
  }

  function validateBatch() {
    if (!selected.size) return "請先勾選產品。";
    if (field === "category" && !categoryId) return "請選擇正式分類。";
    if (field === "supplier" && !supplierId) return "請選擇廠商。";
    if (field === "model" && selectedItems.some(({ product }) => !models[product.id]?.trim())) {
      return "每個已勾選產品都必須填入型號。";
    }
    return "";
  }

  async function applyBatch() {
    const validation = validateBatch();
    if (validation) {
      setError(validation);
      setConfirming(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const value = field === "category"
        ? { categoryId }
        : field === "supplier"
          ? { supplierId, role: supplierRole }
          : {
              models: Object.fromEntries(selectedItems.map(({ product }) => [
                product.id,
                models[product.id].split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
              ])),
            };
      const result = await api.batchFillProductGaps([...selected], field, value);
      setMessage(`已一次補上 ${result.updated} 個產品的${batchFieldLabels[field]}。`);
      setSelected(new Set());
      setModels({});
      setConfirming(false);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "批次更新失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5 overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-700 bg-slate-800/60 p-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-black text-slate-100">
            <AlertTriangle className="text-amber-300" size={19} />
            產品主檔待補清單
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            文件已接受，不代表產品主檔完整。這裡集中列出缺正式分類、廠商、型號或代表圖的產品。
          </p>
        </div>
        <label className="text-sm font-bold text-slate-300">
          缺口篩選
          <select
            value={filter}
            onChange={(event) => {
              const next = event.target.value as ProductReviewGapKind | "all";
              setFilter(next);
              if (next === "category" || next === "supplier" || next === "model") {
                changeField(next);
              } else {
                setSelected(new Set());
              }
            }}
            className="ml-3 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
          >
            <option value="all">全部（{items.length}）</option>
            {(Object.keys(gapLabels) as ProductReviewGapKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {gapLabels[kind]}（{items.filter((item) => item.missing.includes(kind)).length}）
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="border-b border-slate-700 bg-slate-950/50 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-300">批次修改欄位</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["category", "supplier", "model"] as const).map((kind) => (
                <Button
                  key={kind}
                  variant={field === kind ? "primary" : "secondary"}
                  onClick={() => changeField(kind)}
                >
                  {batchFieldLabels[kind]}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              disabled={!eligible.length}
              onClick={() => setSelected(allEligibleSelected
                ? new Set()
                : new Set(eligible.map((item) => item.product.id)))}
            >
              {allEligibleSelected ? "取消全選" : `全選目前可修改的 ${eligible.length} 個`}
            </Button>
            <Badge tone="accent">已選 {selected.size} 個</Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          {field === "category" && (
            <label className="text-sm font-bold text-slate-300">
              套用正式分類
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 p-3 text-slate-100">
                <option value="">請選擇正式分類</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.nameZhTw}</option>)}
              </select>
            </label>
          )}
          {field === "supplier" && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
              <label className="text-sm font-bold text-slate-300">
                套用廠商
                <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 p-3 text-slate-100">
                  <option value="">請選擇廠商</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-slate-300">
                廠商角色
                <select value={supplierRole} onChange={(event) => setSupplierRole(event.target.value as SupplierRef["role"])} className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900 p-3 text-slate-100">
                  <option value="manufacturer">原廠</option>
                  <option value="trader">貿易商</option>
                  <option value="partner">合作夥伴</option>
                  <option value="unknown">角色待確認</option>
                </select>
              </label>
            </div>
          )}
          {field === "model" && (
            <p className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm leading-6 text-slate-300">
              勾選產品後，直接在各列輸入各自型號；可用逗號分隔多個型號，最後一次送出。
            </p>
          )}
          <Button disabled={!selected.size || busy} onClick={() => {
            const validation = validateBatch();
            if (validation) setError(validation);
            else {
              setError("");
              setConfirming(true);
            }
          }}>
            <CheckCheck size={17} /> 批次套用 {selected.size || ""} 個產品
          </Button>
        </div>

        {confirming && (
          <div className="mt-4 rounded-xl border border-amber-700/60 bg-amber-950/30 p-4">
            <p className="font-black text-amber-100">
              確認替 {selected.size} 個產品補上「{batchFieldLabels[field]}」？
            </p>
            <p className="mt-1 text-sm leading-6 text-amber-200/80">
              系統只填空缺，不覆寫已有的分類、廠商或型號；本次操作會留下人工修改與稽核紀錄。
            </p>
            <div className="mt-3 flex gap-2">
              <Button disabled={busy} onClick={() => void applyBatch()}>{busy ? "套用中…" : "確認批次套用"}</Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>返回</Button>
            </div>
          </div>
        )}
        {message && <p className="mt-4 text-sm font-bold text-emerald-300" role="status">{message}</p>}
        {error && <p className="mt-4 text-sm font-bold text-red-300" role="alert">{error}</p>}
      </div>
      {visible.length ? (
        <div className="divide-y divide-slate-700">
          {visible.map(({ product, missing }) => (
            <div key={product.id} className={selected.has(product.id)
              ? "grid gap-4 bg-cyan-950/20 p-5 md:grid-cols-[28px_104px_minmax(0,1fr)_auto] md:items-center"
              : "grid gap-4 p-5 md:grid-cols-[28px_104px_minmax(0,1fr)_auto] md:items-center"}>
              <input
                type="checkbox"
                checked={selected.has(product.id)}
                disabled={!missing.includes(field)}
                onChange={() => toggle(product.id)}
                aria-label={`選取 ${product.nameZhTw}`}
                className="h-5 w-5 accent-cyan-400 disabled:opacity-25"
              />
              <Link
                to={`/products/${product.id}`}
                className="flex h-20 w-[104px] items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-950 transition hover:border-cyan-600"
                aria-label={`查看 ${product.nameZhTw} 產品詳情`}
              >
                {product.thumbnailUrl ? (
                  <img
                    src={product.thumbnailUrl}
                    alt={`${product.nameZhTw} 來源縮圖`}
                    loading="lazy"
                    className="h-full w-full object-contain p-1"
                  />
                ) : (
                  <span className="px-2 text-center text-xs font-bold leading-5 text-slate-500">
                    無縮圖
                  </span>
                )}
              </Link>
              <div className="min-w-0">
                <p className="font-black text-slate-100">{product.nameZhTw}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {product.modelNumbers.length ? product.modelNumbers.join("、") : "型號未填"}
                  {product.category ? ` · ${product.category.nameZhTw}` : ""}
                  {product.suppliers.length ? ` · ${product.suppliers.map((supplier) => supplier.name).join("、")}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {missing.map((kind) => <Badge key={kind} tone="warning">{gapLabels[kind]}</Badge>)}
                </div>
                {field === "model" && selected.has(product.id) && (
                  <label className="mt-3 block text-xs font-bold text-slate-300">
                    此產品型號
                    <input
                      value={models[product.id] || ""}
                      onChange={(event) => setModels((current) => ({ ...current, [product.id]: event.target.value }))}
                      placeholder="例如：PS-04；多個型號用逗號分隔"
                      className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
                    />
                  </label>
                )}
              </div>
              <Link to={`/products/${product.id}`}>
                <Button variant="secondary">
                  補產品資料 <ArrowRight size={16} />
                </Button>
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="p-5 text-sm text-slate-400">
          {items.length ? "此篩選沒有待補產品。" : "目前沒有產品主檔缺口。"}
        </p>
      )}
    </Card>
  );
}

const batchFieldLabels = {
  category: "正式分類",
  supplier: "廠商與角色",
  model: "型號",
};

function MasterMappingPanel() {
  const [suggestions, setSuggestions] = useState<MappingSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void api.getMappingSuggestions().then(setSuggestions);
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, MappingSuggestion[]>();
    for (const item of suggestions) {
      const key = `${item.type}:${item.masterId}:${item.supplierRole || ""}`;
      map.set(key, [...(map.get(key) || []), item]);
    }
    return [...map.entries()].map(([key, items]) => ({ key, items }));
  }, [suggestions]);

  async function applySelected() {
    const ids = groups
      .filter((group) => selected.has(group.key))
      .flatMap((group) => group.items.map((item) => item.id));
    if (!ids.length) return;
    setBusy(true);
    try {
      const result = await api.applyMappingSuggestions(ids);
      setSuggestions((current) => current.filter((item) => !ids.includes(item.id)));
      setSelected(new Set());
      setMessage(`已套用 ${result.applied} 個產品主檔對應。`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5 overflow-hidden border-cyan-200">
      <div className="flex flex-col gap-4 bg-cyan-50 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-black text-slate-950">
            <Sparkles className="text-cyan-800" size={19} />
            AI 正式分類／廠商對應
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            相同建議會自動成組；勾選後一次套用。廠商建議只收來源文件明確出現的名稱，不依資料夾或 Logo 猜測。
          </p>
        </div>
        <Button disabled={!selected.size || busy} onClick={() => void applySelected()}>
          <Link2 size={17} />
          {busy ? "套用中…" : `批次套用 ${selected.size || ""} 組`}
        </Button>
      </div>
      {message && <p className="px-5 pt-4 text-sm font-bold text-emerald-700">{message}</p>}
      {groups.length ? (
        <div className="divide-y divide-slate-100">
          {groups.map((group) => {
            const sample = group.items[0];
            const average = Math.round(
              group.items.reduce((sum, item) => sum + item.confidence, 0) /
                group.items.length * 100,
            );
            return (
              <label key={group.key} className="grid cursor-pointer gap-3 p-5 hover:bg-slate-50 md:grid-cols-[24px_minmax(0,1fr)_auto]">
                <input
                  type="checkbox"
                  checked={selected.has(group.key)}
                  onChange={(event) => setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(group.key);
                    else next.delete(group.key);
                    return next;
                  })}
                  className="mt-1 h-5 w-5 accent-cyan-600"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{sample.type === "category" ? "正式分類" : "廠商"}</Badge>
                    <strong className="text-slate-950">{sample.masterName}</strong>
                    {sample.supplierRole && <Badge>{supplierRoleLabel(sample.supplierRole)}</Badge>}
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {group.items.slice(0, 4).map((item) => item.productName).join("、")}
                    {group.items.length > 4 ? ` 等 ${group.items.length} 個產品` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{sample.rationale}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black text-cyan-800">{average}%</p>
                  <p className="text-xs text-slate-500">平均信心</p>
                </div>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="p-5 text-sm text-slate-500">目前沒有待套用的分類或廠商建議。</p>
      )}
    </Card>
  );
}

function supplierRoleLabel(role: NonNullable<MappingSuggestion["supplierRole"]>) {
  return {
    manufacturer: "原廠",
    trader: "貿易商",
    partner: "合作夥伴",
    unknown: "角色待確認",
  }[role];
}

function DocumentReviewGroup({
  group,
  checked,
  onToggle,
}: {
  group: ReviewGroup;
  checked: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const productIds = [...new Set(group.tasks.flatMap((task) => task.productId ? [task.productId] : []))];
  const high = group.tasks.filter((task) => task.priority === "high").length;
  return (
    <Card className={checked ? "border-cyan-700 p-5 ring-1 ring-cyan-700" : "p-5"}>
      <div className="grid gap-4 md:grid-cols-[28px_minmax(0,1fr)_auto] md:items-start">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 h-5 w-5 accent-cyan-600"
          aria-label={`選取 ${group.documentTitle}`}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-black text-slate-950">{group.documentTitle}</h2>
            {high > 0 && <Badge tone="danger">{high} 個高優先</Badge>}
            <Badge>{group.tasks.length} 個提醒</Badge>
            <Badge>{productIds.length} 個產品候選</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            最近提醒：{group.tasks[0]?.description} · {formatDate(group.tasks[0]?.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <Link to={`/documents/${group.documentId}`}>
            <Button variant="secondary">
              查看來源 <ArrowRight size={16} />
            </Button>
          </Link>
          <Button variant="ghost" onClick={() => setOpen((value) => !value)}>
            {open ? "收起提醒" : "展開提醒"}
            <ChevronDown className={open ? "rotate-180 transition" : "transition"} size={16} />
          </Button>
        </div>
      </div>
      {open && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          {group.tasks.map((task) => {
            const Icon = taskIcons[task.type];
            return (
              <div key={task.id} className="flex gap-3 rounded-xl bg-slate-50 p-3">
                <Icon className="mt-0.5 shrink-0 text-slate-500" size={18} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-950">{task.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{task.description}</p>
                </div>
                {task.productId && (
                  <Link className="text-sm font-bold text-cyan-800" to={`/products/${task.productId}`}>
                    產品
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
