import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";
import { cn, confirmationLabels } from "../lib/utils";
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
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-700 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45",
        variant === "primary" &&
          "bg-slate-950 text-white shadow-sm hover:bg-slate-800",
        variant === "secondary" &&
          "border border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50",
        variant === "ghost" &&
          "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
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
        "rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
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
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tone === "neutral" && "bg-slate-100 text-slate-700",
        tone === "success" && "bg-emerald-50 text-emerald-700",
        tone === "warning" && "bg-amber-50 text-amber-800",
        tone === "danger" && "bg-red-50 text-red-700",
        tone === "accent" && "bg-cyan-50 text-cyan-800",
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
  const tone =
    status === "human_confirmed"
      ? "success"
      : status === "ai_high_confidence"
        ? "accent"
        : status === "conflict"
          ? "danger"
          : "warning";
  return <Badge tone={tone}>{confirmationLabels[status]}</Badge>;
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
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <div className="mb-4 rounded-2xl bg-slate-100 p-4 text-slate-600">
        {icon}
      </div>
      <h3 className="text-lg font-bold text-slate-950">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}

export function PageHeader({
  eyebrow,
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
    <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            {description}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}
