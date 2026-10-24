"""Developer check: classification + extraction accuracy on the sample set, listing every error."""
from __future__ import annotations

import sys
from collections import Counter

from common import TRUTH_FIELDS, data, norm_value, read_csv, read_jsonl  # noqa: E402

from app.classifier import classify  # noqa: E402
from app.extractor import extract_fields, is_poor_scan  # noqa: E402

texts = {r["doc_id"]: r["text"] for r in read_jsonl(data("sample", "case_02_document_text_sample_V1.0.jsonl"))}
truth = read_csv(data("sample", "case_02_document_truth_sample_V1.0.csv"))
ok = Counter()
tot = Counter()
cls_ok = 0
verbose = "-v" in sys.argv
for t in truth:
    text = texts[t["doc_id"]]
    c = classify(text)
    cls_ok += c.doc_type == t["doc_type"]
    if c.doc_type != t["doc_type"]:
        print("CLASS", t["doc_id"], t["doc_type"], "->", c.doc_type, c.method)
    fields = extract_fields(text, t["doc_type"])
    for f in TRUTH_FIELDS:
        if not t[f]:
            continue
        tot[f] += 1
        got = fields.get(f)
        g = norm_value(f, got.value if got else None)
        if g == norm_value(f, t[f]):
            ok[f] += 1
        else:
            print(f"FIELD {t['doc_id']} {t['doc_type']:<16} {f:<14} truth={t[f]!r} got={g!r} conf={got.confidence if got else None} poor={is_poor_scan(text)}"
                  + (f" notes={got.notes}" if got and verbose else ""))
print(f"classification {cls_ok}/{len(truth)}")
for f in TRUTH_FIELDS:
    print(f"{f:<14} {ok[f]}/{tot[f]}")
print("overall", sum(ok.values()), "/", sum(tot.values()), f"{sum(ok.values())/sum(tot.values()):.4f}")
