import { Download, File, Folder, LoaderCircle, Pencil, Save, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Badge, Button, Card, EmptyState } from "../components/ui";
import { api } from "../lib/api";
import { documentListText, parseDocumentList } from "../lib/pd-document-edit";
import type { PdDataset, PdDocumentDetail, PdDocumentEdit } from "../lib/types";

const KIND_OPTIONS: Record<PdDataset, Array<[string, string]>> = {
  mfg: [["design_drawing", "設計圖"], ["bom", "BOM／成本"], ["cad", "CAD／3D"], ["image", "產品圖片"], ["presentation", "簡報"], ["document", "一般文件"], ["other", "其他"]],
  buy: [["catalog", "產品型錄"], ["quotation", "報價單"], ["image", "產品圖片"], ["presentation", "簡報"], ["document", "一般文件"], ["cad", "CAD／3D"], ["other", "其他"]],
};

type EditState = { title: string; documentKind: string; sourceParty: string; pathLabels: string; keywords: string; summary: string; isReference: boolean };

export function PdDocumentDetailPage() {
  const params = useParams();
  const dataset: PdDataset = params.dataset === "buy" ? "buy" : "mfg";
  const { profile } = useAuth();
  const [item, setItem] = useState<PdDocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeEditor, setActiveEditor] = useState<"info" | "keywords" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [form, setForm] = useState<EditState | null>(null);

  const loadItem = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.getPdDocument(dataset, params.id);
      setItem(result);
      if (result) setForm(editStateFrom(result));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [dataset, params.id]);

  useEffect(() => { void loadItem(); }, [loadItem]);

  function cancelEdit() {
    if (item) setForm(editStateFrom(item));
    setActiveEditor(null);
    setSaveMessage("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || !item || !params.id || saving) return;
    if (!form.title.trim()) return setSaveMessage("顯示名稱不能空白。");
    if (dataset === "buy" && !form.sourceParty.trim()) return setSaveMessage("外購品必須填寫廠商名稱。");
    const patch: PdDocumentEdit = {
      title: form.title.trim(), documentKind: form.documentKind, sourceParty: form.sourceParty.trim(),
      pathLabels: parseDocumentList(form.pathLabels, 20), keywords: parseDocumentList(form.keywords, 30),
      summary: form.summary.trim(), isReference: form.isReference,
    };
    setSaving(true);
    setSaveMessage("正在儲存並更新搜尋索引…");
    try {
      await api.updatePdDocument(dataset, params.id, patch);
      await loadItem();
      const editedKeywords = activeEditor === "keywords";
      setActiveEditor(null);
      setSaveMessage(editedKeywords ? "搜尋關鍵字已更新，搜尋索引已立即生效。" : "文件資訊已更新，搜尋索引已立即生效。");
    } catch (reason) {
      setSaveMessage(`儲存失敗：${reason instanceof Error ? reason.message : "未知錯誤"}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !item) return <div className="flex min-h-64 items-center justify-center text-slate-400"><LoaderCircle className="mr-2 animate-spin" />讀取文件…</div>;
  if (error || !item || !form) return <EmptyState icon={<File />} title="找不到文件" description={error || "文件可能尚未匯入或已移除。"} />;
  const isImage = ["jpg", "jpeg", "png"].includes(item.extension);

  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Link to={dataset === "mfg" ? "/" : "/buy"} className="text-sm font-semibold text-slate-400 hover:text-white">← 回到{dataset === "mfg" ? "自製品" : "外購品"}搜尋</Link>
      {item.sourceUrl && <a href={item.sourceUrl} download className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-400 px-5 text-sm font-black text-slate-950 hover:bg-cyan-300"><Download size={18} />下載原檔</a>}
    </div>
    <header className="mb-6"><div className="flex flex-wrap gap-2"><Badge tone="accent">{kindLabel(dataset, item.documentKind)}</Badge><Badge>{item.extension.toUpperCase()}</Badge>{item.isReference && <Badge tone="warning">參考資料</Badge>}</div><h1 className="mt-3 break-words text-2xl font-black text-white md:text-4xl">{item.title}</h1><p className="mt-2 break-all text-sm text-slate-500">{item.relativePath}</p></header>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-h-[560px] overflow-hidden">
        <div className="border-b border-slate-700 px-5 py-4 font-bold text-white">文件預覽</div>
        {item.previewUrl ? isImage ? <div className="flex min-h-[500px] items-center justify-center bg-slate-950 p-4"><img src={item.previewUrl} alt={item.title} className="max-h-[72vh] max-w-full object-contain" /></div> : <iframe title={item.title} src={item.previewUrl} className="h-[72vh] min-h-[540px] w-full border-0 bg-slate-950" /> : <div className="flex min-h-[500px] flex-col items-center justify-center p-8 text-center"><File size={42} className="text-slate-600" /><p className="mt-4 font-bold text-slate-300">此格式沒有線上預覽</p><p className="mt-2 text-sm text-slate-500">STP、STEP、DWG、DXF 及尚未轉檔的 Office 文件請下載原檔查看。</p></div>}
      </Card>
      <aside className="space-y-4">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="font-black text-white">文件資訊</h2>{profile?.canUpload && !activeEditor && <Button variant="ghost" className="min-h-9 px-3 py-1.5" onClick={() => { setActiveEditor("info"); setSaveMessage(""); }}><Pencil size={15} />編輯</Button>}</div>
          {activeEditor === "info" ? <form className="mt-4 space-y-4" onSubmit={(event) => void save(event)}>
            <Field label="顯示名稱"><input value={form.title} maxLength={300} onChange={(event) => setForm({ ...form, title: event.target.value })} className={inputClass} /></Field>
            <Field label="文件類型"><select value={form.documentKind} onChange={(event) => setForm({ ...form, documentKind: event.target.value })} className={inputClass}>{KIND_OPTIONS[dataset].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label={dataset === "mfg" ? "來源工廠" : "廠商名稱"}><input value={form.sourceParty} maxLength={200} onChange={(event) => setForm({ ...form, sourceParty: event.target.value })} className={inputClass} /></Field>
            <Field label="分類路徑"><textarea value={form.pathLabels} rows={2} onChange={(event) => setForm({ ...form, pathLabels: event.target.value })} placeholder="以頓號、逗號或換行分隔" className={textareaClass} /></Field>
            <Field label="文件摘要"><textarea value={form.summary} maxLength={2000} rows={4} onChange={(event) => setForm({ ...form, summary: event.target.value })} className={textareaClass} /></Field>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-300"><input type="checkbox" checked={form.isReference} onChange={(event) => setForm({ ...form, isReference: event.target.checked })} className="h-4 w-4 accent-cyan-400" />標記為參考資料</label>
            <p className="text-xs leading-5 text-slate-500">原始檔路徑、檔案大小與 SHA-256 不會被修改。</p>
            {saveMessage && <p role="status" className="text-sm leading-5 text-cyan-200">{saveMessage}</p>}
            <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{saving ? "儲存中…" : "儲存"}</Button><Button type="button" variant="secondary" disabled={saving} onClick={cancelEdit}><X size={16} />取消</Button></div>
          </form> : <>
            <dl className="mt-4 space-y-4 text-sm"><Info label={dataset === "mfg" ? "來源工廠" : "廠商"} value={item.sourceFactory || item.supplierName || "未標示"} /><Info label="分類路徑" value={item.pathLabels.join(" › ") || "未分類"} /><Info label="文件類型" value={kindLabel(dataset, item.documentKind)} /><Info label="檔案大小" value={formatBytes(item.byteSize)} /><Info label="索引狀態" value={item.analysisStatus === "completed" ? "內容已分析" : item.analysisStatus === "metadata_only" ? "僅檔案資訊" : "等待內容分析"} />{item.summary && <Info label="文件摘要" value={item.summary} />}</dl>
            {saveMessage && <p role="status" className="mt-4 rounded-xl border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{saveMessage}</p>}
          </>}
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-black text-white"><Folder size={18} className="text-cyan-300" />搜尋關鍵字</div>
            {profile?.canUpload && !activeEditor && <Button variant="ghost" className="min-h-9 px-3 py-1.5" onClick={() => { setActiveEditor("keywords"); setSaveMessage(""); }}><Pencil size={15} />編輯關鍵字</Button>}
          </div>
          {activeEditor === "keywords" ? <form className="mt-4 space-y-3" onSubmit={(event) => void save(event)}>
            <Field label="以頓號、逗號或換行分隔，最多 30 個"><textarea autoFocus value={form.keywords} rows={5} onChange={(event) => setForm({ ...form, keywords: event.target.value })} placeholder="例如：Qi、三合一、Watch" className={textareaClass} /></Field>
            {saveMessage && <p role="status" className="text-sm leading-5 text-cyan-200">{saveMessage}</p>}
            <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{saving ? "儲存中…" : "儲存關鍵字"}</Button><Button type="button" variant="secondary" disabled={saving} onClick={cancelEdit}><X size={16} />取消</Button></div>
          </form> : <>
            <div className="mt-3 flex flex-wrap gap-2">{item.keywords.length ? item.keywords.slice(0, 30).map((keyword) => <Badge key={keyword}>{keyword}</Badge>) : <span className="text-sm text-slate-500">尚未設定</span>}</div>
            {saveMessage.startsWith("搜尋關鍵字") && <p role="status" className="mt-3 rounded-xl border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{saveMessage}</p>}
          </>}
        </Card>
      </aside>
    </div>
  </>;
}

function editStateFrom(item: PdDocumentDetail): EditState { return { title: item.title, documentKind: item.documentKind, sourceParty: item.sourceFactory || item.supplierName || "", pathLabels: documentListText(item.pathLabels), keywords: documentListText(item.keywords), summary: item.summary, isReference: item.isReference }; }
function kindLabel(dataset: PdDataset, value: string) { return KIND_OPTIONS[dataset].find(([kind]) => kind === value)?.[1] || value; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-xs font-bold text-slate-400"><span className="mb-1.5 block">{label}</span>{children}</label>; }
const inputClass = "h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20";
const textareaClass = "w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm leading-5 text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20";
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-200">{value}</dd></div>; }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
