import { File, FileImage, FileSpreadsheet, LoaderCircle, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { analysisStatusLabel, analysisStatusTone, isContentIndexed, kindLabel, matchLabel } from "../lib/document-labels";
import { formatBytes } from "../lib/utils";
import type { PdDataset, PdDocumentSummary } from "../lib/types";
import { t as tr, useT } from "../i18n";


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
  /* 🔴 搜尋要能認出「過期的回應」。送出鈕雖然 disabled={loading}，但**輸入框按
     Enter 不受 disabled 按鈕限制** —— 連按兩次、先發的舊結果後到，就會蓋掉新的。
     每次送出遞增 searchSeq，回來時比對；順便 abort 掉還在飛的那一個。*/
  const searchSeq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  /* 伺服器端的 offset 要獨立記：items 會被 id 去重過濾，用 items.length 當
     offset 會愈翻愈偏。*/
  const serverOffset = useRef(0);

  async function searchDocuments() {
    const seq = ++searchSeq.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError("");
    const params = { dataset, query, supplier, kind, includeReference };
    activeSearch.current = params;
    try {
      const result = await api.searchPdDocuments(
        { ...params, limit: PAGE_SIZE, offset: 0 },
        controller.signal,
      );
      if (seq !== searchSeq.current) return;
      setItems(result.items);
      setTotal(result.total);
      setElapsed(result.elapsedMs);
      serverOffset.current = result.items.length;
    } catch (reason) {
      if (controller.signal.aborted || seq !== searchSeq.current) return;
      setError(reason instanceof Error ? reason.message : t("err_search"));
      setItems([]);
      setTotal(0);
      serverOffset.current = 0;
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }

  /* 🔴 分頁也要認過期的回應。searchDocuments() 已經有 searchSeq + abort，
     loadMore() 原本兩個都沒有 —— 按下「下一頁」之後立刻改條件送出新搜尋，
     舊的分頁回應會把舊資料接在新結果後面，並且覆蓋掉 total 與 elapsed。
     同一個 race，之前只修了一半。*/
  async function loadMore() {
    if (loadingMore || items.length >= total) return;
    const seq = searchSeq.current;
    const controller = new AbortController();
    inFlight.current?.abort();
    inFlight.current = controller;
    setLoadingMore(true);
    setError("");
    try {
      const result = await api.searchPdDocuments({
        ...activeSearch.current,
        limit: PAGE_SIZE,
        offset: serverOffset.current,
      }, controller.signal);
      if (seq !== searchSeq.current) return;
      serverOffset.current += result.items.length;
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !known.has(item.id))];
      });
      setTotal(result.total);
      setElapsed(result.elapsedMs);
    } catch (reason) {
      if (controller.signal.aborted || seq !== searchSeq.current) return;
      setError(reason instanceof Error ? reason.message : t("err_load_next"));
    } finally {
      if (seq === searchSeq.current) setLoadingMore(false);
    }
  }

  useEffect(() => {
    setQuery("");
    setSupplier("");
    setKind("");
    setIncludeReference(false);
    setLoading(true);
    activeSearch.current = { dataset, query: "", supplier: "", kind: "", includeReference: false };
    const seq = ++searchSeq.current;
    serverOffset.current = 0;
    void api.searchPdDocuments({ dataset, query: "", limit: PAGE_SIZE, offset: 0 })
      .then((result) => {
        if (seq !== searchSeq.current) return;
        setItems(result.items); setTotal(result.total); setElapsed(result.elapsedMs); setError("");
        serverOffset.current = result.items.length;
      })
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
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 w-full rounded-[10px] border pl-10 pr-3 text-[13px]" placeholder={isMfg ? t("lib_ph_mfg") : t("lib_ph_buy")} />
        </label>
        {isMfg ? <div className="hidden xl:block" /> : <input value={supplier} onChange={(event) => setSupplier(event.target.value)} className="h-9 rounded-[10px] border px-3 text-[13px]" placeholder={t("lib_ph_supplier")} />}
        <select value={kind} onChange={(event) => setKind(event.target.value)} className="h-9 rounded-[10px] border px-3 text-[13px]" aria-label={t("lib_aria_kind")}>
          <option value="">{t("lib_all_kinds")}</option>
          {kinds.map((value) => <option key={value} value={value}>{kindLabel(value)}</option>)}
        </select>
        <Button className="h-9 px-5" type="submit" disabled={loading}>{loading ? <LoaderCircle className="animate-spin" size={18} /> : <Search size={18} />}{t("lib_search")}</Button>
      </form>
      <label className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={includeReference} onChange={(event) => setIncludeReference(event.target.checked)} /><SlidersHorizontal size={15} />{t("lib_include_ref")}</label>
    </Card>

    <div className="mt-5 flex items-center justify-between text-sm text-slate-500"><span>{loading ? t("lib_searching") : t("lib_shown", { n: items.length, t: total })}</span>{elapsed > 0 && <span>{elapsed} ms</span>}</div>
    {error && <div role="alert" className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">{error}</div>}

    {!loading && !error && items.length === 0 ? <div className="mt-5"><EmptyState icon={<Search />} title={t("lib_empty_title")} description={`${t("lib_empty_desc")} ${t("lib_empty_hint")}`} /></div> :
      <section className="mt-4 space-y-3" aria-live="polite">{items.map((item) => <Link key={item.id} to={`/documents/${dataset}/${item.id}`} className="block"><Card className="group grid gap-4 p-4 transition hover:border-cyan-700 md:grid-cols-[108px_minmax(0,1fr)_auto] md:items-center">
        <div className="flex h-20 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60">
          {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : item.extension.includes("xls") ? <FileSpreadsheet className="text-emerald-400" /> : item.documentKind === "image" ? <FileImage className="text-cyan-300" /> : <File className="text-slate-500" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><Badge tone="accent">{kindLabel(item.documentKind)}</Badge>{item.isReference && <Badge tone="warning">{t("lib_badge_ref")}</Badge>}{!isContentIndexed(item.analysisStatus) && <Badge tone={analysisStatusTone(item.analysisStatus)}>{analysisStatusLabel(item.analysisStatus)}</Badge>}<span className="text-xs font-bold uppercase text-slate-500">{item.extension}</span></div>
          <h2 className="mt-2 truncate text-base font-semibold text-white group-hover:text-cyan-300">{item.title}</h2>
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


function formatDocumentDate(value: string | null) {
  if (!value) return tr("lib_to_identify");
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${year}/${month}/${day}` : value;
}
