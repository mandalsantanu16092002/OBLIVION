"""Document classification: PAN_CARD, AADHAAR_CARD, ELECTRICITY_BILL, BANK_STATEMENT, DRIVING_LICENCE or OTHER.

Hybrid of
  1. a prompt-injection guardrail (instruction-like text is data, never a document -> OTHER),
  2. OCR-tolerant weighted keywords + structural anchors (fuzzy matching on squashed text), and
  3. a TF-IDF character n-gram logistic-regression model trained on the sample texts.
declared_doc_type is never an input.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

from .lexicon import MODELS_DIR
from .ocr import fuzzy_contains, squash

MODEL_PATH = os.path.join(MODELS_DIR, "classifier.joblib")
LABELS = ["PAN_CARD", "AADHAAR_CARD", "ELECTRICITY_BILL", "BANK_STATEMENT", "DRIVING_LICENCE", "OTHER"]

INJECTION_PATTERNS = [
    r"ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+instructions",
    r"disregard\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above)",
    r"(?:note|message)\s+for\s+(?:automated\s+systems|ai|llm|assistants?)",
    r"\bai\s+assistants?\b",
    r"approve\s+this\s+applicant",
    r"mark\s+(?:every|all)\s+checks?\s+as\s+passed",
    r"\bsystem\s+prompt\b",
    r"you\s+are\s+now\s+",
    r"this\s+file\s+is\s+an?\s+[a-z_]+_card",
]

# (needle, weight). Needles are squashed (upper-case letters only, OCR digits mapped to letters).
KEYWORDS: dict[str, list[tuple[str, float]]] = {
    "PAN_CARD": [("INCOMETAX", 3), ("PERMANENTACCOUNTNUMBER", 3), ("FATHERSNAME", 1), ("IDENTITYCARD", 1)],
    "AADHAAR_CARD": [("AADHAAR", 3), ("RESIDENTIDENTITY", 3)],
    "ELECTRICITY_BILL": [("ELECTRICITYBILL", 3), ("POWERDISTRIBUTION", 2), ("CONSUMERNO", 1.5), ("UNITSCONSUMED", 2), ("BILLDATE", 1.5), ("SUPPLYADDRESS", 1.5)],
    "BANK_STATEMENT": [("ACCOUNTSTATEMENT", 3), ("STATEMENTDATE", 2), ("SALARYCREDIT", 1), ("UPIGROCERY", 1)],
    "DRIVING_LICENCE": [("DRIVINGLICENCE", 3), ("TRANSPORTDEPT", 2), ("VALIDTILL", 2), ("DLNO", 1)],
}

STRUCTURE = {
    "PAN_CARD": re.compile(r"\b[A-Z0-9]{5}[0-9OIlSBZ]{4}[A-Z0-9]\b"),
    "AADHAAR_CARD": re.compile(r"(?:X[\s.,]*){7,8}[0-9OoIlZSBG|]{4}"),
    "ELECTRICITY_BILL": re.compile(r"kWh|Amount\s+Due", re.I),
    "BANK_STATEMENT": re.compile(r"Account\s*:\s*X{4,}", re.I),
    "DRIVING_LICENCE": re.compile(r"DL\s*No", re.I),
}


@dataclass
class Classification:
    doc_type: str
    confidence: float
    method: str
    keyword_scores: dict[str, float]
    model_proba: dict[str, float] | None
    prompt_injection: bool = False

    def as_dict(self) -> dict:
        return {
            "doc_type": self.doc_type,
            "confidence": round(self.confidence, 2),
            "method": self.method,
            "keyword_scores": {k: round(v, 2) for k, v in self.keyword_scores.items()},
            "model_proba": {k: round(v, 3) for k, v in (self.model_proba or {}).items()},
            "prompt_injection": self.prompt_injection,
        }


def detect_prompt_injection(text: str) -> bool:
    t = re.sub(r"\s+", " ", text.lower())
    return any(re.search(p, t) for p in INJECTION_PATTERNS)


def keyword_scores(text: str) -> dict[str, float]:
    sq = squash(text)
    head = sq[:400]
    scores: dict[str, float] = {}
    for label, needles in KEYWORDS.items():
        s = 0.0
        for needle, w in needles:
            hay = head if w >= 2 else sq
            m = 1.0 if needle in sq else fuzzy_contains(hay, needle, max_ratio=0.25)
            s += w * m
        if STRUCTURE[label].search(text):
            s += 2.0
        scores[label] = s
    return scores


def _prep(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower())


def train_model(texts: list[str], labels: list[str]):
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline

    model = Pipeline([
        ("tfidf", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, preprocessor=_prep)),
        ("lr", LogisticRegression(C=20.0, max_iter=3000, class_weight="balanced")),
    ])
    model.fit(texts, labels)
    return model


def save_model(model) -> str:
    import joblib

    os.makedirs(MODELS_DIR, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    return MODEL_PATH


_model = None
_model_loaded = False


def load_model():
    global _model, _model_loaded
    if not _model_loaded:
        _model_loaded = True
        if os.path.exists(MODEL_PATH):
            import joblib

            _model = joblib.load(MODEL_PATH)
    return _model


def classify(text: str, model=None, use_model: bool = True) -> Classification:
    if detect_prompt_injection(text):
        return Classification("OTHER", 0.99, "guardrail:prompt-injection", {}, None, prompt_injection=True)
    kw = keyword_scores(text)
    proba = None
    mdl = model if model is not None else (load_model() if use_model else None)
    if mdl is not None:
        p = mdl.predict_proba([text])[0]
        proba = {str(c): float(v) for c, v in zip(mdl.classes_, p)}
    ranked = sorted(kw.items(), key=lambda kv: kv[1], reverse=True)
    (top, top_s), (_, second_s) = ranked[0], ranked[1]
    margin = top_s - second_s
    model_top = max(proba, key=proba.get) if proba else None
    # Strong keyword evidence: at least two independent features (>= 5 points) and a clear margin.
    if top_s >= 5 and margin >= 2:
        kw_conf = min(1.0, margin / 6.0)
        mp = proba.get(top, 0.0) if proba else kw_conf
        conf = 0.55 * kw_conf + 0.45 * max(mp, 0.5)
        if proba and model_top != top:
            conf = min(conf, 0.75)
            method = "keywords (model disagrees)"
        else:
            method = "keywords+model" if proba else "keywords"
        return Classification(top, max(0.5, min(0.99, conf)), method, kw, proba)
    if proba:
        conf = proba[model_top]
        if model_top != "OTHER" and conf < 0.6:
            return Classification("OTHER", 1 - conf, "model (low confidence -> OTHER)", kw, proba)
        if model_top != "OTHER" and top_s < 3:
            # the model says it is a known document but no keyword supports it: be conservative
            return Classification(model_top, min(conf, 0.7), "model (weak keyword support)", kw, proba)
        return Classification(model_top, conf, "model", kw, proba)
    return Classification("OTHER", 0.6 if top_s < 3 else 0.4, "keywords (insufficient evidence)", kw, None)


def keyword_baseline(text: str) -> str:
    """The simple keyword rule used as a baseline (bank statements mention ELECTRICITY, hence its errors)."""
    t = text.upper()
    if "INCOME TAX" in t:
        return "PAN_CARD"
    if "AADHAAR" in t:
        return "AADHAAR_CARD"
    if "ELECTRICITY" in t:
        return "ELECTRICITY_BILL"
    if "DRIVING" in t:
        return "DRIVING_LICENCE"
    if "BANK" in t or "STATEMENT" in t:
        return "BANK_STATEMENT"
    return "OTHER"
