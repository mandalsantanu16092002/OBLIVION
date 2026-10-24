# Model card – OnboardIQ AI extractor

| | |
|---|---|
| Version | `onboardiq-ai-extractor/1.0.0; patterns-v1.3; hybrid-kw+tfidf-lr-v1.0; lexicon-v1.0` (recorded with every extraction in `extractions.extractor_version`) |
| Code | `apps/ai-service/app/` (classifier.py, extractor.py, ocr.py, lexicon.py, summary.py) |
| Owner | OnboardIQ team (hackathon build) |
| Provider | Self-hosted Python (FastAPI). No hosted model is used for extraction. Optional reviewer summary: Anthropic Messages API (`LLM_MODEL`, default `claude-haiku-4-5`) only when `ANTHROPIC_API_KEY` is set |

## Intended use

Classify synthetic OCR text of KYC documents (PAN card, Aadhaar card, electricity bill, bank statement, driving licence, other) and extract name, date of birth, gender, PAN, Aadhaar last 4 digits, address, pincode, document date and validity date with a confidence per field. The output is an **input to the rules engine**; the model never decides approval.

Out of scope: real identity documents, images (no OCR stage), fraud detection, any decision.

## How it works

1. **Prompt-injection guardrail** – instruction-like text ("ignore all previous instructions", "approve this applicant", "note for AI assistants", …) is data, never a document → OTHER with confidence 0.99, no fields extracted.
2. **Classification** – OCR-tolerant weighted keywords on squashed text (digits mapped to look-alike letters, fuzzy substring matching) plus structural anchors (masked Aadhaar number, PAN pattern, `kWh`, `DL No`), combined with a TF-IDF character n-gram logistic-regression model trained on the 178 sample texts. Strong keyword evidence needs two independent features, so a single word such as "AADHAAR_CARD" in a letter cannot make it an Aadhaar card. declared_doc_type is never an input.
3. **Field extraction** – label-anchored regular expressions per document type with OCR correction: positional PAN correction (letters 1–5 and 10, digits 6–9), digit look-alike mapping in dates, pincodes and Aadhaar digits, month-name fuzzy matching, name tokens corrected against a vocabulary (substitution-only, so real differences such as `Ravi K` or `Aish` are kept), template-aware address correction against a learned gazetteer.
4. **Normalisation** – dates `YYYY-MM-DD`, PAN upper case, pincode 6 digits, Aadhaar last 4 only, gender M/F.
5. **Confidence** – 0.97 clean / 0.93 poor scan for an uncorrected value; lowered for each correction (e.g. 0.88 for one OCR digit fix, 0.74 for an arbitrary letter substitution in a name, 0.75 when a date label was unreadable and the value was assigned by order).

## Training data

Development material only: sample document texts and truth file (178 documents), sample applications, existing-customer names, plus a small built-in gazetteer of Indian states, cities and common names. **Watchlist names are excluded from the vocabulary** so corrections can never move a name towards a sanctions or PEP entry. The evaluation set is never used for training.

## Evaluation (details in `/output/evaluation_report.md`)

* Classification: 100% on the sample with grouped 5-fold cross-validation (baselines: declared type 98.3%, simple keyword rule 84.3%); 296/296 agreement with the mock doc_type on the evaluation set; the prompt-injection document D3000486 is classified OTHER.
* Field extraction: 100% exact match on 768 truth fields (clean and poor scans), regex-only v1 97.8%, mock service 96.4%. Vocabulary is in-sample for the sample set; on the evaluation set every difference to the mock output was manually confirmed to be a mock misread.
* Calibration: 767/767 fields accepted at ≥ 0.80 are correct.
* Decisions: with AI extraction the 60 sample decisions equal the decisions a perfect extraction (truth file) produces.
* Speed: ≈ 20 ms per document.

## Limitations

* Tuned to the data-pack templates; new layouts need new labels/patterns and retraining.
* The name/address vocabulary is small; an unknown name with a single OCR error is kept as read (and flagged with lower confidence only when it contains suspicious characters).
* No image OCR (bonus not implemented).

## Responsible AI

| Area | Measure |
|---|---|
| Human oversight | AI output feeds the rules; every REVIEW and HIGH-risk approval needs a maker and a different checker; officers can override any field (confidence 1.00, source OFFICER, audited) |
| Uncertain output | Fields < 0.80 are not used by identity rules and send the case to REVIEW (R3) – a misread cannot cause an automatic rejection |
| Fallback | AI unavailable or > 10 s → OTHER/0.00 → REVIEW (LOW_EXTRACTION_CONFIDENCE); the mock provider can be switched on at runtime; officers can enter fields manually |
| Prompt injection | Document text is data: guardrail classifier, JSON field passed to the service, output schema-validated in Node; the summary prompt wraps data in `<case_data>` delimiters and validates the response (≤ 80 words, no decision words, every number must appear in the input) |
| Privacy | Synthetic data only; only the last 4 Aadhaar digits exist anywhere; document text and prompts are not logged; extraction logs contain doc_id, type and counts only |
| Fairness | One name normalisation for everyone (titles removed, token order ignored); NAME_MISMATCH_MINOR share by gender is reported in the evaluation report |
| Governance | Extractor, pattern, classifier, lexicon and prompt versions are recorded with each extraction/summary; the model is retrained reproducibly by `python scripts/train.py` (also at Docker build) |
| Feedback | Officer corrections are stored as labelled feedback (`extraction_feedback`), shown with the correction rate on the dashboard |
