"""
scrapers/card_list.py — Scraper for portals that present procurement records
as a list of cards or article-like blocks rather than an HTML table.
"""

import re
import unicodedata
import logging
from typing import Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from base import BaseScraper, empty_record
from utils.http import fetch
from utils.dates import parse_date, format_date

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# CSS class fragments that suggest a card-like container
_CARD_CLASS_HINTS = [
    "card",
    "item",
    "licitacion",
    "result",
    "convocatoria",
    "procedimiento",
    "contratacion",
    "concurso",
    "oferta",
]

# Regex for detecting a procurement number pattern, e.g. "No. LA-006G00-002-2026"
_RE_PROC_NUMBER = re.compile(
    r"(?:no\.?\s*|#\s*|folio\s*|exp\.?\s*)([A-Z0-9][A-Z0-9\-/\.]{3,})",
    re.IGNORECASE,
)

# PDF classification keywords (mirrors tabla_html.py)
_PDF_KEYWORDS = {
    "url_bases_pdf": ["bases", "base"],
    "url_convocatoria_pdf": ["convocatoria", "conv"],
    "url_acta_apertura_pdf": ["apertura", "acta"],
    "url_fallo_pdf": ["fallo", "resolucion"],
}


def _strip_accents(text: str) -> str:
    nkfd = unicodedata.normalize("NFKD", text)
    return nkfd.encode("ascii", "ignore").decode("ascii")


def _has_date(text: str) -> bool:
    return parse_date(text) is not None


