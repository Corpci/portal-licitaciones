"""
agent.py — Orchestrates all scrapers, applies date filtering, and saves output.
"""

import json
import logging
import os
import re
import unicodedata
from datetime import date
from pathlib import Path
from typing import Optional

import pandas as pd

from base import BaseScraper, MIN_DATE, SCHEMA_FIELDS
from utils.http import build_session, fetch
from utils.dates import parse_date
from scrapers import TablaHTMLScraper, CardListScraper, DatatablesScraper

logger = logging.getLogger(__name__)

# Path to the default sources file (same directory as this module)
_DEFAULT_SOURCES_PATH = Path(__file__).parent / "sources.json"

# Scraper type string → class
_SCRAPER_CLASSES: dict[str, type[BaseScraper]] = {
    "tabla_html": TablaHTMLScraper,
    "card_list": CardListScraper,
    "datatables": DatatablesScraper,
}

# Date fields in priority order for date filtering
_DATE_FIELDS_PRIORITY = [
    "fecha_publicacion",
    "fecha_apertura",
    "fecha_junta_aclaraciones",
    "fecha_limite_compra_bases",
]


def _strip_accents(text: str) -> str:
    nkfd = unicodedata.normalize("NFKD", text)
    return nkfd.encode("ascii", "ignore").decode("ascii")


def _slugify(text: str) -> str:
    """Convert a source name to a safe filesystem slug."""
    text = _strip_accents(text.lower())
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = text.strip("_")
    return text[:60]


