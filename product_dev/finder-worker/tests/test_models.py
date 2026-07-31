from cpf_worker.models import (
    DocumentExtraction,
    ProductExtract,
    RepresentativeImageExtract,
    SupplierExtract,
)


def product(**overrides):
    data = {
        "name_original": "3-in-1 charger",
        "name_zh_tw": "三合一充電座",
        "name_en": "3-in-1 charger",
        "name_vi": "Bộ sạc 3 trong 1",
        "confidence": 0.95,
        "record_kind": "complete_product",
        "is_complete_product": True,
        "identity_signals": [
            "explicit_product_name",
            "function_description",
        ],
    }
    data.update(overrides)
    return ProductExtract(**data)


def test_clean_single_product_does_not_escalate():
    result = DocumentExtraction(
        document_type="product",
        summary_zh_tw="產品規格",
        confidence=0.94,
        products=[product()],
    )
    assert result.needs_escalation is False
    assert result.needs_review is False


def test_multiple_products_force_review_and_escalation():
    result = DocumentExtraction(
        document_type="product",
        summary_zh_tw="兩個變體",
        confidence=0.95,
        products=[product(), product(name_original="2-in-1 charger")],
    )
    assert result.needs_escalation is True
    assert result.needs_review is True


def test_inferred_supplier_forces_escalation():
    result = DocumentExtraction(
        document_type="product",
        summary_zh_tw="廠商來源不明",
        confidence=0.95,
        products=[
            product(
                suppliers=[
                    SupplierExtract(
                        original_name="Example Factory",
                        confidence=0.7,
                        explicit_in_document=False,
                    )
                ]
            )
        ],
    )
    assert result.needs_escalation is True


def test_representative_bbox_has_exactly_four_values():
    image = RepresentativeImageExtract(
        page_number=1,
        bbox_normalized=[0.1, 0.2, 0.7, 0.6],
        confidence=0.9,
    )
    assert image.bbox_normalized[2] == 0.7


def test_weak_product_is_downgraded_to_candidate():
    from cpf_worker.ai import ProductAnalyzer

    result = DocumentExtraction(
        document_type="product",
        summary_zh_tw="只有檔名",
        confidence=0.95,
        products=[
            product(
                identity_signals=["filename_or_folder_only"],
                is_complete_product=False,
            )
        ],
    )
    ProductAnalyzer.enforce_creation_policy(result, "產品資料.pdf")
    assert result.products[0].record_kind == "product_candidate"
    assert result.needs_review is True


def test_design_source_cannot_create_unproven_master_product():
    from cpf_worker.ai import ProductAnalyzer

    result = DocumentExtraction(
        document_type="product",
        summary_zh_tw="外觀提案",
        confidence=0.95,
        products=[product()],
    )
    ProductAnalyzer.enforce_creation_policy(result, "Magsafe Deco 外觀圖案.pdf")
    assert result.products[0].record_kind == "design_asset"


def test_bom_source_requires_complete_product_image_and_function():
    from cpf_worker.ai import ProductAnalyzer

    result = DocumentExtraction(
        document_type="quote",
        summary_zh_tw="BOM",
        confidence=0.95,
        products=[
            product(
                model_numbers=["PS-04"],
                identity_signals=["model_number", "specification_set"],
            )
        ],
    )
    ProductAnalyzer.enforce_creation_policy(result, "PS-04 三合一 BOM.xls")
    assert result.products[0].record_kind == "product_candidate"
