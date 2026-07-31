import { ArchiveRestore, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, EmptyState, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import type { TrashItem } from "../lib/types";
import { formatDate } from "../lib/utils";

export function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([]);
  useEffect(() => {
    void api.getTrashItems().then(setItems);
  }, []);

  async function restore(item: TrashItem) {
    await api.restoreTrashItem(item);
    setItems((current) => current.filter((candidate) => candidate !== item));
  }

  return (
    <>
      <PageHeader
        eyebrow="Recovery"
        title="垃圾桶"
        description="軟刪除資料保留至少 30 天。期滿不會自動清除，永久刪除仍需管理員確認。"
        action={
          <Button variant="danger" disabled>
            <Trash2 size={17} />
            永久清除已到期項目
          </Button>
        }
      />
      <Card className="p-4">
        {items.length ? (
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                className="flex items-center justify-between gap-4 p-4"
              >
                <div>
                  <p className="font-bold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.kind === "product" ? "產品" : "文件"} · 刪除於{" "}
                    {formatDate(item.deletedAt)}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void restore(item)}
                >
                  <ArchiveRestore size={16} />
                  復原
                </Button>
              </div>
            ))}
          </div>
        ) : (
        <EmptyState
          icon={<ArchiveRestore size={27} />}
          title="垃圾桶目前是空的"
          description="被刪除的產品與文件會在此顯示復原期限、關聯資料與刪除操作者。"
        />
        )}
      </Card>
    </>
  );
}
