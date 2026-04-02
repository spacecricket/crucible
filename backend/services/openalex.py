"""
OpenAlex API client.

Docs: https://developers.openalex.org
Rate limits: 10 req/sec with polite pool (mailto header), ~1 req/sec without.
No API key required.
"""

import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.openalex.org"

# Polite pool: include a mailto to get 10 req/sec instead of 1 req/sec
MAILTO = "crucible@crucible.fyi"


class OpenAlexClient:
    def __init__(self):
        self.client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=30.0,
            params={"mailto": MAILTO},
        )

    async def _request(self, method: str, path: str, max_retries: int = 3, **kwargs) -> dict:
        """Make a request to the OpenAlex API with retry on 429."""
        for attempt in range(max_retries + 1):
            resp = await self.client.request(method, path, **kwargs)

            if resp.status_code == 429:
                logger.warning(
                    "OpenAlex rate limited (429) on attempt %d/%d. "
                    "URL: %s %s | Headers: %s",
                    attempt + 1,
                    max_retries + 1,
                    method,
                    path,
                    dict(resp.headers),
                )
                if attempt == max_retries:
                    resp.raise_for_status()
                retry_after = int(resp.headers.get("Retry-After", 2 ** (attempt + 1)))
                logger.info("Waiting %d seconds before retry", retry_after)
                await asyncio.sleep(retry_after)
                continue

            resp.raise_for_status()
            return resp.json()

        resp.raise_for_status()
        return resp.json()

    async def search_works(self, query: str, limit: int = 20, page: int = 1) -> dict:
        """
        Search for works by keyword.
        Returns {"meta": {...}, "results": [...]}.
        """
        return await self._request("GET", "/works", params={
            "search": query,
            "per_page": min(limit, 100),
            "page": page,
        })

    async def get_work(self, openalex_id: str) -> dict:
        """Fetch a single work by OpenAlex ID (e.g. 'W2741809807')."""
        return await self._request("GET", f"/works/{openalex_id}")

    async def get_references(self, openalex_id: str, limit: int = 100) -> dict:
        """
        Get works that this work cites (its references).
        Uses the referenced_works field via filter.
        """
        # First get the work to find its referenced_works IDs
        work = await self.get_work(openalex_id)
        ref_ids = work.get("referenced_works") or []

        if not ref_ids:
            return {"meta": {"count": 0}, "results": []}

        # Fetch referenced works using pipe-separated filter
        # OpenAlex supports filtering by multiple IDs
        id_filter = "|".join(ref_ids[:limit])
        return await self._request("GET", "/works", params={
            "filter": f"openalex:{id_filter}",
            "per_page": min(limit, 100),
        })

    async def get_citations(self, openalex_id: str, limit: int = 100) -> dict:
        """
        Get works that cite this work.
        Uses the cites filter.
        """
        return await self._request("GET", "/works", params={
            "filter": f"cites:{openalex_id}",
            "per_page": min(limit, 100),
            "sort": "cited_by_count:desc",
        })

    async def close(self):
        await self.client.aclose()