class CardListScraper(BaseScraper):
    """
    Scrapes procurement data from portals that render each record as a
    visual card, list item, or article block.

    Algorithm:
    1. Fetch source URL.
    2. Locate card containers via CSS-class heuristics.
    3. Extract fields from each card using text pattern matching.
    4. Follow detail links to fill remaining fields.
    5. Handle pagination up to 50 pages.
    """

    MAX_PAGES = 50

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def scrape(self) -> list[dict]:
        source_url: str = self.source["url"]
        records: list[dict] = []
        current_url: Optional[str] = source_url
        page = 0

        while current_url and page < self.MAX_PAGES:
            page += 1
            self.logger.info("Fetching page %d: %s", page, current_url)
            response = fetch(self.session, current_url)
            if response is None:
                self.logger.warning("Failed to fetch %s — stopping.", current_url)
                break

            soup = BeautifulSoup(response.text, "lxml")
            page_records = self._parse_page(soup, current_url)
            records.extend(page_records)

            next_url = self._find_next_page(soup, current_url)
            if next_url and next_url != current_url:
                current_url = next_url
            else:
                break

        self.logger.info(
            "Source '%s' — scraped %d records across %d page(s).",
            self.source.get("nombre", source_url),
            len(records),
            page,
        )
        return records

    # ------------------------------------------------------------------
    # Page-level parsing
    # ------------------------------------------------------------------

    def _parse_page(self, soup: BeautifulSoup, page_url: str) -> list[dict]:
        cards = self._find_cards(soup)
        if not cards:
            self.logger.debug(
                "No card containers found on %s — trying fallback.", page_url
            )
            cards = self._fallback_find_cards(soup)

        if not cards:
            self.logger.debug("No cards found on %s at all.", page_url)
            return []

        records = []
        for card in cards:
            record = self._parse_card(card, page_url)
            if record:
                # Enrich from detail page
                detail_url = record.get("url_detalle_procedimiento")
                if detail_url:
                    detail = self._fetch_detail(detail_url, page_url)
                    for field, val in detail.items():
                        if val and not record.get(field):
                            record[field] = val

                records.append(self._normalize_record(record))

        return records

    # ------------------------------------------------------------------
    # Card discovery
    # ------------------------------------------------------------------

    def _find_cards(self, soup: BeautifulSoup) -> list[Tag]:
        """
        Find card containers whose CSS classes match known hint words.
        Returns a deduplicated list of Tag objects.
        """
        found: list[Tag] = []
        seen_ids = set()

        for tag in soup.find_all(["div", "article", "section", "li"]):
            classes = " ".join(tag.get("class", [])).lower()
            if any(hint in classes for hint in _CARD_CLASS_HINTS):
                tag_id = id(tag)
                if tag_id not in seen_ids:
                    found.append(tag)
                    seen_ids.add(tag_id)

        # Remove containers that are parents of other found containers
        # (keep the leaf-most cards)
        leaf_cards = []
        for tag in found:
            is_parent = any(
                tag is not other and tag in list(other.parents)
                for other in found
            )
            if not is_parent:
                leaf_cards.append(tag)

        return leaf_cards

    def _fallback_find_cards(self, soup: BeautifulSoup) -> list[Tag]:
        """
        Fallback: find ``<li>`` or ``<div>`` elements that contain both a date
        pattern *and* an anchor link — a strong signal of a record card.
        """
        candidates = []
        for tag in soup.find_all(["li", "div"]):
            text = tag.get_text(separator=" ", strip=True)
            has_date = bool(parse_date(text))
            has_anchor = bool(tag.find("a", href=True))
            # Avoid huge containers
            child_count = len(list(tag.children))
            if has_date and has_anchor and child_count <= 30:
                candidates.append(tag)

        return candidates

    # ------------------------------------------------------------------
    # Card-level field extraction
    # ------------------------------------------------------------------

    def _parse_card(self, card: Tag, page_url: str) -> Optional[dict]:
        """Extract a single record dict from a card element."""
        record = empty_record()
        record["fuente_url"] = self.source.get("url")
        record["estado"] = self.source.get("estado")
        record["ente_convocante"] = self.source.get("nombre")
        record["tipo_ente"] = self.source.get("tipo_ente")

        full_text = card.get_text(separator="\n", strip=True)
        if not full_text:
            return None

        # --- objeto / title from bold/strong/h* elements ---------------
        for bold_tag in card.find_all(["strong", "b", "h1", "h2", "h3", "h4", "h5", "h6"]):
            text = bold_tag.get_text(strip=True)
            if text and len(text) > 8 and not _has_date(text):
                record["objeto"] = text
                break

        # --- numero_procedimiento --------------------------------------
        m = _RE_PROC_NUMBER.search(full_text)
        if m:
            record["numero_procedimiento"] = m.group(1).strip()

        # --- Dates — scan each line -----------------------------------
        date_fields_order = [
            ("publicacion", "fecha_publicacion"),
            ("apertura", "fecha_apertura"),
            ("junta", "fecha_junta_aclaraciones"),
            ("aclaracion", "fecha_junta_aclaraciones"),
            ("limite", "fecha_limite_compra_bases"),
            ("bases", "fecha_limite_compra_bases"),
            ("visita", "fecha_visita"),
        ]
        for line in full_text.splitlines():
            line_norm = _strip_accents(line.lower())
            d = parse_date(line)
            if not d:
                continue
            date_str = format_date(d)
            assigned = False
            for kw, field in date_fields_order:
                if kw in line_norm and not record.get(field):
                    record[field] = date_str
                    assigned = True
                    break
            # If we couldn't classify, store as fecha_publicacion if still empty
            if not assigned and not record.get("fecha_publicacion"):
                record["fecha_publicacion"] = date_str

        # --- Anchors ---------------------------------------------------
        for anchor in card.find_all("a", href=True):
            href = anchor["href"]
            link_text = anchor.get_text(strip=True)
            full_url = urljoin(page_url, href)

            if href.lower().endswith(".pdf"):
                self._classify_pdf(full_url, link_text, record)
            elif not record.get("url_detalle_procedimiento"):
                # Prefer anchors that look like detail links (contain 'detalle',
                # 'procedimiento', 'licitacion', 'ver', 'info' in text or URL)
                combined = _strip_accents((link_text + " " + href).lower())
                if any(kw in combined for kw in ["detalle", "procedimiento", "licitacion", "ver", "info", "ficha"]):
                    record["url_detalle_procedimiento"] = full_url
                else:
                    record["url_detalle_procedimiento"] = full_url

        # --- estatus from text -----------------------------------------
        status_re = re.compile(
            r"\b(vigente|activo|publicado|concluido|desierto|cancelado|en\s+proceso|adjudicado)\b",
            re.IGNORECASE,
        )
        m2 = status_re.search(full_text)
        if m2:
            record["estatus"] = m2.group(1).capitalize()

        # Discard empty cards (no usable content)
        has_content = any(
            record.get(f)
            for f in ["objeto", "numero_procedimiento", "fecha_publicacion", "fecha_apertura"]
        )
        if not has_content:
            return None

        return record

    # ------------------------------------------------------------------
    # PDF classification
    # ------------------------------------------------------------------

    def _classify_pdf(self, url: str, link_text: str, record: dict) -> None:
        combined = _strip_accents(url.lower() + " " + link_text.lower())
        for field, keywords in _PDF_KEYWORDS.items():
            if any(kw in combined for kw in keywords):
                if not record.get(field):
                    record[field] = url
                return
        if not record.get("url_convocatoria_pdf"):
            record["url_convocatoria_pdf"] = url

    # ------------------------------------------------------------------
    # Detail page enrichment
    # ------------------------------------------------------------------

    def _fetch_detail(self, url: str, base_url: str) -> dict:
        """
        Fetch a detail page and return a partial record dict with any
        additional fields found.  Returns an empty dict on failure.
        """
        extra: dict = {}
        try:
            response = fetch(self.session, url, timeout=15)
            if response is None:
                return extra

            soup = BeautifulSoup(response.text, "lxml")

            # Extract dates with context
            for tag in soup.find_all(string=True):
                text = tag.strip()
                if not text:
                    continue
                d = parse_date(text)
                if not d:
                    continue
                date_str = format_date(d)
                parent_norm = _strip_accents(
                    (tag.parent.get_text(separator=" ", strip=True) if tag.parent else "").lower()
                )
                if "publicacion" in parent_norm and not extra.get("fecha_publicacion"):
                    extra["fecha_publicacion"] = date_str
                elif ("apertura" in parent_norm or "acto" in parent_norm) and not extra.get("fecha_apertura"):
                    extra["fecha_apertura"] = date_str
                elif ("junta" in parent_norm or "aclaracion" in parent_norm) and not extra.get("fecha_junta_aclaraciones"):
                    extra["fecha_junta_aclaraciones"] = date_str
                elif ("limite" in parent_norm or "bases" in parent_norm) and not extra.get("fecha_limite_compra_bases"):
                    extra["fecha_limite_compra_bases"] = date_str
                elif "visita" in parent_norm and not extra.get("fecha_visita"):
                    extra["fecha_visita"] = date_str

            # Extract PDF links
            for anchor in soup.find_all("a", href=True):
                href = anchor["href"]
                if href.lower().endswith(".pdf"):
                    full_url = urljoin(url, href)
                    link_text = anchor.get_text(strip=True)
                    combined = _strip_accents(full_url.lower() + " " + link_text.lower())
                    for field, keywords in _PDF_KEYWORDS.items():
                        if any(kw in combined for kw in keywords):
                            if not extra.get(field):
                                extra[field] = full_url
                            break

            # objeto / title if not yet found
            for bold in soup.find_all(["h1", "h2", "strong", "b"]):
                text = bold.get_text(strip=True)
                if text and len(text) > 8 and not _has_date(text):
                    extra.setdefault("objeto", text)
                    break

        except Exception as exc:  # noqa: BLE001
            self.logger.warning("Error fetching detail page %s: %s", url, exc)

        return extra

    # ------------------------------------------------------------------
    # Pagination
    # ------------------------------------------------------------------

    def _find_next_page(self, soup: BeautifulSoup, current_url: str) -> Optional[str]:
        """Find the next-page link using rel, text, and pagination heuristics."""
        # rel="next"
        rel_next = soup.find("a", rel=lambda r: r and "next" in r)
        if rel_next and rel_next.get("href"):
            return urljoin(current_url, rel_next["href"])

        next_texts = re.compile(r"^\s*(siguiente|next|>|›|>>)\s*$", re.IGNORECASE)
        for anchor in soup.find_all("a", href=True):
            if next_texts.match(anchor.get_text(strip=True)):
                return urljoin(current_url, anchor["href"])

        pag_container = soup.find(
            lambda tag: tag.name in ("div", "nav", "ul")
            and tag.get("class")
            and any("pag" in cls.lower() for cls in tag.get("class", []))
        )
        if pag_container:
            for anchor in pag_container.find_all("a", href=True):
                if next_texts.match(anchor.get_text(strip=True)):
                    return urljoin(current_url, anchor["href"])

        return None
