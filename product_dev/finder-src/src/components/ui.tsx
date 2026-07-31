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
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-45",
        variant === "primary" &&
          "bg-cyan-400 text-slate-950 shadow-sm hover:bg-cyan-300",
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
        "rounded-2xl border border-slate-700 bg-slate-900 shadow-[0_16px_40px_rgba(0,0,0,0.16)]",
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
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center">
      <div className="mb-4 rounded-2xl bg-slate-800 p-4 text-slate-300">
        {icon}
      </div>
      <h3 className="text-lg font-bold text-slate-100">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
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
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-black tracking-tight text-slate-100 md:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {description}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}
