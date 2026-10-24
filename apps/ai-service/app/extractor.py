"""Field extraction from OCR text with OCR-error correction, normalisation and confidence scoring.

Output values are normalised: dates YYYY-MM-DD, PAN upper case, pincode 6 digits, Aadhaar last 4 digits
only, gender M/F, names and addresses with OCR noise removed. Every field carries a confidence in [0, 1]
that is lowered whenever a correction or a fallback heuristic was needed. With ``ocr_correction=False``
the module behaves like the regex-only first version (used as a baseline in the evaluation report).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from .lexicon import Lexicon, load_lexicon
from .ocr import TO_DIGIT, clean_spaces, levenshtein, ocr_distance, squash, to_digits

CLEAN_SPECIMEN = "SYNTHETIC SPECIMEN - NOT A VALID DOCUMENT"
CLEAN_FOOTER = "Hackathon synthetic data - fictional person and issuer - for software testing only"

MONTHS = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}

FIELDS_BY_TYPE = {
    "PAN_CARD": ["name", "dob", "pan_number"],
    "AADHAAR_CARD": ["name", "dob", "gender", "aadhaar_last4", "address", "pincode"],
    "ELECTRICITY_BILL": ["name", "address", "pincode", "document_date"],
    "BANK_STATEMENT": ["name", "address", "pincode", "document_date"],
    "DRIVING_LICENCE": ["name", "dob", "address", "pincode", "valid_until"],
    "OTHER": [],
}


@dataclass
class Field:
    value: str
    confidence: float
    corrected: bool = False
    span: tuple[int, int] | None = None
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "value": self.value,
            "confidence": round(max(0.0, min(1.0, self.confidence)), 2),
            "corrected": self.corrected,
            "span": list(self.span) if self.span else None,
            "notes": self.notes,
        }


@dataclass
class Line:
    text: str  # cleaned
    raw: str
    start: int
    end: int


def is_poor_scan(text: str) -> bool:
    """A document is treated as a poor scan when the fixed specimen / footer lines are not intact."""
    return CLEAN_SPECIMEN not in text or CLEAN_FOOTER not in text


def split_lines(text: str) -> list[Line]:
    out, pos = [], 0
    for raw in text.splitlines(keepends=True):
        start, end = pos, pos + len(raw.rstrip("\r\n"))
        pos += len(raw)
        cleaned = re.sub(r"[~\"|`^*_]", " ", raw.rstrip("\r\n"))
        cleaned = re.sub(r"(?:\s\.)+\s*$", " ", cleaned)
        cleaned = re.sub(r"^\s*(?:\.\s)+", " ", cleaned)
        cleaned = clean_spaces(cleaned).strip(" .")
        if cleaned and re.search(r"[A-Za-z0-9]", cleaned):
            out.append(Line(cleaned, raw.rstrip("\r\n"), start, end))
    return out


def is_boilerplate(line: str) -> bool:
    sq = squash(line)
    return any(k in sq for k in ("SYNTHETIC", "SPECIMEN", "HACKATHON", "NOTAVALID", "FICTIONAL")) or (
        ocr_distance(sq[:20], "SYNTHETICSPECIMEN"[:20]) <= 3 if len(sq) >= 14 else False
    )


# --------------------------------------------------------------------------------------------- dates
DATE_TOKEN = re.compile(
    r"(?<![0-9A-Za-z])([0-9OoIl|BZSGDQ]{1,2})\s?([/\-.])\s?([0-9OoIl|BZSGDQ]{1,2}|[A-Za-z0-9]{3})\s?[/\-.]\s?([0-9OoIl|BZSGDQ]{4})(?![0-9])"
)


def _month(tok: str) -> tuple[int | None, int]:
    t = tok.upper()
    if re.fullmatch(r"[0-9OoIl|BZSGDQ]{1,2}", tok):
        d, fixes = to_digits(tok)
        return (int(d) if d.isdigit() else None), fixes
    t2 = "".join({"0": "O", "1": "I", "5": "S", "8": "B"}.get(c, c) for c in t)
    if t2 in MONTHS:
        return MONTHS[t2], int(t2 != t)
    best = min(MONTHS, key=lambda m: ocr_distance(t2, m))
    if ocr_distance(t2, best) <= 1.0:
        return MONTHS[best], 1
    return None, 0


def find_dates(text: str, offset: int = 0, correct: bool = True) -> list[tuple[str, int, int, int]]:
    """Return [(iso_date, corrections, start, end)] for every parseable date in ``text``."""
    out = []
    pattern = DATE_TOKEN if correct else re.compile(r"(?<!\d)(\d{2})([/\-])(\d{2}|[A-Za-z]{3})[/\-](\d{4})(?!\d)")
    for m in pattern.finditer(text):
        dd, df = to_digits(m.group(1)) if correct else (m.group(1), 0)
        mm, mf = _month(m.group(3)) if correct else ((int(m.group(3)) if m.group(3).isdigit() else MONTHS.get(m.group(3).upper())), 0)
        yy, yf = to_digits(m.group(4)) if correct else (m.group(4), 0)
        if not (dd.isdigit() and yy.isdigit() and mm):
            continue
        try:
            d = date(int(yy), int(mm), int(dd))
        except ValueError:
            continue
        out.append((d.isoformat(), df + mf + yf, offset + m.start(), offset + m.end()))
    return out


# --------------------------------------------------------------------------------------------- PAN
PAN_CANDIDATE = re.compile(r"(?<![A-Za-z0-9])([A-Za-z0-9|]{10})(?![A-Za-z0-9])")


def fix_pan(tok: str) -> tuple[str | None, int]:
    """Positional correction: letters at 1-5 and 10, digits at 6-9."""
    if len(tok) != 10:
        return None, 0
    out, fixes = [], 0
    for i, c in enumerate(tok):
        want_digit = 5 <= i <= 8
        cu = c.upper()
        if want_digit:
            if c.isdigit():
                out.append(c)
            elif c in TO_DIGIT:
                out.append(TO_DIGIT[c])
                fixes += 1
            else:
                return None, 0
        else:
            if cu.isalpha() and c.isupper():
                out.append(cu)
            elif c in "0125864|7":
                out.append({"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G", "4": "A", "|": "I", "7": "T"}[c])
                fixes += 1
            else:
                return None, 0
    return "".join(out), fixes


def extract_pan(text: str, correct: bool) -> Field | None:
    best: Field | None = None
    for m in PAN_CANDIDATE.finditer(text):
        tok = m.group(1)
        if not correct:
            if re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", tok):
                return Field(tok, 0.95, span=(m.start(1), m.end(1)))
            continue
        raw_digits = sum(c.isdigit() for c in tok[5:9])
        if raw_digits < 2:
            continue
        fixed, fixes = fix_pan(tok)
        if not fixed:
            continue
        conf = {0: 0.97, 1: 0.88, 2: 0.82}.get(fixes, 0.65)
        cand = Field(fixed, conf, corrected=fixes > 0, span=(m.start(1), m.end(1)),
                     notes=[f"{fixes} OCR correction(s) {tok} -> {fixed}"] if fixes else [])
        if best is None or cand.confidence > best.confidence:
            best = cand
    return best


# --------------------------------------------------------------------------------------------- names
def _best_lexicon_match(token: str, vocab: set[str]) -> tuple[str | None, float, float]:
    """Substitution-only OCR-weighted match against the vocabulary: returns (word, cost, margin)."""
    best, best_cost, second = None, 99.0, 99.0
    for w in vocab:
        if abs(len(w) - len(token)) > 0:
            continue
        c = ocr_distance(token, w, indel_cost=3.0)
        if c < best_cost:
            best, second, best_cost = w, best_cost, c
        elif c < second:
            second = c
    return best, best_cost, second - best_cost


def correct_name(raw: str, lx: Lexicon, correct: bool = True) -> tuple[str, float, list[str]]:
    """Return (name, confidence_cap, notes). confidence_cap is the max confidence the name deserves."""
    notes: list[str] = []
    s = re.sub(r"[^A-Za-z0-9 .'\-]", " ", raw)
    s = clean_spaces(s.replace(".", " ")).strip(" -'")
    if not correct:
        return s.title(), 0.95, notes
    vocab = lx.name_tokens
    tokens = [t for t in s.split(" ") if t]
    out: list[str] = []
    cap = 1.0
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if "-" in tok.strip("-"):
            # hyphenated surname (e.g. Okonkwo-Lee): correct each part, keep the hyphen
            parts = [correct_name(p, lx, correct) for p in tok.split("-") if p]
            out.append("-".join(p[0].upper() for p in parts))
            for _, pcap, pnotes in parts:
                cap = min(cap, pcap)
                notes.extend(pnotes)
            i += 1
            continue
        up = re.sub(r"[^A-Za-z0-9]", "", tok).upper()
        letters = "".join({"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G", "4": "A"}.get(c, c) for c in up)
        letters = re.sub(r"[^A-Z]", "", letters)
        if letters != up:
            notes.append(f"digit->letter in '{tok}'")
            cap = min(cap, 0.88)
        if not letters:
            i += 1
            continue
        if letters in vocab or len(letters) <= 2:
            out.append(letters)
            i += 1
            continue
        # split token joined with the next one ("Koc hi" style): join if the join is a known word
        if i + 1 < len(tokens):
            joined = letters + re.sub(r"[^A-Z]", "", tokens[i + 1].upper())
            if joined in vocab:
                out.append(joined)
                notes.append(f"joined '{tok} {tokens[i + 1]}'")
                cap = min(cap, 0.88)
                i += 2
                continue
        # merged tokens ("RAVIPRASAD")
        split_done = False
        if len(letters) >= 6:
            for k in range(2, len(letters) - 1):
                a, b = letters[:k], letters[k:]
                if a in vocab and b in vocab:
                    out.extend([a, b])
                    notes.append(f"split '{letters}' -> '{a} {b}'")
                    cap = min(cap, 0.88)
                    split_done = True
                    break
        if split_done:
            i += 1
            continue
        variants = {letters: 0.0}
        if "RN" in letters:
            variants[letters.replace("RN", "M")] = 0.3
        if "M" in letters:
            variants[letters.replace("M", "RN")] = 0.3
        best_word, best_cost, margin = None, 99.0, 0.0
        for v, extra in variants.items():
            w, c, mg = _best_lexicon_match(v, vocab)
            if w and c + extra < best_cost:
                best_word, best_cost, margin = w, c + extra, mg
        if best_word and best_cost <= 0.75 and margin > 0.05:
            out.append(best_word)
            notes.append(f"'{tok}' -> '{best_word}' (OCR look-alike)")
            cap = min(cap, 0.86)
        elif best_word and best_cost <= 1.0 and margin > 0.3 and len(letters) >= 4:
            out.append(best_word)
            notes.append(f"'{tok}' -> '{best_word}' (1 substitution)")
            cap = min(cap, 0.74)
        else:
            out.append(letters)
            if letters != up:
                cap = min(cap, 0.7)
        i += 1
    name = " ".join("-".join(p.capitalize() for p in w.split("-")) if len(w) > 1 else w for w in out)
    return name, cap, notes


# --------------------------------------------------------------------------------------------- addresses
HOUSE_PREFIXES = [("FLAT", "Flat"), ("HOUSENO", "House No."), ("DOORNO", "Door No.")]


def _seg_match(seg: str, vocab: set[str], min_sim: float = 0.72) -> tuple[str | None, float]:
    s = squash(seg)
    if not s:
        return None, 0.0
    best, best_sim = None, 0.0
    for w in vocab:
        ws = squash(w)
        d = ocr_distance(s, ws)
        sim = 1 - d / max(len(s), len(ws))
        if sim > best_sim:
            best, best_sim = w, sim
    return (best, best_sim) if best_sim >= min_sim else (None, best_sim)


def _house(seg: str) -> tuple[str | None, bool]:
    m = re.match(r"^\s*(.*?)\s*([0-9OIlZSB|]{1,4}[A-Za-z]?)\s*$", seg)
    if not m:
        return None, False
    prefix_sq, num_raw = squash(m.group(1)), m.group(2)
    label = None
    for key, nice in HOUSE_PREFIXES:
        if prefix_sq == key or (prefix_sq and ocr_distance(prefix_sq, key) <= 1.0):
            label = nice
            break
    if not label:
        return None, False
    num, fixes = to_digits(num_raw)
    if not num.isdigit():
        return None, False
    return f"{label} {num}", fixes > 0 or squash(m.group(1)) not in [k for k, _ in HOUSE_PREFIXES]


def correct_address(raw: str, lx: Lexicon, correct: bool = True) -> tuple[str, float, list[str]]:
    notes: list[str] = []
    s = re.sub(r"[~\"|`^*_]", " ", raw)
    s = clean_spaces(s).strip(" ,.-")
    if not correct:
        return s, 0.95, notes
    s = re.sub(r"\s*,\s*", ", ", s)
    s = re.sub(r"(,\s*)+", ", ", s)
    segs = [x.strip(" .") for x in s.split(",") if x.strip(" .")]
    if not segs:
        return s, 0.3, ["empty address"]
    cap = 0.97
    out: list[str] = []
    house, fixed = _house(segs[0])
    if house:
        out.append(house)
        if fixed or house != segs[0]:
            notes.append(f"house '{segs[0]}' -> '{house}'")
            cap = min(cap, 0.9)
        rest = segs[1:]
    else:
        rest = segs
    vocabs = [lx.buildings, lx.streets, lx.cities, lx.states]
    all_vocab = lx.buildings | lx.streets | lx.cities | lx.states
    # merge segments split by a stray comma ("Uttar, Pradesh") when the join is a known value
    merged: list[str] = []
    k = 0
    while k < len(rest):
        if k + 1 < len(rest) and len(rest) > 4:
            joined = f"{rest[k]} {rest[k + 1]}"
            w_join, s_join = _seg_match(joined, all_vocab, 0.85)
            w_one, s_one = _seg_match(rest[k], all_vocab, 0.85)
            if w_join and s_join > s_one:
                merged.append(joined)
                notes.append(f"merged '{rest[k]}, {rest[k + 1]}'")
                k += 2
                continue
        merged.append(rest[k])
        k += 1
    rest = merged
    # positional expectation: building, street, city, state (last segment is the state)
    expected = vocabs[-len(rest):] if len(rest) <= 4 else [lx.buildings | lx.streets] * (len(rest) - 2) + vocabs[2:]
    for seg, vocab in zip(rest, expected):
        word, sim = _seg_match(seg, vocab)
        if word is None:
            word, sim = _seg_match(seg, lx.buildings | lx.streets | lx.cities | lx.states, 0.8)
        if word is not None:
            if word != seg:
                notes.append(f"'{seg}' -> '{word}' ({sim:.2f})")
                cap = min(cap, 0.9 if sim >= 0.85 else 0.82)
            out.append(word)
        else:
            cleaned = clean_spaces(re.sub(r"[^A-Za-z0-9 .\-]", " ", seg))
            out.append(cleaned)
            if cleaned != seg or not re.fullmatch(r"[A-Za-z .\-]+", cleaned):
                cap = min(cap, 0.65)
            else:
                cap = min(cap, 0.85)
    return ", ".join(out), cap, notes


# --------------------------------------------------------------------------------------------- helpers
def _find_label_line(lines: list[Line], label: str, exclude: tuple[str, ...] = (), max_ratio: float = 0.3) -> int | None:
    target = squash(label)
    for i, ln in enumerate(lines):
        sq = squash(ln.text)
        if any(x in sq for x in exclude):
            continue
        if target in sq:
            return i
        # fuzzy on line prefix
        for k in range(len(target) - 1, len(target) + 2):
            if k <= len(sq) and ocr_distance(sq[:k], target) <= max(1.0, max_ratio * len(target)):
                return i
    return None


def _after_label(line: str, label_regex: str) -> str | None:
    m = re.search(label_regex, line, flags=re.I)
    if not m:
        return None
    rest = line[m.end():].strip(" :.-")
    return rest or None


PIN_RE = re.compile(r"P[\s.,]?[I1l|][\s.,]?N\s*[:.]?\s*([0-9OoIlZSB|]{6})(?![0-9])")
DASH_PIN_RE = re.compile(r"[-–][\s~\"'.|]*([0-9OoIlZSB|]{6})(?![0-9A-Za-z])")
ADDRESS_LABEL = re.compile(r"A[,.]?d[,.]?d[,.]?r[,.]?[a-z][,.]?[s5][,.]?[s5][,.]?\s*[:;]", re.I)


def _pincode(raw: str, start: int, correct: bool) -> Field | None:
    digits, fixes = to_digits(raw) if correct else (raw, 0)
    if not re.fullmatch(r"[1-9][0-9]{5}", digits):
        return None
    conf = {0: 0.96, 1: 0.88, 2: 0.82}.get(fixes, 0.65)
    return Field(digits, conf, corrected=fixes > 0, span=(start, start + len(raw)),
                 notes=[f"OCR digits {raw} -> {digits}"] if fixes else [])


# --------------------------------------------------------------------------------------------- per type
def extract_fields(text: str, doc_type: str, *, ocr_correction: bool = True, lexicon: Lexicon | None = None) -> dict[str, Field]:
    lx = lexicon or load_lexicon()
    lines = split_lines(text)
    poor = is_poor_scan(text)
    base = 0.93 if poor else 0.97
    out: dict[str, Field] = {}
    c = ocr_correction

    def set_name(raw: str | None, start: int | None, penalty: float = 0.0):
        if not raw:
            return
        name, cap, notes = correct_name(raw, lx, c)
        if not name:
            return
        span = None
        if start is not None:
            idx = text.find(raw.strip(), start)
            span = (idx, idx + len(raw.strip())) if idx >= 0 else None
        out["name"] = Field(name, min(base - penalty, cap), corrected=bool(notes), span=span, notes=notes)

    def set_address(raw: str | None, start: int | None, end: int | None = None):
        if not raw:
            return
        addr, cap, notes = correct_address(raw, lx, c)
        if addr:
            out["address"] = Field(addr, min(base, cap), corrected=bool(notes),
                                   span=(start, end) if start is not None and end is not None else None, notes=notes)

    def set_date(key: str, region: str, offset: int, pick: str = "first"):
        ds = find_dates(region, offset, c)
        if not ds:
            return
        iso, fixes, s, e = ds[0] if pick == "first" else ds[-1]
        conf = {0: base, 1: 0.88, 2: 0.83}.get(fixes, 0.7)
        out[key] = Field(iso, conf, corrected=fixes > 0, span=(s, e), notes=[f"{fixes} OCR digit correction(s)"] if fixes else [])

    if doc_type == "PAN_CARD":
        f = extract_pan(text, c)
        if f:
            f.confidence = min(f.confidence, base if not f.corrected else f.confidence)
            out["pan_number"] = f
        # name: line after the "Name" label (not "Father's Name")
        idx = None
        for i, ln in enumerate(lines):
            sq = squash(ln.text)
            if "FATHER" in sq or ocr_distance(sq[:6], "FATHER") <= 1.5:
                continue
            words = [squash(w).replace("RN", "M") for w in ln.text.split()]
            hit = next((k for k, w in enumerate(words) if w and ocr_distance(w, "NAME") <= 1.0), None)
            if hit is not None and "ACCOUNT" not in sq:
                idx, label_word = i, hit
                break
        if idx is not None:
            # rest of the line after the label, else next line
            after = " ".join(lines[idx].text.split()[label_word + 1:]).strip(" :|")
            if after and len(squash(after)) >= 3:
                set_name(after, lines[idx].start)
            elif idx + 1 < len(lines):
                set_name(lines[idx + 1].text, lines[idx + 1].start)
        if "name" not in out:
            # fallback: first all-caps line that is not boilerplate / label
            for ln in lines:
                if ln.text.isupper() and not is_boilerplate(ln.text) and "INCOME" not in squash(ln.text) and not PAN_CANDIDATE.search(ln.text):
                    set_name(ln.text, ln.start, penalty=0.15)
                    break
        dob_i = _find_label_line(lines, "Date of Birth")
        region_start = lines[dob_i].start if dob_i is not None else 0
        set_date("dob", text[region_start:], region_start)

    elif doc_type == "AADHAAR_CARD":
        dob_i = None
        for i, ln in enumerate(lines):
            if find_dates(ln.text, 0, c) and (re.search(r"D\s?[O0o]\s?B", ln.text, re.I) or dob_i is None):
                dob_i = i
                break
        if dob_i is not None:
            set_date("dob", lines[dob_i].text, 0)
            ds = find_dates(text[lines[dob_i].start:], lines[dob_i].start, c)
            if ds and "dob" in out:
                out["dob"].span = (ds[0][2], ds[0][3])
            # name = nearest preceding meaningful non-boilerplate line
            for j in range(dob_i - 1, -1, -1):
                t = lines[j].text
                if not is_boilerplate(t) and "AADHAAR" not in squash(t) and "RESIDENT" not in squash(t):
                    set_name(t, lines[j].start)
                    break
                # name may share the line with the DOB label
            if "name" not in out:
                pre = re.split(r"D\s?[O0o]\s?B", lines[dob_i].text, flags=re.I)[0]
                if len(squash(pre)) >= 3:
                    set_name(pre, lines[dob_i].start)
        sq_text = squash(text)
        if "FEMALE" in sq_text or re.search(r"\bF\s?E\s?M\s?A\s?L\s?E\b", text, re.I):
            out["gender"] = Field("F", base)
        elif "MALE" in sq_text:
            out["gender"] = Field("M", base)
        m = re.search(r"(?:X[\s.,]*){7,8}([0-9OoIlZSBG|]{4})(?![0-9])", text)
        if m:
            raw4 = m.group(1)
            d4, fixes = to_digits(raw4) if c else (raw4, 0)
            if re.fullmatch(r"[0-9]{4}", d4):
                out["aadhaar_last4"] = Field(d4, {0: base, 1: 0.88, 2: 0.83}.get(fixes, 0.7), corrected=fixes > 0,
                                             span=(m.start(1), m.end(1)), notes=[f"OCR digits {raw4} -> {d4}"] if fixes else [])
        am = ADDRESS_LABEL.search(text)
        if am:
            tail = text[am.end():]
            stop = DASH_PIN_RE.search(tail)
            seg = tail[: stop.start()] if stop else tail.split("XXXX")[0]
            set_address(seg.replace("\n", " "), am.end(), am.end() + len(seg))
            if stop:
                pf = _pincode(stop.group(1), am.end() + stop.start(1), c)
                if pf:
                    out["pincode"] = pf

    elif doc_type == "ELECTRICITY_BILL":
        for ln in lines:
            val = re.split(r"[:;]", ln.text, maxsplit=1)
            if len(val) > 1 and ocr_distance(squash(val[0]).replace("RN", "M"), "CONSUMERNAME") <= 2:
                set_name(val[1], ln.start)
                break
        bd = _find_label_line(lines, "Bill Date")
        if bd is not None:
            set_date("document_date", lines[bd].text, 0)
            ds = find_dates(text[lines[bd].start:], lines[bd].start, c)
            if ds and "document_date" in out:
                out["document_date"].span = (ds[0][2], ds[0][3])
        else:
            set_date("document_date", text, 0)
            if "document_date" in out:
                out["document_date"].confidence = min(out["document_date"].confidence, 0.75)
        am = ADDRESS_LABEL.search(text)
        if am:
            tail = text[am.end():]
            pm = PIN_RE.search(tail)
            seg = tail[: pm.start()] if pm else tail.splitlines()[0]
            set_address(seg.replace("\n", " "), am.end(), am.end() + len(seg))
            if pm:
                pf = _pincode(pm.group(1), am.end() + pm.start(1), c)
                if pf:
                    out["pincode"] = pf

    elif doc_type == "BANK_STATEMENT":
        spec_i = None
        for i, ln in enumerate(lines):
            if is_boilerplate(ln.text) and "SPECIMEN" in squash(ln.text) and "STATEMENT" not in squash(ln.text):
                spec_i = i
        pin_i = None
        for i, ln in enumerate(lines):
            if PIN_RE.search(ln.text):
                pin_i = i
                break
        start_i = (spec_i + 1) if spec_i is not None else 2
        if pin_i is not None and start_i < len(lines):
            block = lines[start_i:pin_i + 1]
            # first line = name (possibly merged with the address)
            first = block[0].text if block else ""
            mm = re.search(r"\b(Flat|House|Door|H[o0]use|Fl[a-z]t|D[o0]{2}r)\b", first, re.I)
            if mm and mm.start() > 0:
                name_raw, addr_first = first[: mm.start()], first[mm.start():]
            else:
                name_raw, addr_first = first, ""
            set_name(name_raw, block[0].start if block else None)
            addr_parts = ([addr_first] if addr_first else []) + [b.text for b in block[1:]]
            joined = " ".join(addr_parts)
            pm = PIN_RE.search(joined)
            addr_raw = joined[: pm.start()] if pm else joined
            set_address(addr_raw, block[1].start if len(block) > 1 else None, lines[pin_i].start)
            pmr = PIN_RE.search(text)
            if pmr:
                pf = _pincode(pmr.group(1), pmr.start(1), c)
                if pf:
                    out["pincode"] = pf
        sd = _find_label_line(lines, "Statement Date")
        if sd is not None:
            set_date("document_date", lines[sd].text, 0)
            ds = find_dates(text[lines[sd].start:], lines[sd].start, c)
            if ds and "document_date" in out:
                out["document_date"].span = (ds[0][2], ds[0][3])

    elif doc_type == "DRIVING_LICENCE":
        for ln in lines:
            m = re.match(r"^\s*N\s?[a-z0-9]{1,2}\s?[em]\s?e?\s*[:;]\s*(.+)$", ln.text, re.I)
            if m and len(squash(m.group(1))) >= 3:
                set_name(m.group(1), ln.start)
                break
        dates = []
        for ln in lines:
            for d in find_dates(ln.text, ln.start, c):
                sq = squash(ln.text)
                kind = "valid_until" if ("VALID" in sq or "TILL" in sq or ocr_distance(sq[:9], "VALIDTILL") <= 2) else (
                    "dob" if re.search(r"D\s?[O0o]\s?B", ln.text, re.I) else None)
                dates.append((kind, d))
        for kind, d in dates:
            iso, fixes, s, e = d
            if kind and kind not in out:
                out[kind] = Field(iso, {0: base, 1: 0.88, 2: 0.83}.get(fixes, 0.7), corrected=fixes > 0, span=(s, e))
        unl = [d for k, d in dates if k is None]
        if unl and ("dob" not in out or "valid_until" not in out):
            for iso, fixes, s, e in sorted(unl):
                key = "dob" if "dob" not in out else "valid_until"
                if key not in out:
                    out[key] = Field(iso, 0.75, corrected=True, span=(s, e), notes=["assigned by date order (label unreadable)"])
        am = ADDRESS_LABEL.search(text)
        if am:
            tail = text[am.end():]
            pm = PIN_RE.search(tail)
            seg = tail[: pm.start()] if pm else tail.splitlines()[0]
            set_address(seg.replace("\n", " "), am.end(), am.end() + len(seg))
            if pm:
                pf = _pincode(pm.group(1), am.end() + pm.start(1), c)
                if pf:
                    out["pincode"] = pf

    # keep only the fields defined for this document type
    allowed = set(FIELDS_BY_TYPE.get(doc_type, []))
    return {k: v for k, v in out.items() if k in allowed}


def name_tokens_distance(a: str, b: str) -> int:
    return levenshtein(a.upper(), b.upper())
