"""
utils/http.py — HTTP session factory and a fault-tolerant fetch wrapper.
"""

import logging
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------

_DEFAULT_TIMEOUT = 15  # seconds

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "es-MX,es;q=0.9,en-US;q=0.7,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}


def build_session() -> requests.Session:
    """
    Return a :class:`requests.Session` configured with:

    * **Retry adapter** — 3 attempts, exponential backoff (factor=1),
      retries on HTTP 500, 502, 503, 504.
    * **Default headers** — realistic browser UA, ``Accept-Language: es-MX``.
    * ``session.default_timeout`` attribute set to 15 s so callers can
      reference it without hard-coding the value.
    """
    session = requests.Session()

    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "OPTIONS", "POST"],
        raise_on_status=False,
    )

    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    session.headers.update(_HEADERS)

    # Expose default timeout as an attribute for convenient reference.
    session.default_timeout = _DEFAULT_TIMEOUT  # type: ignore[attr-defined]

    return session


# ---------------------------------------------------------------------------
# Fault-tolerant fetch
# ---------------------------------------------------------------------------

def fetch(
    session: requests.Session,
    url: str,
    timeout: int = _DEFAULT_TIMEOUT,
    **kwargs,
) -> Optional[requests.Response]:
    """
    Perform ``session.get(url, ...)`` and return the :class:`Response`.

    On *any* exception (connection error, timeout, too many redirects, …) the
    error is logged as a WARNING and ``None`` is returned so that callers can
    handle missing pages gracefully without try/except boilerplate.

    Parameters
    ----------
    session:
        Configured :class:`requests.Session`.
    url:
        Target URL.
    timeout:
        Request timeout in seconds (default 15).
    **kwargs:
        Forwarded verbatim to :meth:`requests.Session.get`.
    """
    try:
        response = session.get(url, timeout=timeout, **kwargs)
        response.raise_for_status()
        return response
    except requests.exceptions.Timeout:
        logger.warning("Timeout fetching URL: %s", url)
    except requests.exceptions.TooManyRedirects:
        logger.warning("Too many redirects for URL: %s", url)
    except requests.exceptions.HTTPError as exc:
        logger.warning("HTTP error %s for URL: %s", exc.response.status_code, url)
    except requests.exceptions.ConnectionError:
        logger.warning("Connection error fetching URL: %s", url)
    except requests.exceptions.RequestException as exc:
        logger.warning("Request exception for URL %s: %s", url, exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Unexpected error fetching URL %s: %s", url, exc)

    return None
