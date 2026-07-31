from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


Confirmation = Literal[
    "human_confirmed", "ai_high_confidence", "needs_review", "conflict"
]
DocumentType = Literal[
    "product",
    "quote",
    "test_certification",
    "meeting_project",
    "supplier",
    "contract_commercial",
    "other",
]
RecordKind = Literal[
    "complete_product",
    "product_variant",
    "design_asset",
    "component",
    "commercial_line_item",
    "product_candidate",
]
IdentitySignal = Literal[
    "explicit_product_name",
    "model_number",
    "complete_product_image",
    "function_description",
    "specification_set",
    "pricing_line",
    "filename_or_folder_only",
]


class EvidenceExtract(BaseModel):
    field_name: str
    source_locator: str
    excerpt: str = ""
    confidence: float = Field(ge=0, le=1)


class SpecificationExtract(BaseModel):
    name: str
    value_text: str = ""
    value_number: float | None = None
    unit: str | None = None
    source_text: str
    confidence: float = Field(ge=0, le=1)


class SupplierExtract(BaseModel):
    original_name: str
    role: Literal["manufacturer", "trader", "partner", "unknown"] = "unknown"
    explicit_in_document: bool = False
    confidence: float = Field(ge=0, le=1)
    evidence: EvidenceExtract | None = None


class QuoteTierExtract(BaseModel):
    min_quantity: int = Field(gt=0)
    max_quantity: int | None = None
    unit_price: float = Field(ge=0)


class QuoteExtract(BaseModel):
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    moq: int | None = Field(default=None, ge=0)
    lead_time_days: int | None = Field(default=None, ge=0)
    incoterm: str | None = None
    quote_date: date | None = None
    tiers: list[QuoteTierExtract] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)


class RepresentativeImageExtract(BaseModel):
    page_number: int = Field(ge=1)
    bbox_normalized: list[float] = Field(min_length=4, max_length=4)
    confidence: float = Field(ge=0, le=1)


class ProductExtract(BaseModel):
    name_original: str
    name_zh_tw: str
    name_en: str
    name_vi: str
    brand: str | None = None
    model_numbers: list[str] = Field(default_factory=list)
    category_name: str | None = None
    functions: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    specifications: list[SpecificationExtract] = Field(default_factory=list)
    suppliers: list[SupplierExtract] = Field(default_factory=list)
    quote: QuoteExtract | None = None
    evidence: list[EvidenceExtract] = Field(default_factory=list)
    representative_image: RepresentativeImageExtract | None = None
    representative_thumbnail_path: str | None = None
    record_kind: RecordKind = "product_candidate"
    family_key: str | None = None
    parent_product_name: str | None = None
    is_complete_product: bool = False
    identity_signals: list[IdentitySignal] = Field(default_factory=list)
    creation_rationale: str = ""


class DocumentExtraction(BaseModel):
    document_type: DocumentType
    language_codes: list[str] = Field(default_factory=list)
    summary_zh_tw: str
    products: list[ProductExtract] = Field(default_factory=list)
    review_reasons: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)

    @property
    def master_products(self) -> list[ProductExtract]:
        return [
            product
            for product in self.products
            if product.record_kind == "complete_product"
        ]

    @property
    def needs_escalation(self) -> bool:
        supplier_risk = any(
            supplier.original_name and not supplier.explicit_in_document
            for product in self.products
            for supplier in product.suppliers
        )
        return (
            self.confidence < 0.86
            or len(self.master_products) > 1
            or bool(self.review_reasons)
            or supplier_risk
            or any(
                product.record_kind == "product_candidate"
                for product in self.products
            )
        )

    @property
    def needs_review(self) -> bool:
        return (
            self.confidence < 0.9
            or len(self.master_products) > 1
            or bool(self.review_reasons)
            or any(product.confidence < 0.9 for product in self.master_products)
            or any(
                product.record_kind == "product_candidate"
                for product in self.products
            )
        )


class ExtractedDocument(BaseModel):
    text: str
    page_count: int | None = None
    preview_pdf: str | None = None
    thumbnail: str | None = None
    image_paths: list[str] = Field(default_factory=list)
    deep_analysis_eligible: bool = True
    reason_skipped: str | None = None
