import { AlertTriangle, Download, File, Folder, LoaderCircle, Pencil, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Badge, Button, Card, EmptyState } from "../components/ui";
import { api } from "../lib/api";
import { documentListText, parseDocumentList } from "../lib/pd-document-edit";
import { deleteFileAtRelativePath, loadDirectoryHandle, requestDirectoryPermission, type StoredDirectoryHandle } from "../lib/directory-access";
import type { PdDataset, PdDocumentDetail, PdDocumentEdit } from "../lib/types";
import { t as tr, useT } from "../i18n";

const KIND_OPTIONS: Record<PdDataset, Array<[string, string]>> = {
  /* 🔴 存 key 不存文案：這個物件在模組載入時求值一次，存死字串切語言換不掉。*/
  mfg: [["design_drawing", "k_design_drawing"], ["bom", "k_bom"], ["cad", "k_cad2"], ["image", "k_image2"], ["presentation", "k_presentation"], ["document", "k_document2"], ["other", "k_other"]],
  buy: [["catalog", "k_catalog"], ["quotation", "k_quotation"], ["image", "k_image2"], ["presentation", "k_presentation"], ["document", "k_document2"], ["cad", "k_cad2"], ["other", "k_other"]],
};

type EditState = { title: string; documentKind: string; sourceParty: string; pathLabels: string; keywords: string; summary: string; isReference: boolean; primaryDocumentDate: string; revisionLabel: string };

const DATE_TYPE_LABELS: Record<string, string> = {
  quotation_date: "dt_quotation_date", issue_date: "dt_issue_date", revision_date: "dt_revision_date",
  creation_date: "dt_creation_date", filename_date: "dt_filename_date", manual: "dt_manual",
};

