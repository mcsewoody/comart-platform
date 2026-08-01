import { appConfig } from "./config";
import {
  demoCategories,
  demoDocuments,
  demoJobs,
  demoProductDetails,
  demoProducts,
  demoReviewTasks,
} from "./demo-data";
import { getPlatformSession } from "./platform-session";
import type {
  Category,
  BatchApprovalResult,
  BatchProductGapResult,
  MappingSuggestion,
  DocumentSummary,
  ExtractedItemResolution,
  ProcessingJob,
  ProductDetail,
  ProductSummary,
  ProductReviewGap,
  Profile,
  ReviewTask,
  SearchFilters,
  SearchResponse,
  SupplierOption,
  TrashItem,
} from "./types";

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("zh-Hant");
}

function includesAny(values: Array<string | null | undefined>, query: string) {
  const term = normalize(query);
  if (!term) return true;
  return values.some((value) => normalize(value ?? "").includes(term));
}

function demoSearchProducts(
  query: string,
  filters: SearchFilters,
): SearchResponse<ProductSummary> {
  const started = performance.now();
  const items = demoProducts.filter(
    (product) =>
      includesAny(
        [
          product.nameOriginal,
          product.nameZhTw,
          product.nameEn,
          product.nameVi,
          product.brand,
          ...product.modelNumbers,
          ...product.functions,
          ...product.keywords,
        ],
        query,
      ) &&
      (!filters.categoryId || product.category?.id === filters.categoryId) &&
      (!filters.supplierId ||
        product.suppliers.some((item) => item.id === filters.supplierId)) &&
      (!filters.confirmationStatus ||
        product.confirmationStatus === filters.confirmationStatus),
  );
  return {
    items,
    total: items.length,
    queryId: crypto.randomUUID(),
    elapsedMs: Math.max(18, Math.round(performance.now() - started)),
  };
}

function demoSearchDocuments(
  query: string,
  filters: SearchFilters,
): SearchResponse<DocumentSummary> {
  const started = performance.now();
  const items = demoDocuments.filter(
    (document) =>
      includesAny([document.title, document.sourcePath], query) &&
      (!filters.extension || document.extension === filters.extension),
  );
  return {
    items,
    total: items.length,
    queryId: crypto.randomUUID(),
    elapsedMs: Math.max(14, Math.round(performance.now() - started)),
  };
}

async function platformCall<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const session = getPlatformSession();
  if (!session?.sig) throw new Error("Platform 登入已失效，請返回首頁重新登入。");
  const response = await fetch(appConfig.platformApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-session": session.sig,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(result.message || result.error || `操作失敗 (${response.status})`),
    );
  }
  return result as T;
}

