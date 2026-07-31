import { clsx, type ClassValue } from "clsx";
import type {
  ConfirmationStatus,
  ProcessingStatus,
  Sensitivity,
} from "./types";

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

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export const confirmationLabels: Record<ConfirmationStatus, string> = {
  human_confirmed: "已人工確認",
  ai_high_confidence: "AI 高信心",
  needs_review: "待確認",
  conflict: "有衝突",
};

export const processingLabels: Record<ProcessingStatus, string> = {
  queued: "排隊",
  converting: "轉檔",
  analyzing: "AI 分析",
  needs_review: "待審核",
  completed: "完成",
  failed: "失敗",
};

export const sensitivityLabels: Record<Sensitivity, string> = {
  general: "一般",
  commercial: "商業敏感",
  highly_confidential: "高度機密",
};
