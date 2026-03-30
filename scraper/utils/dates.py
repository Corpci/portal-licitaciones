"""
utils/dates.py — Robust date parsing for Mexican government portal date strings.
"""

import re
import logging
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Spanish month name lookup
# ---------------------------------------------------------------------------

_SPANISH_MONTHS = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
    # Three-letter abbreviations (upper/lower handled by .lower())
    "ene": 1,
    "feb": 2,
    "mar": 3,
    "abr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dic": 12,
}

# ---------------------------------------------------------------------------
# Compiled patterns (ordered: most specific → least specific)
# ---------------------------------------------------------------------------

# DD/MM/YYYY  or  DD-MM-YYYY
_RE_DDMMYYYY = re.compile(
    r"\b(?P<day>\d{1,2})[/\-](?P<month>\d{1,2})[/\-](?P<year>\d{4})\b"
)

# YYYY-MM-DD  (ISO 8601)
_RE_YYYYMMDD = re.compile(
    r"\b(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})\b"
)

# DD de MONTH de YYYY  (full Spanish month name)
_RE_ES_LONG = re.compile(
    r"\b(?P<day>\d{1,2})\s+de\s+(?P<month>[a-záéíóúü]+)\s+de\s+(?P<year>\d{4})\b",
    re.IGNORECASE,
)

# DD/MMM/YYYY  (three-letter Spanish abbreviation, e.g. 15/ENE/2026)
_RE_DDMMMYYYY = re.compile(
    r"\b(?P<day>\d{1,2})[/\-](?P<month>[a-záéíóúü]{3})[/\-](?P<year>\d{4})\b",
    re.IGNORECASE,
)

# ISO 8601 with optional time  YYYY-MM-DDTHH:MM:SS
_RE_ISO8601 = re.compile(
    r"\b(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})(?:T[\d:]+)?\b"
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_date(text: str) -> Optional[date]:
    """
    Attempt to parse a date string using a series of known patterns.

    Patterns tried (in order):
    1. ``YYYY-MM-DD`` (ISO)
    2. ``YYYY-MM-DDTHH:MM:SS`` (ISO 8601 with time)
    3. ``DD/MMM/YYYY`` Spanish 3-letter month abbreviation
    4. ``DD de MONTH de YYYY`` full Spanish month name
    5. ``DD/MM/YYYY`` or ``DD-MM-YYYY``

    Returns a :class:`datetime.date` or ``None`` if no pattern matches or
    the values are out of range.
    """
    if not text:
        return None

    text = text.strip()

    # --- ISO 8601 / YYYY-MM-DD -------------------------------------------
    m = _RE_ISO8601.search(text)
    if m:
        d = _make_date(m.group("year"), m.group("month"), m.group("day"))
        if d:
            return d

    # --- DD/MMM/YYYY (Spanish 3-letter abbreviation) ---------------------
    m = _RE_DDMMMYYYY.search(text)
    if m:
        month_num = _SPANISH_MONTHS.get(m.group("month").lower())
        if month_num:
            d = _make_date(m.group("year"), month_num, m.group("day"))
            if d:
                return d

    # --- DD de MONTH de YYYY (full Spanish month name) -------------------
    m = _RE_ES_LONG.search(text)
    if m:
        month_num = _SPANISH_MONTHS.get(m.group("month").lower())
        if month_num:
            d = _make_date(m.group("year"), month_num, m.group("day"))
            if d:
                return d

    # --- DD/MM/YYYY or DD-MM-YYYY ----------------------------------------
    m = _RE_DDMMYYYY.search(text)
    if m:
        d = _make_date(m.group("year"), m.group("month"), m.group("day"))
        if d:
            return d

    logger.debug("Could not parse date from text: %r", text)
    return None


def format_date(d: date) -> str:
    """Return an ISO-8601 ``YYYY-MM-DD`` string for a :class:`datetime.date`."""
    return d.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _make_date(year, month, day) -> Optional[date]:
    """
    Safely construct a :class:`datetime.date` from string or int components.

    Returns ``None`` if the values are out of range or otherwise invalid.
    """
    try:
        return date(int(year), int(month), int(day))
    except (ValueError, TypeError):
        return None
