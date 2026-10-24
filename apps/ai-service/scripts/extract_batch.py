"""Run the AI extractor over a document-text JSONL file and write the long-format extraction CSV.

Usage:
  python scripts/extract_batch.py                       # evaluation set -> output/extraction_output.csv
  python scripts/extract_batch.py --set sample          # sample set     -> output/extraction_output_sample.csv
  python scripts/extract_batch.py --input X.jsonl --out Y.csv
"""
from __future__ import annotations

import argparse
import csv
import os
import time

from common import OUTPUT_DIR, data, read_jsonl  # noqa: E402

from app.pipeline import extract_document  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", choices=["eval", "sample"], default="eval")
    ap.add_argument("--input")
    ap.add_argument("--out")
    args = ap.parse_args()
    src = args.input or data(args.set, f"case_02_document_text_{args.set}_V1.0.jsonl")
    out = args.out or os.path.join(OUTPUT_DIR, "extraction_output.csv" if args.set == "eval" else "extraction_output_sample.csv")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    docs = read_jsonl(src)
    t0 = time.perf_counter()
    n_rows = 0
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["doc_id", "field_name", "value", "confidence"])
        for d in docs:
            res = extract_document(d["doc_id"], d["text"])
            for r in res["rows"]:
                w.writerow([r["doc_id"], r["field_name"], r["value"], f"{r['confidence']:.2f}"])
                n_rows += 1
    dt = time.perf_counter() - t0
    print(f"{len(docs)} documents -> {n_rows} rows in {dt:.2f}s ({1000 * dt / max(1, len(docs)):.1f} ms/doc) -> {out}")


if __name__ == "__main__":
    main()
