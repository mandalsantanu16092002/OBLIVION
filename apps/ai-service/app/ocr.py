"""OCR-error helpers: character confusion maps, noise cleaning and approximate (fuzzy) matching.

Typical recognition errors in the data pack: 0<->O, 1<->I/l/|, 5<->S, 8<->B, 2<->Z, rn<->m, c<->e,
o<->a, merged or split words and stray characters (~ " . , |).
"""
from __future__ import annotations

import re
from typing import Iterable

# Characters that an OCR engine may produce instead of a digit.
TO_DIGIT = {
    "O": "0", "o": "0", "D": "0", "Q": "0", "U": "0",
    "I": "1", "l": "1", "|": "1", "i": "1", "!": "1", "L": "1", "J": "1",
    "Z": "2", "z": "2",
    "S": "5", "s": "5",
    "B": "8",
    "G": "6", "b": "6",
    "T": "7",
    "A": "4",
    "g": "9", "q": "9",
    "E": "3",
}
# Characters that an OCR engine may produce instead of an upper-case letter.
TO_LETTER = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G", "4": "A", "7": "T", "3": "E", "|": "I", "9": "G"}

# Visually similar character pairs (substitution is "cheap" for these).
CONFUSABLE = {
    frozenset(p)
    for p in [
        ("O", "0"), ("O", "D"), ("O", "Q"), ("O", "C"), ("O", "A"), ("A", "O"),
        ("I", "1"), ("I", "L"), ("L", "1"), ("I", "J"), ("I", "T"),
        ("S", "5"), ("B", "8"), ("Z", "2"), ("G", "6"), ("G", "C"),
        ("E", "C"), ("E", "F"), ("U", "V"), ("N", "M"), ("H", "N"), ("R", "P"), ("K", "X"),
        ("A", "R"), ("P", "F"),
    ]
}

NOISE_LINE = re.compile(r"^[\s.~\"'|,:;_\-`^*]*$")
NOISE_CHARS = re.compile(r"[~\"|`^*_]")


def is_noise_line(line: str) -> bool:
    return bool(NOISE_LINE.match(line))


def meaningful_lines(text: str) -> list[str]:
    """Lines with OCR noise markers removed; purely-noise lines dropped."""
    out = []
    for raw in text.splitlines():
        line = NOISE_CHARS.sub(" ", raw)
        line = re.sub(r"(?:\s\.){2,}\s*$", " ", line)  # trailing ". ." noise
        line = re.sub(r"\s+", " ", line).strip(" .")
        if line and not is_noise_line(line):
            out.append(line)
    return out


def squash(s: str, letters_only: bool = True) -> str:
    """Upper-case, map digits that look like letters, drop everything else (spaces, punctuation)."""
    up = "".join(TO_LETTER.get(c, c) for c in s.upper()) if letters_only else s.upper()
    return re.sub(r"[^A-Z]", "", up) if letters_only else re.sub(r"[^A-Z0-9]", "", up)


def to_digits(s: str) -> tuple[str, int]:
    """Map OCR look-alikes to digits. Returns (digits, number_of_corrections)."""
    out, fixes = [], 0
    for c in s:
        if c.isdigit():
            out.append(c)
        elif c in TO_DIGIT:
            out.append(TO_DIGIT[c])
            fixes += 1
        else:
            out.append(c)
    return "".join(out), fixes


def to_letters(s: str) -> tuple[str, int]:
    out, fixes = [], 0
    for c in s:
        if c.isalpha():
            out.append(c.upper())
        elif c in TO_LETTER:
            out.append(TO_LETTER[c])
            fixes += 1
        else:
            out.append(c)
    return "".join(out), fixes


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def ocr_distance(a: str, b: str, sub_cost: float = 1.0, confusable_cost: float = 0.35, indel_cost: float = 1.0) -> float:
    """Weighted edit distance where visually confusable substitutions are cheap."""
    a, b = a.upper(), b.upper()
    n, m = len(a), len(b)
    prev = [j * indel_cost for j in range(m + 1)]
    for i in range(1, n + 1):
        cur = [i * indel_cost] + [0.0] * m
        for j in range(1, m + 1):
            if a[i - 1] == b[j - 1]:
                s = 0.0
            elif frozenset((a[i - 1], b[j - 1])) in CONFUSABLE:
                s = confusable_cost
            else:
                s = sub_cost
            cur[j] = min(prev[j] + indel_cost, cur[j - 1] + indel_cost, prev[j - 1] + s)
        prev = cur
    return prev[m]


def fuzzy_contains(haystack: str, needle: str, max_ratio: float = 0.2) -> float:
    """Approximate substring search (Sellers). Returns a score in [0,1]; 1 = exact occurrence.

    Both strings should already be squashed. Score = 1 - best_distance/len(needle), 0 if above max_ratio.
    """
    if not needle:
        return 0.0
    if needle in haystack:
        return 1.0
    m = len(needle)
    prev = [0.0] * (len(haystack) + 1)  # free start anywhere in haystack
    best = float(m)
    # dynamic programming over needle rows
    rows = [prev]
    for i in range(1, m + 1):
        cur = [float(i)] + [0.0] * len(haystack)
        for j in range(1, len(haystack) + 1):
            s = 0.0 if needle[i - 1] == haystack[j - 1] else (0.35 if frozenset((needle[i - 1], haystack[j - 1])) in CONFUSABLE else 1.0)
            cur[j] = min(rows[-1][j] + 1, cur[j - 1] + 1, rows[-1][j - 1] + s)
        rows.append(cur)
    best = min(rows[-1])
    ratio = best / m
    return max(0.0, 1.0 - ratio) if ratio <= max_ratio else 0.0


def clean_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def any_fuzzy(haystack_sq: str, needles: Iterable[str], max_ratio: float = 0.2) -> float:
    return max((fuzzy_contains(haystack_sq, n, max_ratio) for n in needles), default=0.0)
