import { clsx, type ClassValue } from "clsx";
import type { ConfirmationStatus } from "./types";

export function cn(...values: ClassValue[]) {
  return clsx(values);
}

export function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const order = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** order).toFixed(order === 0 ? 0 : 1)} ${units[order]}`;
}


/* 🔴 存 key 不存文案：這個物件在模組載入時求值一次，存死字串切語言換不掉。
   呼叫端（components/ui.tsx）用 t() 取值。*/
export const confirmationLabelKeys: Record<ConfirmationStatus, string> = {
  human_confirmed: "cf_human_confirmed",
  ai_high_confidence: "cf_ai_high_confidence",
  needs_review: "cf_needs_review",
  conflict: "cf_conflict",
};
