"""Classify + extract one document and return the FR-3 long format."""
from __future__ import annotations

import time

from .classifier import classify
from .extractor import extract_fields, is_poor_scan
from .version import version_string


def extract_document(doc_id: str, text: str, *, ocr_correction: bool = True, use_model: bool = True) -> dict:
    t0 = time.perf_counter()
    cls = classify(text, use_model=use_model)
    fields = extract_fields(text, cls.doc_type, ocr_correction=ocr_correction) if cls.doc_type != "OTHER" else {}
    rows = [{"doc_id": doc_id, "field_name": "doc_type", "value": cls.doc_type, "confidence": round(cls.confidence, 2)}]
    field_list = []
    for name, f in fields.items():
        d = f.as_dict()
        rows.append({"doc_id": doc_id, "field_name": name, "value": d["value"], "confidence": d["confidence"]})
        field_list.append({"field_name": name, **d})
    return {
        "doc_id": doc_id,
        "provider": "ai",
        "doc_type": cls.doc_type,
        "confidence": round(cls.confidence, 2),
        "classification": cls.as_dict(),
        "poor_scan": is_poor_scan(text),
        "fields": field_list,
        "rows": rows,
        "extractor_version": version_string(),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }
