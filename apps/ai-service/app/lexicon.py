"""Vocabulary used for OCR post-correction of names and addresses.

Built by scripts/train.py from the *training* material only (sample truth file, sample applications,
existing-customer names) plus a small built-in gazetteer of Indian states, cities and common names.
Watchlist names are deliberately NOT part of the vocabulary so that correction can never pull a
name towards a sanctions or PEP entry.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

MODELS_DIR = os.environ.get("AI_MODELS_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "models"))
LEXICON_PATH = os.path.join(MODELS_DIR, "lexicon.json")

STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
    "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh",
    "Puducherry", "Chandigarh",
]
CITIES = [
    "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Ahmedabad", "Chennai", "Kolkata", "Pune", "Jaipur", "Lucknow",
    "Kanpur", "Nagpur", "Indore", "Thane", "Bhopal", "Visakhapatnam", "Patna", "Vadodara", "Ghaziabad",
    "Ludhiana", "Agra", "Nashik", "Kochi", "Coimbatore", "Madurai", "Surat", "Mysuru", "Chandigarh",
    "Guwahati", "Bhubaneswar", "Noida", "Gurugram", "Thiruvananthapuram", "Mangaluru", "Varanasi",
]
COMMON_NAMES = [
    # given names
    "Aarav", "Aditya", "Aisha", "Ajay", "Akash", "Amit", "Ananya", "Anil", "Anita", "Anjali", "Arjun", "Asha",
    "Deepak", "Deepika", "Divya", "Farhan", "Fatima", "Gaurav", "Gurpreet", "Imran", "Ishaan", "Joseph",
    "Karan", "Karthik", "Kavya", "Lakshmi", "Manoj", "Meera", "Mohan", "Neha", "Nikhil", "Nisha", "Pooja",
    "Prasad", "Priya", "Rahul", "Rajesh", "Rani", "Ravi", "Rekha", "Rohit", "Sanjay", "Shalini", "Sneha",
    "Suresh", "Swati", "Tanvi", "Varun", "Vikram", "Zoya", "Kumar", "Devi", "Lal", "Nath", "Chandra",
    "Sunita", "Vijay", "Pankaj", "Ramesh", "Harish", "Sachin", "Rakesh", "Seema", "Usha", "Geeta",
    # surnames
    "Sharma", "Verma", "Gupta", "Singh", "Kumar", "Patel", "Shah", "Mehta", "Joshi", "Iyer", "Nair", "Menon",
    "Pillai", "Reddy", "Rao", "Das", "Bose", "Banerjee", "Khan", "Shaikh", "Kulkarni", "Fernandes", "Agarwal",
    "Chatterjee", "Mukherjee", "Desai", "Naidu", "Yadav", "Mishra", "Pandey", "Tiwari", "Chauhan", "Malhotra",
]
ADDRESS_WORDS = ["Flat", "House", "Door", "No", "Road", "Street", "Lane", "Marg", "Nagar", "Society", "Towers",
                 "Apartments", "Residency", "Enclave", "Heights", "Niwas", "Grove", "Park", "Colony", "Sector"]


@dataclass
class Lexicon:
    name_tokens: set[str] = field(default_factory=set)
    buildings: set[str] = field(default_factory=set)
    streets: set[str] = field(default_factory=set)
    cities: set[str] = field(default_factory=set)
    states: set[str] = field(default_factory=set)

    def to_json(self) -> dict:
        return {k: sorted(v) for k, v in self.__dict__.items()}

    @classmethod
    def from_json(cls, d: dict) -> "Lexicon":
        return cls(**{k: set(v) for k, v in d.items() if k in cls.__dataclass_fields__})


def builtin_lexicon() -> Lexicon:
    lx = Lexicon()
    lx.name_tokens = {n.upper() for n in COMMON_NAMES}
    lx.cities = set(CITIES)
    lx.states = set(STATES)
    return lx


_cached: Lexicon | None = None


def load_lexicon() -> Lexicon:
    global _cached
    if _cached is None:
        lx = builtin_lexicon()
        if os.path.exists(LEXICON_PATH):
            with open(LEXICON_PATH, encoding="utf-8") as f:
                trained = Lexicon.from_json(json.load(f))
            lx.name_tokens |= trained.name_tokens
            lx.buildings |= trained.buildings
            lx.streets |= trained.streets
            lx.cities |= trained.cities
            lx.states |= trained.states
        _cached = lx
    return _cached


def reset_cache() -> None:
    global _cached
    _cached = None
