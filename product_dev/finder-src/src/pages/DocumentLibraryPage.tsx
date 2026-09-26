import { File, FileImage, FileSpreadsheet, LoaderCircle, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import type { PdDataset, PdDocumentSummary } from "../lib/types";
import { t as tr, useT } from "../i18n";

/* 🔴 標籤表存 key 不存文案 —— 這個物件在模組載入時求值一次，
   存死字串的話切語言換不掉（AppShell 的 navigation 是同一個道理）。*/
const KIND_KEYS = ["design_drawing", "bom", "cad", "image", "presentation", "document", "catalog", "quotation", "other"] as const;
const kindLabel = (kind: string) =>
  (KIND_KEYS as readonly string[]).includes(kind) ? tr(`k_${kind}`) : kind;

const MATCH_KEYS = ["exact_filename", "filename", "keyword", "category", "factory", "supplier", "product_path", "path", "content", "cross_language", "recent"];
const matchLabel = (reason: string) =>
  MATCH_KEYS.includes(reason) ? tr(`m_${reason}`) : tr("m_default");

const PAGE_SIZE = 30;

export function DocumentLibraryPage({ dataset }: { dataset: PdDataset }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("");
  const [kind, setKind] = useState("");
  const [includeReference, setIncludeReference] = useState(false);
  const [items, setItems] = useState<PdDocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const activeSearch = useRef({ dataset, query: "", supplier: "", kind: "", includeReference: false });

  async function searchDocuments() {
    setLoading(true);
    setError("");
    const params = { dataset, query, supplier, kind, includeReference };
    activeSearch.current = params;
    try {
      const result = await api.searchPdDocuments({ ...params, limit: PAGE_SIZE, offset: 0 });
      setItems(result.items);
      setTotal(result.total);
      setElapsed(result.elapsedMs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("err_search"));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    setError("");
    try {
      const result = await api.searchPdDocuments({
        ...activeSearch.current,
        limit: PAGE_SIZE,
        offset: items.length,
      });
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !known.has(item.id))];
      });
      setTotal(result.total);
      setElapsed(result.elapsedMs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("err_load_next"));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    setQuery("");
    setSupplier("");
    setKind("");
    setIncludeReference(false);
    setLoading(true);
    activeSearch.current = { dataset, query: "", supplier: "", kind: "", includeReference: false };
    void api.searchPdDocuments({ dataset, query: "", limit: PAGE_SIZE, offset: 0 })
      .then((result) => { setItems(result.items); setTotal(result.total); setElapsed(result.elapsedMs); setError(""); })
      .catch((reason) => { setItems([]); setTotal(0); setError(reason instanceof Error ? reason.message : t("err_load")); })
      .finally(() => setLoading(false));
  }, [dataset, t]);

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
      title={isMfg ? t("lib_title_mfg") : t("lib_title_buy")}
      description={isMfg ? t("lib_desc_mfg") : t("lib_desc_buy")}
    />

    <Card className="p-4 md:p-5">
      <form onSubmit={submit} className="grid gap-3 xl:grid-cols-[minmax(280px,1fr)_220px_180px_auto]">
        <label className="relative block">
          <span className="sr-only">{t("lib_sr_query")}</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={19} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 w-full rounded-xl border pl-11 pr-4 text-sm" placeholder={isMfg ? t("lib_ph_mfg") : t("lib_ph_buy")} />
        </label>
        {isMfg ? <div className="hidden xl:block" /> : <input value={supplier} onChange={(event) => setSupplier(event.target.value)} className="h-12 rounded-xl border px-4 text-sm" placeholder={t("lib_ph_supplier")} />}
        <select value={kind} onChange={(event) => setKind(event.target.value)} className="h-12 rounded-xl border px-4 text-sm" aria-label={t("lib_aria_kind")}>
          <option value="">{t("lib_all_kinds")}</option>
          {kinds.map((value) => <option key={value} value={value}>{kindLabel(value)}</option>)}
        </select>
        <Button className="h-12 px-6" type="submit" disabled={loading}>{loading ? <LoaderCircle className="animate-spin" size={18} /> : <Search size={18} />}{t("lib_search")}</Button>
      </form>
      <label className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={includeReference} onChange={(event) => setIncludeReference(event.target.checked)} /><SlidersHorizontal size={15} />{t("lib_include_ref")}</label>
    </Card>

    <div className="mt-5 flex items-center justify-between text-sm text-slate-500"><span>{loading ? t("lib_searching") : t("lib_shown", { n: items.length, t: total })}</span>{elapsed > 0 && <span>{elapsed} ms</span>}</div>
    {error && <div role="alert" className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">{error}</div>}

    {!loading && !error && items.length === 0 ? <div className="mt-5"><EmptyState icon={<Search />} title={t("lib_empty_title")} description={t("lib_empty_desc")} /></div> :
      <section className="mt-4 space-y-3" aria-live="polite">{items.map((item) => <Link key={item.id} to={`/documents/${dataset}/${item.id}`} className="block"><Card className="group grid gap-4 p-4 transition hover:border-cyan-700 md:grid-cols-[108px_minmax(0,1fr)_auto] md:items-center">
        <div className="flex h-20 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60">
          {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : item.extension.includes("xls") ? <FileSpreadsheet className="text-emerald-400" /> : item.documentKind === "image" ? <FileImage className="text-cyan-300" /> : <File className="text-slate-500" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><Badge tone="accent">{kindLabel(item.documentKind)}</Badge>{item.isReference && <Badge tone="warning">{t("lib_badge_ref")}</Badge>}<span className="text-xs font-bold uppercase text-slate-500">{item.extension}</span></div>
          <h2 className="mt-2 truncate text-base font-black text-white group-hover:text-cyan-300">{item.title}</h2>
          <p className="mt-1 truncate text-xs text-slate-500">{item.relativePath}</p>
          <p className="mt-2 text-sm text-slate-400">{item.supplierName ? t("lib_supplier_of", { n: item.supplierName }) : item.sourceFactory ? t("lib_source_of", { n: item.sourceFactory }) : item.pathLabels.join(" · ")}</p>
        </div>
        <div className="text-left md:text-right">
          <p className="text-xs font-semibold text-cyan-300">{matchLabel(item.matchReason || "")}</p>
          <p className={`mt-2 text-xs ${["bom", "quotation"].includes(item.documentKind) ? "font-bold text-amber-300" : "text-slate-400"}`}>{t("lib_primary_date", { d: formatDocumentDate(item.primaryDocumentDate) })}</p>
          <p className="mt-1 text-xs text-slate-500">{t("lib_revision", { r: item.revisionLabel || t("lib_unidentified") })}</p>
          <p className="mt-1 text-xs text-slate-500">{formatBytes(item.byteSize)}</p>
        </div>
      </Card></Link>)}</section>}

    {!loading && items.length < total && <div className="mt-6 flex flex-col items-center gap-2 border-t border-slate-800 pt-6">
      <Button variant="secondary" className="min-w-48" onClick={() => void loadMore()} disabled={loadingMore} aria-label={t("lib_aria_more", { n: Math.min(PAGE_SIZE, total - items.length) })}>
        {loadingMore ? <><LoaderCircle className="animate-spin" size={18} />{t("lib_loading_more")}</> : <>{t("lib_next_n", { n: Math.min(PAGE_SIZE, total - items.length) })}</>}
      </Button>
      <p className="text-xs text-slate-500">{t("lib_shown", { n: items.length, t: total })}</p>
    </div>}
  </>;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDocumentDate(value: string | null) {
  if (!value) return tr("lib_to_identify");
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${year}/${month}/${day}` : value;
}
