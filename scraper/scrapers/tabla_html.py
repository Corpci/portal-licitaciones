"""
scrapers/tabla_html.py — Scraper for portals that present procurement data
in a standard HTML <table> with optional pagination.
"""

import re
import unicodedata
import logging
from typing import Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from base import BaseScraper, empty_record
from utils.http import fetch
from utils.dates import parse_date, format_date

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Keyword → schema-field mapping table
# ---------------------------------------------------------------------------
# Each entry is (required_keywords, optional_keywords, schema_field).
# All required keywords must appear in the normalised header;
# at least one optional keyword must appear when the list is non-empty.

_HEADER_RULES = [
    # (required, optional, field)
    (["tipo", "procedimiento"], [], "tipo_procedimiento"),
    (["fecha", "publicacion"], [], "fecha_publicacion"),
    (["fecha", "apertura"], [], "fecha_apertura"),
    (["fecha", "junta"], [], "fecha_junta_aclaraciones"),
    (["fecha"], ["limite", "bases", "compra"], "fecha_limite_compra_bases"),
    (["fecha", "visita"], [], "fecha_visita"),
    (["tipo", "contrato"], [], "tipo_contrato"),
    (["numero"], ["procedimiento", "expediente", "licitacion", "no"], "numero_procedimiento"),
    (["expediente"], [], "numero_procedimiento"),
    (["objeto"], [], "objeto"),
    (["descripcion"], [], "objeto"),
    (["concepto"], [], "objeto"),
    (["licitacion"], [], "objeto"),
    (["estatus"], [], "estatus"),
    (["status"], [], "estatus"),
    (["estado", "proc"], [], "estatus"),
    (["convocante"], [], "ente_convocante"),
    (["dependencia"], [], "ente_convocante"),
    (["institucion"], [], "ente_convocante"),
    (["ente"], [], "ente_convocante"),
]

# PDF classification keywords
_PDF_KEYWORDS = {
    "url_bases_pdf": ["bases", "base"],
    "url_convocatoria_pdf": ["convocatoria", "conv"],
    "url_acta_apertura_pdf": ["apertura", "acta"],
    "url_fallo_pdf": ["fallo", "resolucion"],
}


def _strip_accents(text: str) -> str:
    """Remove diacritics from *text* and return the ASCII equivalent."""
    nkfd = unicodedata.normalize("NFKD", text)
    return nkfd.encode("ascii", "ignore").decode("ascii")


def _normalise_header(text: str) -> str:
    """Lower-case, strip accents and non-alpha characters from *text*."""
    return re.sub(r"[^a-z0-9 ]", " ", _strip_accents(text.lower()))


