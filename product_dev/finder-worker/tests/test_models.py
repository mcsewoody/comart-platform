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
