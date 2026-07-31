import { ArrowLeft, FileQuestion } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <EmptyState
        icon={<FileQuestion size={28} />}
        title="找不到這個頁面"
        description="網址可能已變更，或你沒有查看該資料的權限。"
      />
      <Link
        to="/"
        className="mx-auto mt-5 flex w-fit items-center gap-2 text-sm font-bold text-cyan-800"
      >
        <ArrowLeft size={16} />
        回到產品搜尋
      </Link>
    </div>
  );
}
