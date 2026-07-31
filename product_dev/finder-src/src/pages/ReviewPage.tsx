import {
  ArrowRight,
  Factory,
  GitCompareArrows,
  Layers3,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import type { ReviewTask } from "../lib/types";
import { formatDate } from "../lib/utils";

const taskIcons = {
  field_conflict: ShieldAlert,
  product_split: Layers3,
  supplier: Factory,
  duplicate: GitCompareArrows,
};

export function ReviewPage() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  useEffect(() => {
    void api.getReviewTasks().then(setTasks);
  }, []);

  async function close(id: string, status: "resolved" | "dismissed") {
    await api.closeReviewTask(id, status);
    setTasks((current) => current.filter((item) => item.id !== id));
  }

  return (
    <>
      <PageHeader
        eyebrow="Human in the loop"
        title="AI 審核"
        description="只處理會影響產品正確性的例外：產品拆分、廠商推定、欄位衝突與疑似重複。人工確認後立即生效並留下版本。"
      />
      <div className="mb-5 flex flex-wrap gap-2">
        <Badge tone="danger">
          {tasks.filter((item) => item.priority === "high").length} 個高優先
        </Badge>
        <Badge>{tasks.length} 個待處理</Badge>
      </div>
      <div className="space-y-4">
        {tasks.map((task) => {
          const Icon = taskIcons[task.type];
          return (
            <Card
              key={task.id}
              className="grid gap-4 p-5 md:grid-cols-[44px_minmax(0,1fr)_auto] md:items-center"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <Icon size={21} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-black text-slate-950">{task.title}</h2>
                  {task.priority === "high" && (
                    <Badge tone="danger">高優先</Badge>
                  )}
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {task.description}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {task.documentTitle} · {formatDate(task.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                {(task.productId || task.documentId) && (
                  <Link
                    to={
                      task.productId
                        ? `/products/${task.productId}`
                        : `/documents/${task.documentId}`
                    }
                  >
                    <Button variant="secondary">
                      查看證據
                      <ArrowRight size={16} />
                    </Button>
                  </Link>
                )}
                <Button onClick={() => void close(task.id, "resolved")}>
                  標記已處理
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void close(task.id, "dismissed")}
                >
                  維持現況
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
