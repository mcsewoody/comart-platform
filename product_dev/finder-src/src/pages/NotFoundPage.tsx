import { ArrowLeft, FileQuestion } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui";
import { useT } from "../i18n";

export function NotFoundPage() {
  const t = useT();
  return (
    <div className="mx-auto max-w-2xl py-16">
      <EmptyState
        icon={<FileQuestion size={28} />}
        title={t("nf_title")}
        description={t("nf_desc")}
      />
      <Link
        to="/"
        className="mx-auto mt-5 flex w-fit items-center gap-2 text-sm font-bold text-cyan-800"
      >
        <ArrowLeft size={16} />
        {t("nf_back")}
      </Link>
    </div>
  );
}
