#!/usr/bin/env python3
"""
Agente de scraping de licitaciones públicas mexicanas.
Filtra procedimientos desde MIN_DATE = 2026-01-01.

Uso:
    python main.py                          # Corre todas las fuentes
    python main.py --source "Edomex"        # Corre solo fuentes cuyo nombre contiene "Edomex"
    python main.py --list                   # Lista fuentes disponibles
    python main.py --output /ruta/dir       # Directorio de salida personalizado
    python main.py --url https://example.com  # Escanea una URL arbitraria
    python main.py --url https://... --json-stdout  # Igual, salida JSON a stdout
"""

import argparse
import json
import logging
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Configure the root logger BEFORE importing project modules so that every
# module's getLogger(__name__) inherits the handler and formatter.
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)

# Now import project modules (they will pick up the root logger config)
from base import MIN_DATE  # noqa: E402
from agent import LicitacionesAgent  # noqa: E402

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default locations
# ---------------------------------------------------------------------------

_SCRAPER_DIR = Path(__file__).parent
_DEFAULT_SOURCES = _SCRAPER_DIR / "sources.json"
_DEFAULT_OUTPUT = _SCRAPER_DIR / "output"


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description=(
            "Agente de scraping de licitaciones públicas mexicanas. "
            f"Filtra procedimientos con fecha >= {MIN_DATE.isoformat()}."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--source",
        metavar="NOMBRE",
        help=(
            "Ejecutar únicamente las fuentes cuyo nombre contiene NOMBRE "
            "(búsqueda parcial, sin distinción de mayúsculas)."
        ),
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Listar todas las fuentes configuradas y salir.",
    )
    parser.add_argument(
        "--sources-file",
        metavar="RUTA",
        default=str(_DEFAULT_SOURCES),
        help=f"Ruta al archivo sources.json (default: {_DEFAULT_SOURCES}).",
    )
    parser.add_argument(
        "--output",
        metavar="DIR",
        default=str(_DEFAULT_OUTPUT),
        help=f"Directorio de salida para los archivos CSV (default: {_DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--log-level",
        metavar="NIVEL",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Nivel de log (default: INFO).",
    )
    parser.add_argument(
        "--url",
        metavar="URL",
        help=(
            "Escanea una URL arbitraria en lugar de cargar fuentes de sources.json. "
            "Activa automáticamente --json-stdout."
        ),
    )
    parser.add_argument(
        "--json-stdout",
        action="store_true",
        help="Imprime resultados como JSON a stdout en lugar de guardar CSVs.",
    )
    return parser


# ---------------------------------------------------------------------------
# Source loading helper
# ---------------------------------------------------------------------------

def load_sources(path: str) -> list[dict]:
    p = Path(path)
    if not p.exists():
        logger.error("Archivo de fuentes no encontrado: %s", p)
        sys.exit(1)
    with open(p, encoding="utf-8") as fh:
        try:
            data = json.load(fh)
        except json.JSONDecodeError as exc:
            logger.error("Error al parsear %s: %s", p, exc)
            sys.exit(1)
    if not isinstance(data, list):
        logger.error("El archivo %s debe contener un array JSON.", p)
        sys.exit(1)
    return data


# ---------------------------------------------------------------------------
# List sources
# ---------------------------------------------------------------------------

def list_sources(sources: list[dict]) -> None:
    print(f"\n{'#':<4} {'Nombre':<45} {'Estado':<22} {'Tipo':<12} {'Scraper':<12}")
    print("-" * 100)
    for i, s in enumerate(sources, start=1):
        print(
            f"{i:<4} "
            f"{s.get('nombre', ''):<45} "
            f"{s.get('estado', ''):<22} "
            f"{s.get('tipo_ente', ''):<12} "
            f"{s.get('scraper_type', 'auto'):<12}"
        )
    print(f"\nTotal: {len(sources)} fuente(s)\n")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # Adjust log level
    logging.getLogger().setLevel(getattr(logging, args.log_level))

    # --url mode: scrape a single arbitrary URL and output JSON
    if args.url:
        # Redirect all logging to stderr so stdout stays clean JSON
        for handler in logging.getLogger().handlers[:]:
            handler.stream = sys.stderr

        agent = LicitacionesAgent(sources=[], output_dir=args.output)
        try:
            result = agent.run_single_url(args.url)
        except KeyboardInterrupt:
            logger.warning("Ejecución interrumpida por el usuario.")
            sys.exit(0)
        except Exception as exc:  # noqa: BLE001
            logger.critical("Error fatal al escanear URL: %s", exc, exc_info=True)
            sys.exit(1)

        # Always output JSON to stdout when --url is used (implicit --json-stdout)
        sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        sys.stdout.write("\n")
        sys.stdout.flush()
        return

    # Load sources
    sources = load_sources(args.sources_file)

    # --list: just print and exit
    if args.list:
        list_sources(sources)
        return

    # --source: filter to matching sources
    if args.source:
        needle = args.source.lower()
        sources = [s for s in sources if needle in s.get("nombre", "").lower()]
        if not sources:
            logger.error(
                "Ninguna fuente coincide con el nombre '%s'. "
                "Use --list para ver las fuentes disponibles.",
                args.source,
            )
            sys.exit(1)
        logger.info(
            "Filtrando a %d fuente(s) que coinciden con '%s'.",
            len(sources),
            args.source,
        )

    # Run the agent
    logger.info(
        "Iniciando agente con %d fuente(s). MIN_DATE = %s. Output: %s",
        len(sources),
        MIN_DATE.isoformat(),
        args.output,
    )

    agent = LicitacionesAgent(sources=sources, output_dir=args.output)

    try:
        df = agent.run()
    except KeyboardInterrupt:
        logger.warning("Ejecución interrumpida por el usuario.")
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001
        logger.critical("Error fatal en el agente: %s", exc, exc_info=True)
        sys.exit(1)

    total = len(df)
    logger.info(
        "Ejecución completada. %d registro(s) en el DataFrame consolidado.",
        total,
    )

    if total == 0:
        logger.warning(
            "No se encontraron registros con fecha >= %s en ninguna fuente.",
            MIN_DATE.isoformat(),
        )

    # --json-stdout: emit consolidated results as JSON
    if args.json_stdout:
        tenders = []
        for _, row in df.iterrows():
            tenders.append(
                {
                    "title": str(row.get("objeto") or row.get("numero_procedimiento") or "Sin título"),
                    "description": str(row.get("tipo_procedimiento") or row.get("tipo_contrato") or ""),
                    "url": str(
                        row.get("url_detalle_procedimiento")
                        or row.get("url_convocatoria_pdf")
                        or row.get("fuente_url")
                        or ""
                    ),
                    "date": str(
                        row.get("fecha_publicacion")
                        or row.get("fecha_apertura")
                        or ""
                    ),
                }
            )
        result = {
            "summary": f"Se encontraron {len(tenders)} licitación(es) en {len(sources)} fuente(s).",
            "tenders": tenders,
        }
        sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        sys.stdout.write("\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
