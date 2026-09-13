from pathlib import Path

from cpf_worker import extractors


def test_modern_office_text_failure_falls_back_to_pdf(monkeypatch):
    def invalid_stylesheet(_path: Path) -> str:
        raise ValueError("could not read stylesheet")

    monkeypatch.setattr(extractors, "_modern_office_text", invalid_stylesheet)
    assert extractors._best_effort_modern_office_text(Path("broken.xlsx")) == ""
