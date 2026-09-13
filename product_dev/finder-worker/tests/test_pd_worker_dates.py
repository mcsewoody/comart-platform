from datetime import date

from pd_worker.run import filename_document_date, resolve_document_date


def test_filename_document_date_accepts_common_formats():
    assert filename_document_date("BOM/未税估价 2026.4.17.xls") == "2026-04-17"
    assert filename_document_date("报价/QI支架-2026-3-6.xlsx") == "2026-03-06"
    assert filename_document_date("drawing/產品圖20260507.pdf") == "2026-05-07"


def test_filename_document_date_ignores_folder_dates():
    assert filename_document_date("COMART 专案-2026-9-1/BOM/no-date.xls") is None


def test_processing_date_falls_back_to_filename_date():
    result = {
        "primary_document_date": "2026-09-13",
        "primary_date_type": "creation_date",
        "primary_date_evidence": "工作表顯示日期 2026/09/13",
        "primary_date_location": "Sheet1",
    }
    assert resolve_document_date(
        result,
        "BOM/未税估价 2026.4.17.xls",
        processing_date=date(2026, 9, 13),
    ) == ("2026-04-17", "filename_date", "檔名日期：未税估价 2026.4.17.xls", "檔名")


def test_explicit_original_issue_date_is_preserved():
    result = {
        "primary_document_date": "2026-04-15",
        "primary_date_type": "issue_date",
        "primary_date_evidence": "發行日期 2026/04/15",
        "primary_date_location": "Sheet1 A2",
    }
    assert resolve_document_date(
        result,
        "BOM/未税估价 2026.4.17.xls",
        processing_date=date(2026, 9, 13),
    ) == ("2026-04-15", "issue_date", "發行日期 2026/04/15", "Sheet1 A2")


def test_dynamic_date_without_filename_is_rejected():
    result = {
        "primary_document_date": "2026-09-13",
        "primary_date_type": "creation_date",
        "primary_date_evidence": "Excel TODAY()",
        "primary_date_location": "頁首",
    }
    assert resolve_document_date(
        result,
        "BOM/no-date.xls",
        processing_date=date(2026, 9, 13),
    ) == (None, None, None, None)
