import { FileQuestion, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { DocumentRow } from "../components/DocumentRow";
import { Button, Card, EmptyState, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import type { DocumentSummary, SearchFilters } from "../lib/types";

export function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [extension, setExtension] = useState("");
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [includeReference, setIncludeReference] = useState(false);
  const [semantic, setSemantic] = useState(false);

  useEffect(() => {
    let active = true;
    const filters: SearchFilters = { extension: extension || undefined, includeReference, semantic };
    setLoading(true);
    setError("");
    void api.searchDocuments(params.get("q") ?? "", filters).then((result) => {
      if (active) {
        setDocuments(result.items);
        setLoading(false);
      }
    }).catch((reason: unknown) => {
      if (!active) return;
      setDocuments([]);
      setError(reason instanceof Error ? reason.message : "文件搜尋失敗");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [extension, includeReference, semantic, params]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    setParams(next);
  }

  return (
    <>
      <PageHeader
        eyebrow="Source library"
        title="文件搜尋"
        description="預設只顯示可直接使用的產品文件；精確比對檔名、路徑與全文，不自動混入相似圖片。"
      />
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:flex-row"
      >
        <div className="relative flex-1">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            size={20}
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-12 w-full rounded-xl bg-slate-50 pl-12 pr-4 text-sm outline-none ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-cyan-700"
            placeholder="搜尋檔名、路徑、全文或文件內容"
          />
        </div>
        <select
          value={extension}
          onChange={(event) => setExtension(event.target.value)}
          className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm"
          aria-label="檔案格式"
        >
          <option value="">全部格式</option>
          {["pdf", "jpg", "png", "pptx", "xlsx", "docx", "stp", "mp4"].map(
            (item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ),
          )}
        </select>
        <Button type="submit" className="h-12 px-6">
          搜尋文件
        </Button>
        <label className="flex h-12 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={includeReference}
            onChange={(event) => setIncludeReference(event.target.checked)}
            className="h-4 w-4 accent-cyan-600"
          />
          包含參考資料
        </label>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-800/60 bg-red-950/40 p-4 text-sm text-red-200">
          文件搜尋暫時無法載入：{error}
        </p>
      )}

      <p className="my-5 text-sm text-slate-500">
        {loading ? "搜尋中…" : `${documents.length} 份文件`}
      </p>
      {!loading && documents.length === 0 ? (
        <div>
          <EmptyState
            icon={<FileQuestion size={26} />}
            title="沒有找到相符文件"
            description="請改用較短的檔名片段，或清除格式篩選。"
          />
          {params.get("q")?.trim() && !semantic && (
            <div className="mt-3 text-center">
              <Button type="button" variant="secondary" onClick={() => setSemantic(true)}>
                沒有精準結果，查看相關文件
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card className="overflow-hidden">
          {documents.map((document) => (
            <DocumentRow key={document.id} document={document} />
          ))}
        </Card>
      )}
    </>
  );
}
