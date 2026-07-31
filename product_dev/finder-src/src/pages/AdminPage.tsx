import {
  KeyRound,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
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

  useEffect(() => {
    void api.getProfiles().then(setProfiles);
    void api.getCategories().then(setCategories);
    void api.getSuppliers().then(setSuppliers);
  }, []);

  async function createMaster(
    event: FormEvent<HTMLFormElement>,
    kind: "category" | "supplier",
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = String(new FormData(form).get("name") ?? "").trim();
    if (!value) return;
    if (kind === "category") {
      const created = await api.createCategory(value);
      setCategories((current) => [...current, created]);
    } else {
      const created = await api.createSupplier(value);
      setSuppliers((current) => [...current, created]);
    }
    form.reset();
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
          title="正式分類"
          description="只建立正式產品類別，不直接把來源資料夾當分類。"
          items={categories.map((item) => item.nameZhTw)}
          placeholder="例如：Qi 無線充電"
          onSubmit={(event) => void createMaster(event, "category")}
        />
        <MasterDataCard
          title="廠商主檔"
          description="先建立法定／慣用原名，再由證據確認原廠或貿易商角色。"
          items={suppliers.map((item) => item.name)}
          placeholder="廠商原名"
          onSubmit={(event) => void createMaster(event, "supplier")}
        />
      </div>
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
  title,
  description,
  items,
  placeholder,
  onSubmit,
}: {
  title: string;
  description: string;
  items: string[];
  placeholder: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-black text-slate-950">{title}</h2>
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
      <div className="mt-4 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
          >
            {item}
          </span>
        ))}
      </div>
    </Card>
  );
}