class LicitacionesAgent:
    """
    Main orchestration agent for the Mexican public procurement scraper.

    Usage::

        agent = LicitacionesAgent()
        df = agent.run()
    """

    def __init__(
        self,
        sources: Optional[list[dict]] = None,
        output_dir: str = "./output",
    ) -> None:
        """
        Parameters
        ----------
        sources:
            List of source config dicts.  If ``None``, loaded from
            ``sources.json`` in the same directory as this file.
        output_dir:
            Directory where CSV files are written.  Created if it does not
            exist.
        """
        if sources is None:
            sources = self._load_sources(_DEFAULT_SOURCES_PATH)
        self.sources: list[dict] = sources
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.session = build_session()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self) -> pd.DataFrame:
        """
        Execute all configured sources sequentially.

        Returns
        -------
        pd.DataFrame
            Consolidated DataFrame of all filtered records.
        """
        all_filtered: list[dict] = []
        stats: list[dict] = []

        for source in self.sources:
            nombre = source.get("nombre", source.get("url", "?"))
            self.logger_for(nombre).info("Starting source: %s", nombre)

            try:
                raw_records, filtered_records = self._run_source(source)
            except Exception as exc:  # noqa: BLE001
                self.logger_for(nombre).error(
                    "Unhandled error processing source '%s': %s", nombre, exc, exc_info=True
                )
                raw_records, filtered_records = [], []

            stats.append(
                {
                    "nombre": nombre,
                    "raw": len(raw_records),
                    "filtered": len(filtered_records),
                }
            )

            if filtered_records:
                self._save_source_csv(source, filtered_records)
                all_filtered.extend(filtered_records)

        if all_filtered:
            self._save_consolidated_csv(all_filtered)

        self._print_summary(stats)

        if all_filtered:
            return pd.DataFrame(all_filtered, columns=SCHEMA_FIELDS)
        return pd.DataFrame(columns=SCHEMA_FIELDS)

    # ------------------------------------------------------------------
    # Per-source execution
    # ------------------------------------------------------------------

    def _run_source(self, source: dict) -> tuple[list[dict], list[dict]]:
        """
        Fetch, scrape, and filter a single source.

        Returns
        -------
        tuple[list[dict], list[dict]]
            ``(raw_records, filtered_records)``
        """
        scraper_type = source.get("scraper_type", "auto")

        if scraper_type == "auto":
            # Need to fetch the page first to auto-detect
            url = source.get("url", "")
            response = fetch(self.session, url)
            html = response.text if response else ""
            scraper_type = self._detect_scraper_type(source, html)
            logger.info(
                "Auto-detected scraper type '%s' for source '%s'.",
                scraper_type,
                source.get("nombre"),
            )

        scraper_class = _SCRAPER_CLASSES.get(scraper_type)
        if scraper_class is None:
            logger.error(
                "Unknown scraper_type '%s' for source '%s' — skipping.",
                scraper_type,
                source.get("nombre"),
            )
            return [], []

        scraper = scraper_class(source, self.session)
        raw_records = scraper.scrape()
        filtered_records = self._filter_by_date(raw_records)

        return raw_records, filtered_records

    # ------------------------------------------------------------------
    # Scraper type auto-detection
    # ------------------------------------------------------------------

    def _detect_scraper_type(self, source: dict, html: str) -> str:
        """
        Infer which scraper class to use from the page HTML.

        Rules (evaluated in order):
        1. ``source["scraper_type"]`` is set and not "auto" → use it.
        2. DataTables markers in HTML → ``"datatables"``.
        3. ``<table>`` with more than 5 ``<tr>`` rows → ``"tabla_html"``.
        4. Default → ``"card_list"``.
        """
        explicit = source.get("scraper_type", "auto")
        if explicit and explicit != "auto":
            return explicit

        if "dataTable" in html or "DataTable" in html or "sAjaxSource" in html:
            return "datatables"

        table_count = html.lower().count("<table")
        tr_count = html.lower().count("<tr")
        if table_count >= 1 and tr_count > 5:
            return "tabla_html"

        return "card_list"

    # ------------------------------------------------------------------
    # Date filtering
    # ------------------------------------------------------------------

    def _filter_by_date(self, records: list[dict]) -> list[dict]:
        """
        Keep only records whose best available date is >= :data:`MIN_DATE`.

        The "best" date is the first non-None value found by checking
        ``fecha_publicacion``, ``fecha_apertura``, ``fecha_junta_aclaraciones``,
        and ``fecha_limite_compra_bases`` in that order.

        Records with no parseable date are discarded.
        """
        filtered = []
        for record in records:
            best_date: Optional[date] = None
            for field in _DATE_FIELDS_PRIORITY:
                raw_value = record.get(field)
                if not raw_value:
                    continue
                d = parse_date(str(raw_value))
                if d:
                    best_date = d
                    break

            if best_date is None:
                # No date found — discard
                continue

            if best_date >= MIN_DATE:
                filtered.append(record)

        return filtered

    # ------------------------------------------------------------------
    # CSV output
    # ------------------------------------------------------------------

    def _save_source_csv(self, source: dict, records: list[dict]) -> None:
        """Save *records* for a single source to ``output/{slug}_reciente.csv``."""
        slug = _slugify(source.get("nombre", "desconocido"))
        path = self.output_dir / f"{slug}_reciente.csv"
        df = pd.DataFrame(records, columns=SCHEMA_FIELDS)
        df.to_csv(path, index=False, encoding="utf-8-sig")
        logger.info(
            "Saved %d filtered records for '%s' → %s",
            len(records),
            source.get("nombre"),
            path,
        )

    def _save_consolidated_csv(self, all_records: list[dict]) -> None:
        """Save all records to ``output/licitanet_reciente_consolidado.csv``."""
        path = self.output_dir / "licitanet_reciente_consolidado.csv"
        df = pd.DataFrame(all_records, columns=SCHEMA_FIELDS)
        df.to_csv(path, index=False, encoding="utf-8-sig")
        logger.info(
            "Saved consolidated CSV with %d total records → %s",
            len(all_records),
            path,
        )

    # ------------------------------------------------------------------
    # Summary printing
    # ------------------------------------------------------------------

    def _print_summary(self, stats: list[dict]) -> None:
        """Print a formatted summary table to stdout."""
        if not stats:
            print("No sources processed.")
            return

        col_width = max(len(s["nombre"]) for s in stats) + 2
        header = f"{'Fuente':<{col_width}} {'Registros raw':>14} {'Registros filtrados':>20}"
        divider = "-" * len(header)

        print("\n" + divider)
        print(header)
        print(divider)
        for s in stats:
            print(
                f"{s['nombre']:<{col_width}} {s['raw']:>14} {s['filtered']:>20}"
            )
        print(divider)
        total_raw = sum(s["raw"] for s in stats)
        total_filt = sum(s["filtered"] for s in stats)
        print(
            f"{'TOTAL':<{col_width}} {total_raw:>14} {total_filt:>20}"
        )
        print(divider + "\n")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_sources(path: Path) -> list[dict]:
        """Load and parse the ``sources.json`` file."""
        if not path.exists():
            logger.error("sources.json not found at %s", path)
            return []
        with open(path, encoding="utf-8") as fh:
            try:
                data = json.load(fh)
            except json.JSONDecodeError as exc:
                logger.error("Failed to parse sources.json: %s", exc)
                return []
        if not isinstance(data, list):
            logger.error("sources.json must be a JSON array.")
            return []
        return data

    # ------------------------------------------------------------------
    # Single-URL mode (used by --url CLI flag and Node.js integration)
    # ------------------------------------------------------------------

    def run_single_url(self, url: str) -> dict:
        """
        Scrape a single arbitrary URL without writing any CSV files or printing
        summary tables.

        Parameters
        ----------
        url:
            The portal URL to scrape.

        Returns
        -------
        dict
            A dict with:
            - ``summary`` (str): human-readable summary of findings.
            - ``tenders`` (list[dict]): each item has ``title``, ``description``,
              ``url``, and ``date`` keys.
        """
        source = {
            "nombre": "custom",
            "estado": "",
            "tipo_ente": "ejecutivo",
            "url": url,
            "notas": "",
            "scraper_type": "auto",
        }

        try:
            raw_records, filtered_records = self._run_source(source)
        except Exception as exc:  # noqa: BLE001
            logger.error("Error scraping URL '%s': %s", url, exc, exc_info=True)
            raw_records, filtered_records = [], []

        # Use filtered records when available; fall back to raw records so that
        # portals whose records have no parseable dates still return results.
        records_to_use = filtered_records if filtered_records else raw_records

        tenders = []
        for record in records_to_use:
            title = (
                record.get("objeto")
                or record.get("numero_procedimiento")
                or "Sin título"
            )
            description = (
                record.get("tipo_procedimiento")
                or record.get("tipo_contrato")
                or record.get("ente_convocante")
                or ""
            )
            tender_url = (
                record.get("url_detalle_procedimiento")
                or record.get("url_convocatoria_pdf")
                or record.get("fuente_url")
                or url
            )
            date_val = (
                record.get("fecha_publicacion")
                or record.get("fecha_apertura")
                or record.get("fecha_junta_aclaraciones")
                or record.get("fecha_limite_compra_bases")
                or ""
            )
            tenders.append(
                {
                    "title": str(title) if title else "Sin título",
                    "description": str(description) if description else "",
                    "url": str(tender_url) if tender_url else url,
                    "date": str(date_val) if date_val else "",
                }
            )

        total_raw = len(raw_records)
        total_filtered = len(filtered_records)
        if tenders:
            summary = (
                f"Se encontraron {len(tenders)} licitación(es) en {url}. "
                f"Registros crudos: {total_raw}, filtrados por fecha: {total_filtered}."
            )
        else:
            summary = (
                f"No se encontraron licitaciones en {url}. "
                f"Registros crudos obtenidos: {total_raw}."
            )

        return {"summary": summary, "tenders": tenders}

    @staticmethod
    def logger_for(name: str) -> logging.Logger:
        return logging.getLogger(f"agent.{_slugify(name)}")