export function PdDocumentDetailPage() {
  const t = useT();
  const params = useParams();
  const navigate = useNavigate();
  const dataset: PdDataset = params.dataset === "buy" ? "buy" : "mfg";
  const { profile } = useAuth();
  const [item, setItem] = useState<PdDocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeEditor, setActiveEditor] = useState<"info" | "keywords" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  /* 🔴 訊息屬於「文件資訊」還是「搜尋關鍵字」那一區，原本是用中文前綴
     `saveMessage.startsWith("搜尋關鍵字")` 判斷的 —— i18n 之後在其他四種語言
     必定失效，而且壞法是「訊息不出現」，沒有人會回報。改成明確的旗標。*/
  const [savedKeywords, setSavedKeywords] = useState(false);
  const [form, setForm] = useState<EditState | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLocal, setDeleteLocal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState("");

  const loadItem = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.getPdDocument(dataset, params.id);
      setItem(result);
      if (result) setForm(editStateFrom(result));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("d_read_failed"));
    } finally {
      setLoading(false);
    }
  }, [dataset, params.id, t]);

  useEffect(() => { void loadItem(); }, [loadItem]);

  function cancelEdit() {
    if (item) setForm(editStateFrom(item));
    setActiveEditor(null);
    setSaveMessage("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || !item || !params.id || saving) return;
    if (!form.title.trim()) return setSaveMessage(t("d_need_title"));
    if (dataset === "buy" && !form.sourceParty.trim()) return setSaveMessage(t("d_need_supplier"));
    const patch: PdDocumentEdit = {
      title: form.title.trim(), documentKind: form.documentKind, sourceParty: form.sourceParty.trim(),
      pathLabels: parseDocumentList(form.pathLabels, 20), keywords: parseDocumentList(form.keywords, 30),
      summary: form.summary.trim(), isReference: form.isReference,
      primaryDocumentDate: form.primaryDocumentDate || null, revisionLabel: form.revisionLabel.trim(),
    };
    setSaving(true);
    setSaveMessage(t("d_saving_idx"));
    try {
      await api.updatePdDocument(dataset, params.id, patch);
      await loadItem();
      const editedKeywords = activeEditor === "keywords";
      setActiveEditor(null);
      setSavedKeywords(editedKeywords);
      setSaveMessage(editedKeywords ? t("d_saved_kw") : t("d_saved_info"));
    } catch (reason) {
      setSaveMessage(t("d_save_failed", { m: reason instanceof Error ? reason.message : t("d_unknown_err") }));
    } finally {
      setSaving(false);
    }
  }

  async function deleteDocument() {
    if (!item || !params.id || deleting || profile?.role !== "admin") return;
    let directoryHandle: StoredDirectoryHandle | null = null;
    if (deleteLocal) {
      directoryHandle = await loadDirectoryHandle();
      if (!directoryHandle) return setDeleteMessage(t("d_no_dir"));
      if (!await requestDirectoryPermission(directoryHandle)) return setDeleteMessage(t("d_no_perm"));
    }
    const scope = deleteLocal ? t("d_scope_both") : "Supabase";
    if (!window.confirm(t("d_confirm_delete", { n: item.title, s: scope }))) return;
    setDeleting(true);
    setDeleteMessage(t("d_deleting"));
    try {
      await api.deletePdDocument(dataset, params.id);
      if (deleteLocal && directoryHandle) {
        try {
          const outcome = await deleteFileAtRelativePath(directoryHandle, item.relativePath);
          if (outcome === "missing") window.alert(t("d_local_missing"));
        } catch (reason) {
          window.alert(t("d_local_failed", { m: reason instanceof Error ? reason.message : t("d_unknown_err") }));
        }
      }
      navigate(dataset === "mfg" ? "/" : "/buy", { replace: true });
    } catch (reason) {
      setDeleteMessage(t("d_delete_failed", { m: reason instanceof Error ? reason.message : t("d_unknown_err") }));
      setDeleting(false);
    }
  }

  if (loading && !item) return <div className="flex min-h-64 items-center justify-center text-slate-400"><LoaderCircle className="mr-2 animate-spin" />{t("d_loading_doc")}</div>;
  if (error || !item || !form) return <EmptyState icon={<File />} title={t("d_not_found")} description={error || t("d_not_found_desc")} />;
  const isImage = ["jpg", "jpeg", "png"].includes(item.extension);

  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Link to={dataset === "mfg" ? "/" : "/buy"} className="text-sm font-semibold text-slate-400 hover:text-white">{dataset === "mfg" ? t("d_back_mfg") : t("d_back_buy")}</Link>
      <div className="flex flex-wrap gap-2">
        {profile?.role === "admin" && <Button variant="danger" onClick={() => { setDeleteOpen(true); setDeleteMessage(""); }}><Trash2 size={18} />{t("d_delete")}</Button>}
        {item.sourceUrl && <a href={item.sourceUrl} download className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-400 px-5 text-sm font-semibold text-white hover:bg-cyan-300"><Download size={18} />{t("d_download")}</a>}
      </div>
    </div>
    <header className="mb-6"><div className="flex flex-wrap gap-2"><Badge tone="accent">{kindLabel(dataset, item.documentKind)}</Badge><Badge>{item.extension.toUpperCase()}</Badge><Badge tone={["bom", "quotation"].includes(item.documentKind) ? "warning" : "neutral"}>{t("lib_primary_date", { d: formatDocumentDate(item.primaryDocumentDate) })}</Badge>{item.revisionLabel && <Badge>{t("lib_revision", { r: item.revisionLabel })}</Badge>}{item.isReference && <Badge tone="warning">{t("lib_badge_ref")}</Badge>}</div><h1 className="mt-3 break-words text-[16px] font-semibold text-white md:text-[22px]">{item.title}</h1><p className="mt-2 break-all text-sm text-slate-500">{item.relativePath}</p></header>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-h-[560px] overflow-hidden">
        <div className="border-b border-slate-700 px-5 py-4 font-bold text-white">{t("d_preview")}</div>
        {item.previewUrl ? isImage ? <div className="flex min-h-[500px] items-center justify-center bg-slate-950 p-4"><img src={item.previewUrl} alt={item.title} className="max-h-[72vh] max-w-full object-contain" /></div> : <iframe title={item.title} src={item.previewUrl} className="h-[72vh] min-h-[540px] w-full border-0 bg-slate-950" /> : <div className="flex min-h-[500px] flex-col items-center justify-center p-8 text-center"><File size={42} className="text-slate-600" /><p className="mt-4 font-bold text-slate-300">{t("d_no_preview")}</p><p className="mt-2 text-sm text-slate-500">{t("d_no_preview_desc")}</p></div>}
      </Card>
      <aside className="space-y-4">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-white">{t("d_info")}</h2>{profile?.canUpload && !activeEditor && <Button variant="ghost" className="min-h-9 px-3 py-1.5" onClick={() => { setActiveEditor("info"); setSaveMessage(""); }}><Pencil size={15} />{t("d_edit")}</Button>}</div>
          {activeEditor === "info" ? <form className="mt-4 space-y-4" onSubmit={(event) => void save(event)}>
            <Field label={t("d_f_title")}><input value={form.title} maxLength={300} onChange={(event) => setForm({ ...form, title: event.target.value })} className={inputClass} /></Field>
            <Field label={t("d_f_kind")}><select value={form.documentKind} onChange={(event) => setForm({ ...form, documentKind: event.target.value })} className={inputClass}>{KIND_OPTIONS[dataset].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></Field>
            <Field label={dataset === "mfg" ? t("d_f_factory") : t("d_f_supplier")}><input value={form.sourceParty} maxLength={200} onChange={(event) => setForm({ ...form, sourceParty: event.target.value })} className={inputClass} /></Field>
            <Field label={t("d_f_paths")}><textarea value={form.pathLabels} rows={2} onChange={(event) => setForm({ ...form, pathLabels: event.target.value })} placeholder={t("d_ph_sep")} className={textareaClass} /></Field>
            <Field label={t("d_f_summary")}><textarea value={form.summary} maxLength={2000} rows={4} onChange={(event) => setForm({ ...form, summary: event.target.value })} className={textareaClass} /></Field>
            <Field label={t("d_f_primary_date")}><input type="date" value={form.primaryDocumentDate} onChange={(event) => setForm({ ...form, primaryDocumentDate: event.target.value })} className={inputClass} /></Field>
            <Field label={t("d_f_revision")}><input value={form.revisionLabel} maxLength={100} onChange={(event) => setForm({ ...form, revisionLabel: event.target.value })} placeholder={t("d_ph_revision")} className={inputClass} /></Field>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-300"><input type="checkbox" checked={form.isReference} onChange={(event) => setForm({ ...form, isReference: event.target.checked })} className="h-4 w-4 accent-cyan-400" />{t("d_mark_ref")}</label>
            <p className="text-xs leading-5 text-slate-500">{t("d_immutable")}</p>
            {saveMessage && <p role="status" className="text-sm leading-5 text-cyan-200">{saveMessage}</p>}
            <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{saving ? t("d_saving") : t("d_save")}</Button><Button type="button" variant="secondary" disabled={saving} onClick={cancelEdit}><X size={16} />{t("d_cancel")}</Button></div>
          </form> : <>
            <dl className="mt-4 space-y-4 text-sm"><Info label={dataset === "mfg" ? t("d_f_factory") : t("d_f_supplier_short")} value={item.sourceFactory || item.supplierName || t("d_unlabelled")} /><Info label={t("d_f_paths")} value={item.pathLabels.join(" › ") || t("d_uncategorised")} /><Info label={t("d_f_kind")} value={kindLabel(dataset, item.documentKind)} /><Info label={t("d_f_primary_date")} value={formatDocumentDate(item.primaryDocumentDate)} /><Info label={t("d_date_type")} value={item.primaryDateType ? (DATE_TYPE_LABELS[item.primaryDateType] ? t(DATE_TYPE_LABELS[item.primaryDateType]) : item.primaryDateType) : t("d_unidentified")} />{item.primaryDateEvidence && <Info label={t("d_date_evidence")} value={[item.primaryDateEvidence, item.primaryDateLocation].filter(Boolean).join(" · ")} />}<Info label={t("d_f_revision")} value={item.revisionLabel || t("d_unidentified")} />{item.revisionEvidence && <Info label={t("d_rev_evidence")} value={[item.revisionEvidence, item.revisionLocation].filter(Boolean).join(" · ")} />}<Info label={t("d_file_size")} value={formatBytes(item.byteSize)} /><Info label={t("d_index_state")} value={item.analysisStatus === "completed" ? t("d_idx_done") : item.analysisStatus === "metadata_only" ? t("d_idx_meta") : t("d_idx_wait")} />{item.summary && <Info label={t("d_f_summary")} value={item.summary} />}</dl>
            {saveMessage && <p role="status" className="mt-4 rounded-xl border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{saveMessage}</p>}
          </>}
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold text-white"><Folder size={18} className="text-cyan-300" />{t("d_keywords")}</div>
            {profile?.canUpload && !activeEditor && <Button variant="ghost" className="min-h-9 px-3 py-1.5" onClick={() => { setActiveEditor("keywords"); setSaveMessage(""); }}><Pencil size={15} />{t("d_edit_kw")}</Button>}
          </div>
          {activeEditor === "keywords" ? <form className="mt-4 space-y-3" onSubmit={(event) => void save(event)}>
            <Field label={t("d_kw_hint")}><textarea autoFocus value={form.keywords} rows={5} onChange={(event) => setForm({ ...form, keywords: event.target.value })} placeholder={t("d_ph_kw")} className={textareaClass} /></Field>
            {saveMessage && <p role="status" className="text-sm leading-5 text-cyan-200">{saveMessage}</p>}
            <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{saving ? t("d_saving") : t("d_save_kw")}</Button><Button type="button" variant="secondary" disabled={saving} onClick={cancelEdit}><X size={16} />{t("d_cancel")}</Button></div>
          </form> : <>
            <div className="mt-3 flex flex-wrap gap-2">{item.keywords.length ? item.keywords.slice(0, 30).map((keyword) => <Badge key={keyword}>{keyword}</Badge>) : <span className="text-sm text-slate-500">{t("d_kw_empty")}</span>}</div>
            {savedKeywords && saveMessage && <p role="status" className="mt-3 rounded-xl border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{saveMessage}</p>}
          </>}
        </Card>
      </aside>
    </div>
    {deleteOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-document-title">
      <Card className="w-full max-w-lg border-rose-900 p-6 shadow-2xl">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-rose-950 p-3 text-rose-300"><AlertTriangle size={22} /></span><div><h2 id="delete-document-title" className="text-[15px] font-semibold text-white">{t("d_del_title")}</h2><p className="mt-2 break-all text-sm leading-6 text-slate-400">{item.relativePath}</p></div></div>
        <div className="mt-5 space-y-3">
          <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-700 p-4 text-sm text-slate-200"><input type="radio" name="delete-scope" checked={!deleteLocal} onChange={() => setDeleteLocal(false)} className="mt-0.5 accent-cyan-400" /><span><strong className="block text-white">{t("d_del_cloud")}</strong><span className="mt-1 block text-slate-500">{t("d_del_cloud_desc")}</span></span></label>
          <label className="flex cursor-pointer gap-3 rounded-xl border border-rose-900/80 p-4 text-sm text-slate-200"><input type="radio" name="delete-scope" checked={deleteLocal} onChange={() => setDeleteLocal(true)} className="mt-0.5 accent-rose-500" /><span><strong className="block text-rose-200">{t("d_del_both")}</strong><span className="mt-1 block text-slate-500">{t("d_del_both_desc")}</span></span></label>
        </div>
        {deleteMessage && <p role="status" className="mt-4 text-sm text-rose-300">{deleteMessage}</p>}
        <div className="mt-6 flex justify-end gap-2"><Button variant="secondary" disabled={deleting} onClick={() => setDeleteOpen(false)}>{t("d_cancel")}</Button><Button variant="danger" disabled={deleting} onClick={() => void deleteDocument()}>{deleting ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />}{deleting ? t("d_deleting_btn") : t("d_delete_confirm_btn")}</Button></div>
      </Card>
    </div>}
  </>;
}

function editStateFrom(item: PdDocumentDetail): EditState { return { title: item.title, documentKind: item.documentKind, sourceParty: item.sourceFactory || item.supplierName || "", pathLabels: documentListText(item.pathLabels), keywords: documentListText(item.keywords), summary: item.summary, isReference: item.isReference, primaryDocumentDate: item.primaryDocumentDate || "", revisionLabel: item.revisionLabel || "" }; }
function kindLabel(dataset: PdDataset, value: string) { return KIND_OPTIONS[dataset].find(([kind]) => kind === value)?.[1] || value; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-xs font-bold text-slate-400"><span className="mb-1.5 block">{label}</span>{children}</label>; }
const inputClass = "h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20";
const textareaClass = "w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm leading-5 text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20";
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-200">{value}</dd></div>; }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function formatDocumentDate(value: string | null) { if (!value) return tr("lib_to_identify"); const [year, month, day] = value.slice(0, 10).split("-"); return year && month && day ? `${year}/${month}/${day}` : value; }
