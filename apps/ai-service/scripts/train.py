"""Train the document classifier and build the OCR-correction vocabulary.

Training material (development data only): sample document texts + truth labels/values,
sample applications, existing-customer names. The evaluation set is never used for training.

Usage:  python scripts/train.py
Writes: models/classifier.joblib, models/lexicon.json
"""
from __future__ import annotations

import json
import os
import re

from common import SERVICE_ROOT, data, read_csv, read_jsonl  # noqa: E402

from app.lexicon import LEXICON_PATH, MODELS_DIR, Lexicon  # noqa: E402


def split_address(addr: str) -> list[str]:
    return [s.strip() for s in addr.split(",") if s.strip()]


def build_lexicon() -> Lexicon:
    lx = Lexicon()
    truth = read_csv(data("sample", "case_02_document_truth_sample_V1.0.csv"))
    apps = read_csv(data("sample", "case_02_applications_sample_V1.0.csv"))
    customers = read_csv(data("reference", "case_02_existing_customers_V1.0.csv"))
    names = [t["name"] for t in truth if t["name"]] + [a["full_name"] for a in apps] + [c["full_name"] for c in customers]
    for n in names:
        for tok in re.split(r"[\s.\-]+", n.upper()):
            tok = re.sub(r"[^A-Z]", "", tok)
            if len(tok) >= 3:
                lx.name_tokens.add(tok)
    addresses = [t["address"] for t in truth if t["address"]] + [a["address"] for a in apps]
    for a in addresses:
        segs = split_address(a)
        if len(segs) == 5:
            lx.buildings.add(segs[1])
            lx.streets.add(segs[2])
            lx.cities.add(segs[3])
            lx.states.add(segs[4])
    for a in apps:
        lx.cities.add(a["city"])
        lx.states.add(a["state"])
    return lx


def main() -> None:
    os.makedirs(MODELS_DIR, exist_ok=True)
    lx = build_lexicon()
    with open(LEXICON_PATH, "w", encoding="utf-8") as f:
        json.dump(lx.to_json(), f, indent=1)
    print(f"lexicon: {len(lx.name_tokens)} name tokens, {len(lx.buildings)} buildings, {len(lx.streets)} streets, "
          f"{len(lx.cities)} cities, {len(lx.states)} states -> {LEXICON_PATH}")

    from app.classifier import train_model, save_model  # noqa: E402

    texts = {r["doc_id"]: r["text"] for r in read_jsonl(data("sample", "case_02_document_text_sample_V1.0.jsonl"))}
    truth = read_csv(data("sample", "case_02_document_truth_sample_V1.0.csv"))
    X = [texts[t["doc_id"]] for t in truth if t["doc_id"] in texts]
    y = [t["doc_type"] for t in truth if t["doc_id"] in texts]
    model = train_model(X, y)
    path = save_model(model)
    print(f"classifier trained on {len(X)} sample documents -> {path}")


if __name__ == "__main__":
    os.chdir(SERVICE_ROOT)
    main()
