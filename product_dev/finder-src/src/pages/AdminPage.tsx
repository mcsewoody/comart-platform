import {
  KeyRound,
  Merge,
  Pencil,
  ShieldCheck,
  Tags,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import type { Category, Profile, SupplierOption } from "../lib/types";

const sections = [
  {
    icon: KeyRound,
    title: "高度機密授權",
    description: "依個別使用者加授權或撤銷，不只依管理員角色。",
    count: "逐筆稽核",
  },
  {
    icon: ShieldCheck,
    title: "稽核紀錄",
    description: "查看欄位修改、下載、刪除、權限與管理操作。",
    count: "不可由前台修改",
  },
];

export function AdminPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [masterMessage, setMasterMessage] = useState("");

  const loadMasters = useCallback(async () => {
    const [nextCategories, nextSuppliers] = await Promise.all([
      api.getCategories(),
      api.getSuppliers(),
    ]);
    setCategories(nextCategories);
    setSuppliers(nextSuppliers);
  }, []);

  useEffect(() => {
    void api.getProfiles().then(setProfiles);
    void loadMasters();
  }, [loadMasters]);

  async function createMaster(
    event: FormEvent<HTMLFormElement>,
    kind: "category" | "supplier",
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = String(new FormData(form).get("name") ?? "").trim();
    if (!value) return;
    if (kind === "category") {
      await api.createCategory(value);
    } else {
      await api.createSupplier(value);
    }
    form.reset();
    await loadMasters();
  }

  async function updateMaster(
    kind: "category" | "supplier",
    id: string,
    name: string,
    aliases: string[],
  ) {
    await api.updateMaster(kind, id, name, aliases);
    setMasterMessage("主檔名稱與別名已更新。");
    await loadMasters();
  }

  async function mergeMaster(
    kind: "category" | "supplier",
    sourceId: string,
    targetId: string,
  ) {
    await api.mergeMaster(kind, sourceId, targetId);
    setMasterMessage("合併完成，產品關聯已移至保留主檔。");
    await loadMasters();
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="系統管理"
        description="管理分類、廠商、使用者與權限。所有影響敏感資料或永久刪除的操作都必須留下稽核紀錄。"
      />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Card key={section.title} className="p-6">
              <div className="flex items-start justify-between">
                <div className="rounded-xl bg-slate-100 p-3 text-slate-700">
                  <Icon size={22} />
                </div>
                <span className="text-xs font-bold text-cyan-800">
                  {section.count}
                </span>
              </div>
              <h2 className="mt-5 text-lg font-black text-slate-950">
                {section.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {section.description}
              </p>
              <p className="mt-5 text-xs font-semibold text-slate-500">
                權限由 RLS 強制執行；完整異動保留於稽核表。
              </p>
            </Card>
          );
        })}
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <MasterDataCard
          kind="category"
          title="正式分類"
          description="只建立正式產品類別，不直接把來源資料夾當分類。"
          items={categories.map((item) => ({
            id: item.id, name: item.nameZhTw,
            aliases: item.aliases || [], count: item.productCount || 0,
          }))}
          placeholder="例如：Qi 無線充電"
          onSubmit={(event) => void createMaster(event, "category")}
          onUpdate={(id, name, aliases) => void updateMaster("category", id, name, aliases)}
          onMerge={(sourceId, targetId) => void mergeMaster("category", sourceId, targetId)}
        />
        <MasterDataCard
          kind="supplier"
          title="廠商主檔"
          description="先建立法定／慣用原名，再由證據確認原廠或貿易商角色。"
          items={suppliers.map((item) => ({
            id: item.id, name: item.name,
            aliases: item.aliases || [], count: item.productCount || 0,
          }))}
          placeholder="廠商原名"
          onSubmit={(event) => void createMaster(event, "supplier")}
          onUpdate={(id, name, aliases) => void updateMaster("supplier", id, name, aliases)}
          onMerge={(sourceId, targetId) => void mergeMaster("supplier", sourceId, targetId)}
        />
      </div>
      {masterMessage && (
        <p className="mt-4 text-sm font-bold text-emerald-700" role="status">
          {masterMessage}
        </p>
      )}
      <Card className="mt-6 p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-slate-100 p-3 text-slate-700">
            <Users size={22} />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-950">使用者與角色</h2>
            <p className="mt-1 text-sm text-slate-500">
              共用 COMART Platform 帳號與角色；目前 {profiles.length} 人。帳號新增、
              停權與密碼請回 Platform「用戶管理」操作。
            </p>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">使用者</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3">狀態</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <p className="font-bold text-slate-900">
                      {profile.displayName}
                    </p>
                    <p className="text-xs text-slate-500">{profile.email}</p>
                  </td>
                  <td className="px-4 py-3">{profile.role}</td>
                  <td className="px-4 py-3">
                    {profile.active ? "啟用" : "已停權"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-6 flex flex-col gap-4 border-amber-200 bg-amber-50 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-black text-amber-950">30 天垃圾桶</h2>
          <p className="mt-1 text-sm text-amber-800">
            產品與原檔不會自動永久刪除；管理員需在依賴檢查後再次確認。
          </p>
        </div>
        <Link
          to="/admin/trash"
          className="rounded-xl bg-amber-900 px-4 py-2.5 text-center text-sm font-bold text-white"
        >
          查看垃圾桶
        </Link>
      </Card>
    </>
  );
}