class TablaHTMLScraper(BaseScraper):
    """
    Scrapes procurement data from HTML ``<table>`` elements.

    Algorithm:
    1. Fetch the source URL.
    2. Parse with BeautifulSoup/lxml.
    3. Identify the table with the most data rows.
    4. Build a column map from the header row.
    5. Extract each data row into a :func:`~base.empty_record` dict.
    6. Optionally follow the ``url_detalle_procedimiento`` to enrich records.
    7. Follow pagination links up to 50 pages.
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
                self.logger.warning("Failed to fetch %s — stopping pagination.", current_url)
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
        """Extract all records from a single parsed HTML page."""
        table = self._pick_best_table(soup)
        if table is None:
            self.logger.debug("No table found on %s", page_url)
            return []

        headers, col_map = self._build_column_map(table)
        if not col_map:
            self.logger.debug("Could not build column map for table on %s", page_url)
            return []

        records = []
        rows = table.find_all("tr")
        # Skip header row(s)
        data_rows = [r for r in rows if not r.find("th")]
        if not data_rows:
            # Some tables use <th> only in the first row, rest are <td>
            data_rows = rows[1:]

        for row in data_rows:
            cells = row.find_all(["td", "th"])
            if not cells:
                continue
            record = empty_record()
            record["fuente_url"] = self.source.get("url")
            record["estado"] = self.source.get("estado")
            record["ente_convocante"] = self.source.get("nombre")
            record["tipo_ente"] = self.source.get("tipo_ente")

            for col_idx, field_name in col_map.items():
                if col_idx < len(cells):
                    cell = cells[col_idx]
                    value = cell.get_text(separator=" ", strip=True)
                    if value:
                        # For date fields, parse and normalise
                        if field_name.startswith("fecha_"):
                            parsed = parse_date(value)
                            record[field_name] = format_date(parsed) if parsed else value
                        else:
                            record[field_name] = value

                    # Also check for anchor links in cells
                    anchor = cell.find("a", href=True)
                    if anchor:
                        href = anchor["href"]
                        full_url = urljoin(page_url, href)
                        if href.lower().endswith(".pdf"):
                            self._classify_pdf(full_url, anchor.get_text(strip=True), record)
                        elif not record.get("url_detalle_procedimiento"):
                            record["url_detalle_procedimiento"] = full_url

            # Enrich from detail page if we have a link
            if record.get("url_detalle_procedimiento"):
                detail = self._fetch_detail(record["url_detalle_procedimiento"])
                for field, val in detail.items():
                    if val and not record.get(field):
                        record[field] = val

            records.append(self._normalize_record(record))

        return records

    # ------------------------------------------------------------------
    # Table selection
    # ------------------------------------------------------------------

    def _pick_best_table(self, soup: BeautifulSoup) -> Optional[object]:
        """Return the ``<table>`` element with the most ``<tr>`` children."""
        tables = soup.find_all("table")
        if not tables:
            return None
        return max(tables, key=lambda t: len(t.find_all("tr")))

    # ------------------------------------------------------------------
    # Header → column map
    # ------------------------------------------------------------------

    def _build_column_map(self, table) -> tuple[list[str], dict[int, str]]:
        """
        Return ``(headers, col_map)`` where *col_map* maps column index →
        schema field name.
        """
        header_row = table.find("tr")
        if header_row is None:
            return [], {}

        th_cells = header_row.find_all("th")
        if not th_cells:
            th_cells = header_row.find_all("td")

        headers = [cell.get_text(separator=" ", strip=True) for cell in th_cells]
        col_map: dict[int, str] = {}

        for idx, raw_header in enumerate(headers):
            field = self._map_header(raw_header)
            if field:
                col_map[idx] = field

        return headers, col_map

    def _map_header(self, header: str) -> Optional[str]:
        """
        Map a raw column header string to a schema field name.

        Uses accent-stripped, lower-cased keyword matching.
        Returns ``None`` if no rule matches.
        """
        norm = _normalise_header(header)
        tokens = set(norm.split())

        for required, optional, field in _HEADER_RULES:
            if all(kw in norm for kw in required):
                if not optional or any(kw in norm for kw in optional):
                    return field

        return None

    # ------------------------------------------------------------------
    # PDF classification
    # ------------------------------------------------------------------

    def _classify_pdf(self, url: str, link_text: str, record: dict) -> None:
        """
        Assign *url* to the appropriate PDF field in *record* based on the URL
        path and link text.
        """
        combined = (_strip_accents(url.lower()) + " " + _strip_accents(link_text.lower()))
        for field, keywords in _PDF_KEYWORDS.items():
            if any(kw in combined for kw in keywords):
                if not record.get(field):
                    record[field] = url
                return
        # Default: if no field claimed, treat as convocatoria if empty
        if not record.get("url_convocatoria_pdf"):
            record["url_convocatoria_pdf"] = url

    # ------------------------------------------------------------------
    # Detail page enrichment
    # ------------------------------------------------------------------

    def _fetch_detail(self, url: str) -> dict:
        """
        Fetch a detail page and extract additional dates and PDF links.

        This method is *tolerant*: on any failure it returns an empty dict
        so the caller can continue with the partial record.
        """
        extra: dict = {}
        try:
            response = fetch(self.session, url, timeout=15)
            if response is None:
                return extra

            soup = BeautifulSoup(response.text, "lxml")

            # Extract dates from all visible text nodes
            for tag in soup.find_all(string=True):
                text = tag.strip()
                if not text:
                    continue
                parsed = parse_date(text)
                if not parsed:
                    continue

                # Try to infer which date field by context
                parent_text = tag.parent.get_text(separator=" ", strip=True).lower() if tag.parent else ""
                parent_norm = _strip_accents(parent_text)

                if "publicacion" in parent_norm and not extra.get("fecha_publicacion"):
                    extra["fecha_publicacion"] = format_date(parsed)
                elif ("apertura" in parent_norm or "acto" in parent_norm) and not extra.get("fecha_apertura"):
                    extra["fecha_apertura"] = format_date(parsed)
                elif ("junta" in parent_norm or "aclaracion" in parent_norm) and not extra.get("fecha_junta_aclaraciones"):
                    extra["fecha_junta_aclaraciones"] = format_date(parsed)
                elif ("limite" in parent_norm or "bases" in parent_norm) and not extra.get("fecha_limite_compra_bases"):
                    extra["fecha_limite_compra_bases"] = format_date(parsed)
                elif "visita" in parent_norm and not extra.get("fecha_visita"):
                    extra["fecha_visita"] = format_date(parsed)

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

        except Exception as exc:  # noqa: BLE001
            self.logger.warning("Error fetching detail page %s: %s", url, exc)

        return extra

    # ------------------------------------------------------------------
    # Pagination
    # ------------------------------------------------------------------

    def _find_next_page(self, soup: BeautifulSoup, current_url: str) -> Optional[str]:
        """
        Look for a next-page link.  Strategies tried in order:
        1. ``<a rel="next">``
        2. ``<a>`` whose visible text matches "Siguiente", "Next", ">", "›"
        3. ``<a>`` inside a pagination container (class includes "pag")
        """
        # Strategy 1: rel="next"
        rel_next = soup.find("a", rel=lambda r: r and "next" in r)
        if rel_next and rel_next.get("href"):
            return urljoin(current_url, rel_next["href"])

        # Strategy 2: text-based next link
        next_texts = re.compile(r"^\s*(siguiente|next|>|›|>>)\s*$", re.IGNORECASE)
        for anchor in soup.find_all("a", href=True):
            if next_texts.match(anchor.get_text(strip=True)):
                return urljoin(current_url, anchor["href"])

        # Strategy 3: pagination container
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
