export type UserRole = "viewer" | "editor" | "admin";
export type Sensitivity = "general" | "commercial" | "highly_confidential";
export type ConfirmationStatus =
  | "human_confirmed"
  | "ai_high_confidence"
  | "needs_review"
  | "conflict";
export type ProcessingStatus =
  | "queued"
  | "converting"
  | "analyzing"
  | "needs_review"
  | "completed"
  | "failed";
export type DocumentType =
  | "product"
  | "quote"
  | "test_certification"
  | "meeting_project"
  | "supplier"
  | "contract_commercial"
  | "other";

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

export interface Category {
  id: string;
  nameZhTw: string;
  parentId?: string | null;
  aliases?: string[];
  productCount?: number;
}

export interface SupplierRef {
  id: string;
  name: string;
  role: "manufacturer" | "trader" | "partner" | "unknown";
  confirmationStatus: ConfirmationStatus;
}

export interface SupplierOption {
  id: string;
  name: string;
  aliases?: string[];
  productCount?: number;
}

export interface Specification {
  id: string;
  name: string;
  valueText?: string | null;
  valueNumber?: number | null;
  unit?: string | null;
  sourceText: string;
  confirmationStatus: ConfirmationStatus;
}

export interface Evidence {
  id: string;
  fieldName: string;
  sourceLabel: string;
  sourceLocator: string;
  excerpt?: string | null;
  confirmationStatus: ConfirmationStatus;
}

export interface ProductSummary {
  id: string;
  nameOriginal: string;
  nameZhTw: string;
  nameEn: string;
  nameVi: string;
  brand?: string | null;
  modelNumbers: string[];
  category?: Category | null;
  functions: string[];
  keywords: string[];
  suppliers: SupplierRef[];
  confirmationStatus: ConfirmationStatus;
  thumbnailUrl?: string | null;
  documentCount: number;
  updatedAt: string;
  score?: number;
}

export interface ProductDetail extends ProductSummary {
  specifications: Specification[];
  evidence: Evidence[];
  documents: DocumentSummary[];
  latestConfirmedQuote?: QuoteSummary | null;
}

export interface DocumentSummary {
  id: string;
  title: string;
  extension: string;
  documentType: DocumentType;
  sensitivity: Sensitivity;
  processingStatus: ProcessingStatus;
  sourcePath: string;
  version: number;
  byteSize: number;
  pageCount?: number | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  updatedAt: string;
  score?: number;
  extractedItems?: ExtractedDocumentItem[];
  analysis?: DocumentAnalysisSummary;
  linkedProducts?: ProductSummary[];
}

export type ExtractedItemKind =
  | "complete_product"
  | "product_variant"
  | "design_asset"
  | "component"
  | "commercial_line_item"
  | "product_candidate";

export interface ExtractedDocumentItem {
  id: string;
  kind: ExtractedItemKind;
  name: string;
  familyKey?: string | null;
  parentProductName?: string | null;
  modelNumbers: string[];
  identitySignals: string[];
  rationale: string;
  confidence: number;
  reviewStatus: "open" | "resolved" | "dismissed";
  promotedProductId?: string | null;
  actionable?: boolean;
}

export type ExtractedItemResolutionAction = "create" | "link" | "keep";

export interface ExtractedItemResolution {
  action: ExtractedItemResolutionAction;
  productId?: string | null;
  categoryId?: string | null;
  suppliers?: Array<{ id: string; role: SupplierRef["role"] }> | null;
}

export type ProductReviewGapKind =
  | "category"
  | "supplier"
  | "model"
  | "thumbnail";

export interface ProductReviewGap {
  product: ProductSummary;
  missing: ProductReviewGapKind[];
}

export interface BatchProductGapResult {
  requested: number;
  updated: number;
  field: Exclude<ProductReviewGapKind, "thumbnail">;
}

export interface DocumentAnalysisSummary {
  status: "not_analyzed" | "legacy" | "current";
  policyVersion?: string | null;
  summary: string;
  reviewReasons: string[];
  masterProductCount: number;
  extractedItemCount: number;
}

export interface QuoteSummary {
  id: string;
  supplierName: string;
  currency?: string | null;
  unitPrice?: number | null;
  moq?: number | null;
  leadTimeDays?: number | null;
  quoteDate?: string | null;
  incoterm?: string | null;
}

export interface SearchFilters {
  categoryId?: string;
  supplierId?: string;
  extension?: string;
  confirmationStatus?: ConfirmationStatus;
  uncategorized?: boolean;
  withoutSupplier?: boolean;
}

export interface SearchResponse<T> {
  items: T[];
  total: number;
  queryId?: string;
  elapsedMs: number;
}

export interface ProcessingJob {
  id: string;
  documentTitle: string;
  status: ProcessingStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewTask {
  id: string;
  type: "field_conflict" | "product_split" | "supplier" | "duplicate";
  title: string;
  description: string;
  documentTitle: string;
  documentId?: string | null;
  productId?: string | null;
  priority: "high" | "normal" | "low";
  createdAt: string;
}

export interface BatchApprovalResult {
  documentsApproved: number;
  productsConfirmed: number;
  reviewTasksResolved: number;
}

export interface MappingSuggestion {
  id: string;
  type: "category" | "supplier";
  productId: string;
  productName: string;
  modelNumbers: string[];
  masterId: string;
  masterName: string;
  supplierRole?: SupplierRef["role"] | null;
  confidence: number;
  rationale: string;
  evidenceExcerpt?: string | null;
}

export interface TrashItem {
  id: string;
  kind: "product" | "document";
  title: string;
  deletedAt: string;
}
