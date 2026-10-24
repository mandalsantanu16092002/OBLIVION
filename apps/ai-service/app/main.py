"""FastAPI app for the OnboardIQ AI extraction provider ("ai") behind the FR-3 interface.

Only the Node.js backend calls this service, with the service key from the SERVICE_KEY env variable.
"""
from __future__ import annotations

import logging
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .classifier import load_model
from .lexicon import load_lexicon
from .pipeline import extract_document
from .summary import summarise
from .version import CLASSIFIER_VERSION, EXTRACTOR_VERSION, LEXICON_VERSION, RULES_PATTERN_VERSION, SUMMARY_PROMPT_VERSION

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("onboardiq.ai")

SERVICE_KEY = os.environ.get("SERVICE_KEY", "")
MAX_TEXT = 1_000_000

app = FastAPI(
    title="OnboardIQ AI Extraction Service",
    version="1.0.0",
    description="Document classification and field extraction from OCR text. The AI never decides: it only supplies doc_type and field values with confidence.",
)


def require_service_key(x_service_key: str | None = Header(default=None)) -> None:
    if SERVICE_KEY and x_service_key != SERVICE_KEY:
        raise HTTPException(status_code=401, detail="invalid service key")


class ExtractRequest(BaseModel):
    doc_id: str = Field(min_length=1, max_length=40)
    text: str = Field(max_length=MAX_TEXT)


class ClassifyRequest(BaseModel):
    text: str = Field(max_length=MAX_TEXT)


@app.on_event("startup")
def _warm() -> None:
    load_lexicon()
    m = load_model()
    log.info("AI service ready (classifier model loaded=%s)", m is not None)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model_loaded": load_model() is not None,
        "versions": {
            "extractor": EXTRACTOR_VERSION,
            "patterns": RULES_PATTERN_VERSION,
            "classifier": CLASSIFIER_VERSION,
            "lexicon": LEXICON_VERSION,
            "summary_prompt": SUMMARY_PROMPT_VERSION,
        },
    }


@app.post("/v1/extract", dependencies=[Depends(require_service_key)])
def extract(req: ExtractRequest) -> dict:
    # Document text is data, never instructions; it is not logged (PII).
    result = extract_document(req.doc_id, req.text)
    log.info("extracted doc_id=%s doc_type=%s conf=%.2f fields=%d %.1fms injection=%s",
             req.doc_id, result["doc_type"], result["confidence"], len(result["fields"]), result["elapsed_ms"],
             result["classification"]["prompt_injection"])
    return result


@app.post("/v1/classify", dependencies=[Depends(require_service_key)])
def classify_only(req: ClassifyRequest) -> dict:
    from .classifier import classify

    return classify(req.text).as_dict()


@app.post("/v1/summary", dependencies=[Depends(require_service_key)])
def summary(case: dict) -> dict:
    return summarise(case)
