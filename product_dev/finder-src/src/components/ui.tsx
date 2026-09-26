import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";
import { cn, confirmationLabelKeys } from "../lib/utils";
import { useT } from "../i18n";
import type { ConfirmationStatus } from "../lib/types";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      className={cn(
        // 尺寸對齊平台：Portal 的按鈕是 ~34px 高、10px 圓角、13px 字
        "inline-flex min-h-[34px] items-center justify-center gap-2 rounded-[10px] px-[14px] text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-45",
        variant === "primary" &&
          "bg-cyan-400 text-white shadow-sm hover:bg-cyan-300",
        variant === "secondary" &&
          "border border-slate-600 bg-slate-900 text-slate-100 hover:border-slate-500 hover:bg-slate-800",
        variant === "ghost" &&
          "text-slate-300 hover:bg-slate-800 hover:text-white",
        variant === "danger" &&
          "bg-red-700 text-white hover:bg-red-800",
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // Portal 的 .app-card／.panel 是平面的：--rl 圓角、--br 框、無陰影
        "rounded-[14px] border border-slate-700 bg-slate-900",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-semibold",
        tone === "neutral" && "bg-slate-800 text-slate-300",
        tone === "success" && "bg-emerald-950/60 text-emerald-300",
        tone === "warning" && "bg-amber-950/60 text-amber-300",
        tone === "danger" && "bg-red-950/60 text-red-300",
        tone === "accent" && "bg-cyan-950/60 text-cyan-300",
      )}
    >
      {children}
    </span>
  );
}

export function ConfirmationBadge({
  status,
}: {
  status: ConfirmationStatus;
}) {
  const t = useT();
  const tone =
    status === "human_confirmed"
      ? "success"
      : status === "ai_high_confidence"
        ? "accent"
        : status === "conflict"
          ? "danger"
          : "warning";
  return <Badge tone={tone}>{t(confirmationLabelKeys[status])}</Badge>;
}

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-[14px] border border-dashed border-slate-700 bg-slate-900 p-7 text-center">
      <div className="mb-3 rounded-xl bg-slate-800 p-3 text-slate-300">
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold text-slate-100">{title}</h3>
      <p className="mt-1.5 max-w-md text-[13px] leading-6 text-slate-400">
        {description}
      </p>
    </div>
  );
}

// ⚠️ `eyebrow` 仍留在型別裡（呼叫端還在傳），但刻意不解構、不顯示 —— 見下方註解。
export function PageHeader({
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      {/* 🔴 對齊 Portal 首頁的 .home-greeting：22px/600 標題 ＋ 13px 說明。
          eyebrow 刻意整個不畫 —— 平台上沒有第二個地方用這種行銷式小標，
          它是 Product Dev 自己那一套設計語言留下來的。props 保留是為了
          呼叫端不必全部改，傳了也不會顯示。 */}
      <div>
        <h1 className="text-[22px] font-semibold tracking-normal text-slate-100">
          {title}
        </h1>
        {description && (
          <p className="mt-[3px] max-w-3xl text-[13px] leading-6 text-slate-400">
            {description}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}
