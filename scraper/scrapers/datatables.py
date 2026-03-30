"""
scrapers/datatables.py — Scraper for portals powered by jQuery DataTables.

Attempts to:
1. Detect the AJAX endpoint configured in the page's DataTables initialisation.
2. Page through the JSON API directly (much faster than HTML parsing).
3. Fall back to HTML table parsing when no AJAX endpoint is found.
"""

import re
import json
import unicodedata
import logging
from typing import Optional
from urllib.parse import urljoin, urlparse, urlencode, parse_qs, urlunparse

from bs4 import BeautifulSoup

from base import BaseScraper, empty_record
from utils.http import fetch
from utils.dates import parse_date, format_date

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Regex patterns to find DataTables AJAX configuration inside <script> tags
# ---------------------------------------------------------------------------

_RE_AJAX_URL = re.compile(
    r'ajax\s*:\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_RE_AJAX_URL_OBJ = re.compile(
    r'ajax\s*:\s*\{[^}]*url\s*:\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_RE_SAJAX_SOURCE = re.compile(
    r'sAjaxSource\s*:\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)

# PDF classification keywords (mirrors other scrapers)
_PDF_KEYWORDS = {
    "url_bases_pdf": ["bases", "base"],
    "url_convocatoria_pdf": ["convocatoria", "conv"],
    "url_acta_apertura_pdf": ["apertura", "acta"],
    "url_fallo_pdf": ["fallo", "resolucion"],
}

# Header → schema field rules (same logic as TablaHTMLScraper)
_HEADER_RULES = [
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


def _strip_accents(text: str) -> str:
    nkfd = unicodedata.normalize("NFKD", text)
    return nkfd.encode("ascii", "ignore").decode("ascii")


def _normalise_header(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", _strip_accents(text.lower()))


class DatatablesScraper(BaseScraper):
    """
    Scrapes portals that use jQuery DataTables.

    Strategy:
    1. Fetch the page and scan ``<script>`` tags for AJAX endpoint config.
    2. If found, paginate through the JSON API with DataTables parameters.
    3. Otherwise fall back to HTML table parsing (same as TablaHTMLScraper).
    """

    MAX_PAGES = 100
    PAGE_SIZE = 100  # rows per DataTables request

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def scrape(self) -> list[dict]:
        source_url: str = self.source["url"]
        self.logger.info("Fetching initial page: %s", source_url)

        response = fetch(self.session, source_url)
        if response is None:
            self.logger.warning("Could not fetch source URL: %s", source_url)
            return []

        soup = BeautifulSoup(response.text, "lxml")
        ajax_url = self._detect_ajax_endpoint(soup, source_url)

        if ajax_url:
            self.logger.info("DataTables AJAX endpoint detected: %s", ajax_url)
            records = self._scrape_ajax(ajax_url, source_url)
        else:
            self.logger.info(
                "No AJAX endpoint found — falling back to HTML table parsing."
            )
            records = self._scrape_html_table(soup, source_url)

        self.logger.info(
            "Source '%s' — scraped %d total records.",
            self.source.get("nombre", source_url),
            len(records),
        )
        return records

    # ------------------------------------------------------------------
    # AJAX endpoint detection
    # ------------------------------------------------------------------

    def _detect_ajax_endpoint(self, soup: BeautifulSoup, base_url: str) -> Optional[str]:
        """
        Scan all ``<script>`` tags for DataTables AJAX configuration and
        return the resolved absolute URL, or ``None`` if not found.
        """
        for script in soup.find_all("script"):
            js = script.string or ""
            if not js:
                continue

            for pattern in (_RE_AJAX_URL_OBJ, _RE_AJAX_URL, _RE_SAJAX_SOURCE):
                m = pattern.search(js)
                if m:
                    raw_url = m.group(1).strip()
                    # Resolve relative URLs
                    if raw_url.startswith("http"):
                        return raw_url
                    return urljoin(base_url, raw_url)

        return None

    # ------------------------------------------------------------------
    # AJAX-based scraping
    # ------------------------------------------------------------------

    def _scrape_ajax(self, ajax_url: str, source_url: str) -> list[dict]:
        """
        Page through a DataTables JSON API and return all records.

        The standard DataTables server-side request parameters are:
        - ``draw``   — request counter (1, 2, 3 …)
        - ``start``  — row offset
        - ``length`` — page size
        """
        records = []
        column_names: Optional[list[str]] = None
        draw = 1
        start = 0

        for _ in range(self.MAX_PAGES):
            params = {
                "draw": draw,
                "start": start,
                "length": self.PAGE_SIZE,
            }
            self.logger.debug(
                "DataTables AJAX request: draw=%d start=%d length=%d",
                draw, start, self.PAGE_SIZE,
            )
            response = fetch(self.session, ajax_url, params=params, timeout=20)
            if response is None:
                self.logger.warning("AJAX fetch failed at start=%d", start)
                break

            try:
                payload = response.json()
            except ValueError:
                self.logger.warning("Non-JSON AJAX response at start=%d", start)
                break

            rows = payload.get("data") or payload.get("aaData") or []
            if not rows:
                break  # No more data

            # Build column name list on the first page from "columns" key
            if column_names is None:
                raw_columns = payload.get("columns") or []
                column_names = [
                    (c.get("title") or c.get("name") or c.get("data") or f"col_{i}")
                    for i, c in enumerate(raw_columns)
                ]

            for row in rows:
                record = self._row_to_record(row, column_names, source_url)
                records.append(self._normalize_record(record))

            if len(rows) < self.PAGE_SIZE:
                break  # Last page

            start += self.PAGE_SIZE
            draw += 1

        return records

    def _row_to_record(
        self,
        row: list | dict,
        column_names: Optional[list[str]],
        source_url: str,
    ) -> dict:
        """Convert a single DataTables row (list or dict) into a record dict."""
        record = empty_record()
        record["fuente_url"] = self.source.get("url")
        record["estado"] = self.source.get("estado")
        record["ente_convocante"] = self.source.get("nombre")
        record["tipo_ente"] = self.source.get("tipo_ente")

        if isinstance(row, dict):
            # Dict row: keys are column names
            for key, value in row.items():
                field = self._map_header(str(key))
                if field and value is not None:
                    self._assign_field(record, field, str(value), source_url)
        elif isinstance(row, list):
            # List row: positional columns
            for idx, value in enumerate(row):
                if column_names and idx < len(column_names):
                    field = self._map_header(column_names[idx])
                else:
                    field = None
                if field and value is not None:
                    self._assign_field(record, field, str(value), source_url)
                # Even without a mapped field, check for PDF URLs
                if value and isinstance(value, str) and value.strip().lower().endswith(".pdf"):
                    self._classify_pdf(value, "", record)

        return record

    def _assign_field(
        self, record: dict, field: str, raw_value: str, base_url: str
    ) -> None:
        """Assign a parsed / normalised value to *field* in *record*."""
        # Strip HTML tags that DataTables sometimes returns
        clean = re.sub(r"<[^>]+>", " ", raw_value).strip()
        clean = re.sub(r"\s+", " ", clean)

        if field.startswith("fecha_"):
            d = parse_date(clean)
            record[field] = format_date(d) if d else clean
        elif field.startswith("url_"):
            record[field] = urljoin(base_url, clean) if clean else None
        else:
            record[field] = clean or None

    # ------------------------------------------------------------------
    # HTML table fallback (mirrors TablaHTMLScraper logic)
    # ------------------------------------------------------------------

    def _scrape_html_table(
        self, soup: BeautifulSoup, page_url: str
    ) -> list[dict]:
        """Parse HTML tables when no AJAX endpoint is detected."""
        records = []
        current_url: Optional[str] = page_url
        page = 0

        while current_url and page < self.MAX_PAGES:
            page += 1
            if page > 1:
                response = fetch(self.session, current_url)
                if response is None:
                    break
                soup = BeautifulSoup(response.text, "lxml")

            page_records = self._parse_html_page(soup, current_url)
            records.extend(page_records)

            next_url = self._find_next_page(soup, current_url)
            if next_url and next_url != current_url:
                current_url = next_url
            else:
                break

        return records

    def _parse_html_page(self, soup: BeautifulSoup, page_url: str) -> list[dict]:
        table = self._pick_best_table(soup)
        if table is None:
            return []

        headers, col_map = self._build_column_map(table)
        if not col_map:
            return []

        records = []
        rows = table.find_all("tr")
        data_rows = [r for r in rows if not r.find("th")]
        if not data_rows:
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
                        if field_name.startswith("fecha_"):
                            d = parse_date(value)
                            record[field_name] = format_date(d) if d else value
                        else:
                            record[field_name] = value

                    anchor = cell.find("a", href=True)
                    if anchor:
                        href = anchor["href"]
                        full_url = urljoin(page_url, href)
                        if href.lower().endswith(".pdf"):
                            self._classify_pdf(full_url, anchor.get_text(strip=True), record)
                        elif not record.get("url_detalle_procedimiento"):
                            record["url_detalle_procedimiento"] = full_url

            records.append(self._normalize_record(record))

        return records

    # ------------------------------------------------------------------
    # Shared utilities
    # ------------------------------------------------------------------

    def _pick_best_table(self, soup: BeautifulSoup):
        tables = soup.find_all("table")
        if not tables:
            return None
        return max(tables, key=lambda t: len(t.find_all("tr")))

    def _build_column_map(self, table) -> tuple[list[str], dict[int, str]]:
        header_row = table.find("tr")
        if header_row is None:
            return [], {}
        th_cells = header_row.find_all("th") or header_row.find_all("td")
        headers = [c.get_text(separator=" ", strip=True) for c in th_cells]
        col_map = {
            idx: field
            for idx, h in enumerate(headers)
            for field in [self._map_header(h)]
            if field
        }
        return headers, col_map

    def _map_header(self, header: str) -> Optional[str]:
        norm = _normalise_header(header)
        for required, optional, field in _HEADER_RULES:
            if all(kw in norm for kw in required):
                if not optional or any(kw in norm for kw in optional):
                    return field
        return None

    def _classify_pdf(self, url: str, link_text: str, record: dict) -> None:
        combined = _strip_accents(url.lower() + " " + link_text.lower())
        for field, keywords in _PDF_KEYWORDS.items():
            if any(kw in combined for kw in keywords):
                if not record.get(field):
                    record[field] = url
                return
        if not record.get("url_convocatoria_pdf"):
            record["url_convocatoria_pdf"] = url

    def _find_next_page(self, soup: BeautifulSoup, current_url: str) -> Optional[str]:
        rel_next = soup.find("a", rel=lambda r: r and "next" in r)
        if rel_next and rel_next.get("href"):
            return urljoin(current_url, rel_next["href"])
        next_re = re.compile(r"^\s*(siguiente|next|>|›|>>)\s*$", re.IGNORECASE)
        for anchor in soup.find_all("a", href=True):
            if next_re.match(anchor.get_text(strip=True)):
                return urljoin(current_url, anchor["href"])
        return None
