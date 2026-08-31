import { File, FileImage, FileSpreadsheet, LoaderCircle, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import type { PdDataset, PdDocumentSummary } from "../lib/types";

const kindLabels: Record<string, string> = {
  design_drawing: "設計圖",
  bom: "BOM／成本",
  cad: "3D／CAD",
  image: "產品圖",
  presentation: "簡報",
  document: "文件",
  catalog: "產品型錄",
  quotation: "報價單",
  other: "其他",
};

const matchLabels: Record<string, string> = {
  exact_filename: "檔名完全命中",
  filename: "檔名命中",
  keyword: "關鍵字命中",
  category: "產品分類命中",
  factory: "來源工廠命中",
  supplier: "廠商命中",
  product_path: "產品目錄命中",
  path: "路徑命中",
  content: "文件內容命中",
  cross_language: "中英同義詞命中",
  recent: "最近更新",
};

export function DocumentLibraryPage({ dataset }: { dataset: PdDataset }) {
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("");
  const [kind, setKind] = useState("");
  const [includeReference, setIncludeReference] = useState(false);
  const [items, setItems] = useState<PdDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);

  async function searchDocuments() {
    setLoading(true);
    setError("");
    try {
      const result = await api.searchPdDocuments({ dataset, query, supplier, kind, includeReference });
      setItems(result.items);
      setElapsed(result.elapsedMs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "搜尋失敗");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setQuery("");
    setSupplier("");
    setKind("");
    setIncludeReference(false);
    setLoading(true);
    void api.searchPdDocuments({ dataset, query: "" })
      .then((result) => { setItems(result.items); setElapsed(result.elapsedMs); setError(""); })
      .catch((reason) => { setItems([]); setError(reason instanceof Error ? reason.message : "載入失敗"); })
      .finally(() => setLoading(false));
  }, [dataset]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void searchDocuments();
  }

  const isMfg = dataset === "mfg";
  const kinds = isMfg
    ? ["design_drawing", "bom", "cad", "image", "presentation", "document", "other"]
    : ["catalog", "quotation", "image", "presentation", "document", "cad", "other"];

  return <>
    <PageHeader
      eyebrow={isMfg ? "OWN PRODUCT LIBRARY" : "OUTSOURCING LIBRARY"}
      title={isMfg ? "自製品文件搜尋" : "外購品文件搜尋"}
      description={isMfg
        ? "搜尋設計圖、BOM、產品圖與 3D 檔。每一筆結果就是一份原始文件。"
        : "以產品名稱、檔名或廠商搜尋型錄、報價單、簡報與產品圖。"}
    />

    <Card className="p-4 md:p-5">
      <form onSubmit={submit} className="grid gap-3 xl:grid-cols-[minmax(280px,1fr)_220px_180px_auto]">
        <label className="relative block">
          <span className="sr-only">搜尋關鍵字</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={19} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 w-full rounded-xl border pl-11 pr-4 text-sm" placeholder={isMfg ? "例如：Watch、3 in 1、三合一、Qi2、X9" : "例如：Watch、3 in 1、三合一、Qi 充電"} />
        </label>
        {isMfg ? <div className="hidden xl:block" /> : <input value={supplier} onChange={(event) => setSupplier(event.target.value)} className="h-12 rounded-xl border px-4 text-sm" placeholder="廠商名稱" />}
        <select value={kind} onChange={(event) => setKind(event.target.value)} className="h-12 rounded-xl border px-4 text-sm" aria-label="文件類型">
          <option value="">全部文件類型</option>
          {kinds.map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
        </select>
        <Button className="h-12 px-6" type="submit" disabled={loading}>{loading ? <LoaderCircle className="animate-spin" size={18} /> : <Search size={18} />}搜尋</Button>
      </form>
      <label className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={includeReference} onChange={(event) => setIncludeReference(event.target.checked)} /><SlidersHorizontal size={15} />包含 History、既有設計及 Customer 等參考資料</label>
    </Card>

    <div className="mt-5 flex items-center justify-between text-sm text-slate-500"><span>{loading ? "搜尋中…" : `${items.length} 份文件`}</span>{elapsed > 0 && <span>{elapsed} ms</span>}</div>
    {error && <div role="alert" className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">{error}</div>}

    {!loading && !error && items.length === 0 ? <div className="mt-5"><EmptyState icon={<Search />} title="沒有符合的文件" description="請先確認資料是否已匯入，或改用檔名、型號、產品分類與廠商名稱搜尋。" /></div> :
      <section className="mt-4 space-y-3" aria-live="polite">{items.map((item) => <Link key={item.id} to={`/documents/${dataset}/${item.id}`} className="block"><Card className="group grid gap-4 p-4 transition hover:border-cyan-700 md:grid-cols-[108px_minmax(0,1fr)_auto] md:items-center">
        <div className="flex h-20 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60">
          {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : item.extension.includes("xls") ? <FileSpreadsheet className="text-emerald-400" /> : item.documentKind === "image" ? <FileImage className="text-cyan-300" /> : <File className="text-slate-500" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><Badge tone="accent">{kindLabels[item.documentKind] || item.documentKind}</Badge>{item.isReference && <Badge tone="warning">參考資料</Badge>}<span className="text-xs font-bold uppercase text-slate-500">{item.extension}</span></div>
          <h2 className="mt-2 truncate text-base font-black text-white group-hover:text-cyan-300">{item.title}</h2>
          <p className="mt-1 truncate text-xs text-slate-500">{item.relativePath}</p>
          <p className="mt-2 text-sm text-slate-400">{item.supplierName ? `廠商：${item.supplierName}` : item.sourceFactory ? `來源：${item.sourceFactory}` : item.pathLabels.join(" · ")}</p>
        </div>
        <div className="text-left md:text-right"><p className="text-xs font-semibold text-cyan-300">{matchLabels[item.matchReason || ""] || "文件索引"}</p><p className="mt-2 text-xs text-slate-500">{formatBytes(item.byteSize)}</p></div>
      </Card></Link>)}</section>}
  </>;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