export const api = {
  async getProfiles(): Promise<Profile[]> {
    if (appConfig.demoMode) {
      return [
        {
          id: "demo-user",
          email: "woody@comart.com.tw",
          displayName: "Woody",
          role: "admin",
          active: true,
        },
      ];
    }
    return (await platformCall<{ items: Profile[] }>("profiles")).items;
  },

  async getTrashItems(): Promise<TrashItem[]> {
    if (appConfig.demoMode) return [];
    return (await platformCall<{ items: TrashItem[] }>("trash")).items;
  },

  async restoreTrashItem(item: TrashItem) {
    if (appConfig.demoMode) return;
    await platformCall("restore", { item });
  },

  async inviteUser() {
    throw new Error("使用者由 COMART Platform 的「用戶管理」統一管理。");
  },

  async getFileUrl(
    documentId: string,
    kind: "source" | "preview" | "thumbnail",
  ): Promise<string | null> {
    if (appConfig.demoMode) return null;
    return (
      await platformCall<{ url: string | null }>("fileUrl", {
        documentId,
        kind,
      })
    ).url;
  },

  async getProductThumbnailUrl(productId: string): Promise<string | null> {
    if (appConfig.demoMode) return null;
    return (
      await platformCall<{ url: string | null }>("fileUrl", {
        productId,
        kind: "product_thumbnail",
      })
    ).url;
  },

  async searchProducts(query: string, filters: SearchFilters) {
    if (appConfig.demoMode) return demoSearchProducts(query, filters);
    return platformCall<SearchResponse<ProductSummary>>("searchProducts", {
      query,
      filters,
    });
  },

  async searchDocuments(query: string, filters: SearchFilters) {
    if (appConfig.demoMode) return demoSearchDocuments(query, filters);
    return platformCall<SearchResponse<DocumentSummary>>("searchDocuments", {
      query,
      filters,
    });
  },

  async getProduct(id: string): Promise<ProductDetail | null> {
    if (appConfig.demoMode) {
      return demoProductDetails.find((item) => item.id === id) ?? null;
    }
    return (await platformCall<{ item: ProductDetail | null }>("product", { id }))
      .item;
  },

  async updateProduct(id: string, patch: Record<string, unknown>) {
    if (appConfig.demoMode) return;
    await platformCall("updateProduct", { id, patch });
  },

  async getDocument(id: string): Promise<DocumentSummary | null> {
    if (appConfig.demoMode) {
      return demoDocuments.find((item) => item.id === id) ?? null;
    }
    return (
      await platformCall<{ item: DocumentSummary | null }>("document", { id })
    ).item;
  },

  async resolveExtractedItem(
    itemId: string,
    resolution: ExtractedItemResolution,
  ): Promise<{ productId: string | null }> {
    if (appConfig.demoMode) return { productId: resolution.productId ?? null };
    return (
      await platformCall<{ result: { productId: string | null } }>(
        "resolveExtractedItem",
        { itemId, resolution },
      )
    ).result;
  },

  async getProductReviewGaps(): Promise<ProductReviewGap[]> {
    if (appConfig.demoMode) return [];
    return (
      await platformCall<{ items: ProductReviewGap[] }>("productReviewGaps")
    ).items;
  },

  async batchFillProductGaps(
    productIds: string[],
    field: "category" | "supplier" | "model",
    value: Record<string, unknown>,
  ): Promise<BatchProductGapResult> {
    if (appConfig.demoMode) {
      return { requested: productIds.length, updated: productIds.length, field };
    }
    return (
      await platformCall<{ result: BatchProductGapResult }>(
        "batchFillProductGaps",
        { productIds, field, value },
      )
    ).result;
  },

  async getCategories(): Promise<Category[]> {
    if (appConfig.demoMode) return demoCategories;
    return (await platformCall<{ items: Category[] }>("categories")).items;
  },

  async getSuppliers(): Promise<SupplierOption[]> {
    if (appConfig.demoMode) return [];
    return (await platformCall<{ items: SupplierOption[] }>("suppliers")).items;
  },

  async createCategory(nameZhTw: string): Promise<Category> {
    if (appConfig.demoMode) {
      return { id: crypto.randomUUID(), nameZhTw, parentId: null };
    }
    return (
      await platformCall<{ item: Category }>("createCategory", { nameZhTw })
    ).item;
  },

  async createSupplier(legalName: string): Promise<SupplierOption> {
    if (appConfig.demoMode) {
      return { id: crypto.randomUUID(), name: legalName };
    }
    return (
      await platformCall<{ item: SupplierOption }>("createSupplier", {
        legalName,
      })
    ).item;
  },

  async updateMaster(
    kind: "category" | "supplier",
    id: string,
    name: string,
    aliases: string[],
  ) {
    if (appConfig.demoMode) return;
    await platformCall("updateMaster", { kind, id, name, aliases });
  },

  async mergeMaster(
    kind: "category" | "supplier",
    sourceId: string,
    targetId: string,
  ) {
    if (appConfig.demoMode) return;
    await platformCall("mergeMaster", { kind, sourceId, targetId });
  },

  async getJobs(): Promise<ProcessingJob[]> {
    if (appConfig.demoMode) return demoJobs;
    return (await platformCall<{ items: ProcessingJob[] }>("jobs")).items;
  },

  async getReviewTasks(): Promise<ReviewTask[]> {
    if (appConfig.demoMode) return demoReviewTasks;
    return (await platformCall<{ items: ReviewTask[] }>("reviews")).items;
  },

  async getMappingSuggestions(): Promise<MappingSuggestion[]> {
    if (appConfig.demoMode) return [];
    return (
      await platformCall<{ items: MappingSuggestion[] }>("mappingSuggestions")
    ).items;
  },

  async applyMappingSuggestions(ids: string[]): Promise<{ applied: number }> {
    if (appConfig.demoMode) return { applied: ids.length };
    return (
      await platformCall<{ result: { applied: number } }>(
        "applyMappingSuggestions",
        { ids },
      )
    ).result;
  },

  async closeReviewTask(id: string, status: "resolved" | "dismissed") {
    if (appConfig.demoMode) return;
    await platformCall("closeReview", { id, status });
  },

  async batchApproveDocuments(documentIds: string[]) {
    if (appConfig.demoMode) {
      return {
        documentsApproved: documentIds.length,
        productsConfirmed: documentIds.length,
        reviewTasksResolved: documentIds.length,
      } satisfies BatchApprovalResult;
    }
    return (
      await platformCall<{ result: BatchApprovalResult }>(
        "batchApproveDocuments",
        { documentIds },
      )
    ).result;
  },

  async uploadFiles(files: File[], sensitivity: string) {
    if (appConfig.demoMode) {
      return files.map((file) => ({ name: file.name, status: "queued" }));
    }
    const results = [];
    for (const file of files) {
      const init = await platformCall<{ path: string; signedUrl: string }>(
        "initUpload",
        { name: file.name, byteSize: file.size },
      );
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      const upload = await fetch(init.signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: form,
      });
      if (!upload.ok) throw new Error(`上傳失敗：${file.name}`);
      results.push(
        await platformCall("completeUpload", {
          name: file.name,
          path: init.path,
          mimeType: file.type || "application/octet-stream",
          byteSize: file.size,
          sensitivity,
        }),
      );
    }
    return results;
  },
};
