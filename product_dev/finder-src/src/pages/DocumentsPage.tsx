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

  useEffect(() => {
    let active = true;
    const filters: SearchFilters = { extension: extension || undefined };
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
  }, [extension, params]);

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
        description="找到尚未建立產品主檔的會議、報價、測試、供應商與合約文件。搜尋結果依你的敏感資料權限過濾。"
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
        <EmptyState
          icon={<FileQuestion size={26} />}
          title="沒有找到相符文件"
          description="請改用較短的檔名片段，或清除格式篩選。"
        />
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
