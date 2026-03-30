"""
base.py — Shared constants, schema definition, and abstract base class for all scrapers.
"""

import logging
from abc import ABC, abstractmethod
from datetime import date
from typing import Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MIN_DATE = date(2026, 1, 1)

# All canonical field names that every record must expose.
SCHEMA_FIELDS = [
    "estado",
    "ente_convocante",
    "tipo_ente",
    "tipo_procedimiento",
    "numero_procedimiento",
    "objeto",
    "tipo_contrato",
    "fecha_publicacion",
    "fecha_limite_compra_bases",
    "fecha_visita",
    "fecha_junta_aclaraciones",
    "fecha_apertura",
    "url_detalle_procedimiento",
    "url_convocatoria_pdf",
    "url_bases_pdf",
    "url_acta_apertura_pdf",
    "url_fallo_pdf",
    "estatus",
    "fuente_url",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def empty_record() -> dict:
    """Return a dict with all schema fields initialised to None."""
    return {field: None for field in SCHEMA_FIELDS}


# ---------------------------------------------------------------------------
# Abstract base class
# ---------------------------------------------------------------------------

class BaseScraper(ABC):
    """
    Abstract base for every portal-specific scraper.

    Subclasses must implement :meth:`scrape` which returns a list of raw,
    un-filtered record dicts.  Each dict will be normalised to contain exactly
    the keys in :data:`SCHEMA_FIELDS` via :meth:`_normalize_record`.
    """

    def __init__(self, source: dict, session) -> None:
        """
        Parameters
        ----------
        source:
            Configuration dict loaded from ``sources.json``.  Expected keys:
            ``nombre``, ``estado``, ``tipo_ente``, ``url``, optionally
            ``scraper_type``, ``notas``.
        session:
            A ``requests.Session`` (or compatible) already configured with
            retry logic and default headers.
        """
        self.source = source
        self.session = session
        self.logger = logging.getLogger(
            f"{self.__class__.__module__}.{self.__class__.__name__}"
        )

    @abstractmethod
    def scrape(self) -> list[dict]:
        """
        Fetch and parse the portal, returning a list of record dicts.

        Records do **not** need to be filtered by date here — filtering is
        done by the agent layer.  Each record should, however, have
        ``fuente_url``, ``estado``, and ``ente_convocante`` populated.
        """
        ...

    def _normalize_record(self, record: dict) -> dict:
        """
        Ensure *record* contains every key in :data:`SCHEMA_FIELDS`.

        - Missing keys are added with value ``None``.
        - Extra keys that are not in the schema are silently dropped.
        - ``estado`` and ``ente_convocante`` are back-filled from the source
          config when absent or empty.
        - ``fuente_url`` is back-filled from ``source["url"]``.
        - ``tipo_ente`` is back-filled from ``source["tipo_ente"]``.
        """
        normalised = empty_record()

        # Copy only schema fields from the raw record.
        for field in SCHEMA_FIELDS:
            if field in record and record[field] is not None:
                normalised[field] = record[field]

        # Back-fill metadata from source config.
        if not normalised.get("estado"):
            normalised["estado"] = self.source.get("estado")

        if not normalised.get("ente_convocante"):
            normalised["ente_convocante"] = self.source.get("nombre")

        if not normalised.get("tipo_ente"):
            normalised["tipo_ente"] = self.source.get("tipo_ente")

        if not normalised.get("fuente_url"):
            normalised["fuente_url"] = self.source.get("url")

        return normalised
