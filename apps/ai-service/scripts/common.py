"""Shared helpers for training / evaluation scripts."""
from __future__ import annotations

import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICE_ROOT = os.path.dirname(HERE)
sys.path.insert(0, SERVICE_ROOT)

DATA_DIR = os.environ.get("DATA_DIR", os.path.abspath(os.path.join(SERVICE_ROOT, "..", "..", "data")))
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", os.path.abspath(os.path.join(SERVICE_ROOT, "..", "..", "output")))


def data(*p: str) -> str:
    return os.path.join(DATA_DIR, *p)


def read_csv(path: str) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def read_jsonl(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def norm_value(field: str, v: str | None) -> str:
    """Normalisation used for field-level exact-match accuracy (AI-2): name/address upper case, spaces collapsed."""
    if v is None:
        return ""
    s = " ".join(str(v).split())
    if field in ("name", "address"):
        return s.upper()
    if field == "pan_number":
        return s.upper()
    return s


TRUTH_FIELDS = ["name", "dob", "gender", "pan_number", "aadhaar_last4", "address", "pincode", "document_date", "valid_until"]