function MasterDataCard({
  kind,
  title,
  description,
  items,
  placeholder,
  onSubmit,
  onUpdate,
  onMerge,
}: {
  kind: "category" | "supplier";
  title: string;
  description: string;
  items: { id: string; name: string; aliases: string[]; count: number }[];
  placeholder: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (id: string, name: string, aliases: string[]) => void;
  onMerge: (sourceId: string, targetId: string) => void;
}) {
  return (
    <Card className="p-6">
      <h2 className="text-xl font-black text-slate-950">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <input
          name="name"
          required
          placeholder={placeholder}
          className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm"
        />
        <Button>新增</Button>
      </form>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <MasterDataRow
            key={item.id}
            kind={kind}
            item={item}
            options={items}
            onUpdate={onUpdate}
            onMerge={onMerge}
          />
        ))}
      </div>
    </Card>
  );
}

function MasterDataRow({
  kind,
  item,
  options,
  onUpdate,
  onMerge,
}: {
  kind: "category" | "supplier";
  item: { id: string; name: string; aliases: string[]; count: number };
  options: { id: string; name: string }[];
  onUpdate: (id: string, name: string, aliases: string[]) => void;
  onMerge: (sourceId: string, targetId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("masterName") || "").trim();
    const aliases = String(form.get("aliases") || "")
      .split(/[,，\n]/).map((value) => value.trim()).filter(Boolean);
    if (!name) return;
    onUpdate(item.id, name, aliases);
    setEditing(false);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={kind === "category"
              ? "text-lg font-black text-slate-950"
              : "font-black text-slate-950"}
            >
              {item.name}
            </p>
            <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-bold text-cyan-900">
              {item.count} 個產品
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <Tags size={13} />
            {item.aliases.length ? item.aliases.join("、") : "尚無別名"}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => { setEditing((value) => !value); setMerging(false); }}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-950"
            aria-label={`修改 ${item.name}`}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={() => { setMerging((value) => !value); setEditing(false); }}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-950"
            aria-label={`合併 ${item.name}`}
          >
            <Merge size={16} />
          </button>
        </div>
      </div>

      {editing && (
        <form onSubmit={submitEdit} className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          <input
            name="masterName"
            defaultValue={item.name}
            aria-label={kind === "category" ? "分類名稱" : "廠商名稱"}
            className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm"
          />
          <input
            name="aliases"
            defaultValue={item.aliases.join(", ")}
            placeholder="別名，以逗號分隔"
            className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>取消</Button>
            <Button>儲存</Button>
          </div>
        </form>
      )}

      {merging && (
        <div className="mt-3 border-t border-amber-200 pt-3">
          <p className="text-xs leading-5 text-amber-800">
            將「{item.name}」的產品與別名移至保留主檔；來源主檔會封存。
          </p>
          <div className="mt-2 flex gap-2">
            <select
              value={mergeTarget}
              onChange={(event) => setMergeTarget(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm"
              aria-label="合併至"
            >
              <option value="">選擇保留主檔</option>
              {options.filter((option) => option.id !== item.id).map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={!mergeTarget}
              onClick={() => {
                if (mergeTarget) onMerge(item.id, mergeTarget);
                setMerging(false);
              }}
            >
              確認合併
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
