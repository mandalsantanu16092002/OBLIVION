"""Model governance: every extraction records these versions so results can be reproduced."""

EXTRACTOR_VERSION = "onboardiq-ai-extractor/1.0.0"
RULES_PATTERN_VERSION = "patterns-v1.3"          # regex + OCR-correction patterns (app/extractor.py)
CLASSIFIER_VERSION = "hybrid-kw+tfidf-lr-v1.0"    # weighted keywords + TF-IDF char n-gram logistic regression
LEXICON_VERSION = "lexicon-v1.0"                  # name / address vocabulary (scripts/train.py)
SUMMARY_PROMPT_VERSION = "reviewer-summary-v1.0"  # AI-5 prompt (app/summary.py)


def version_string() -> str:
    return f"{EXTRACTOR_VERSION};{RULES_PATTERN_VERSION};{CLASSIFIER_VERSION};{LEXICON_VERSION}"
