"""
scrapers package — exports all concrete scraper classes.
"""

from scrapers.tabla_html import TablaHTMLScraper
from scrapers.card_list import CardListScraper
from scrapers.datatables import DatatablesScraper

__all__ = [
    "TablaHTMLScraper",
    "CardListScraper",
    "DatatablesScraper",
]
