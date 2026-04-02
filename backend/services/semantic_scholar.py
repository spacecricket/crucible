import asyncio
import logging
import httpx
from upstash_ratelimit import Ratelimit

from backend.services.rate_limiter import wait_for_rate_limit

logger = logging.getLogger(__name__)

BASE_URL = "https://api.semanticscholar.org/graph/v1"

PAPER_FIELDS = ",".join([
    "paperId",
    "externalIds",
    "title",
    "abstract",
    "year",
    "authors",
    "citationCount",
    "referenceCount",
    "isOpenAccess",
    "openAccessPdf",
    "publicationTypes",
    "journal",
    "fieldsOfStudy",
    "s2FieldsOfStudy",
])


class SemanticScholarClient:
    def __init__(self, rate_limiter: Ratelimit):
        self.rate_limiter = rate_limiter
        self.client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=30.0,
        )

    async def _request(self, method: str, path: str, max_retries: int = 3, **kwargs) -> dict:
        """Make a rate-limited request to the S2 API with retry on 429."""
        for attempt in range(max_retries + 1):
            await wait_for_rate_limit(self.rate_limiter)

            resp = await self.client.request(method, path, **kwargs)

            if resp.status_code == 429:
                logger.warning(
                    "S2 rate limited (429) on attempt %d/%d. "
                    "URL: %s %s | Status: %s | Headers: %s | Body: %s",
                    attempt + 1,
                    max_retries + 1,
                    method,
                    path,
                    resp.status_code,
                    dict(resp.headers),
                    resp.text[:500],
                )
                if attempt == max_retries:
                    resp.raise_for_status()
                # Respect Retry-After header, or back off exponentially
                retry_after = int(resp.headers.get("Retry-After", 2 ** (attempt + 1)))
                logger.info("Waiting %d seconds before retry", retry_after)
                await asyncio.sleep(retry_after)
                continue

            resp.raise_for_status()
            return resp.json()

        # Should not reach here, but just in case
        resp.raise_for_status()
        return resp.json()

    async def search_papers(self, query: str, limit: int = 20, offset: int = 0) -> dict:
        """
        Search for papers by keyword.
        Returns {"total": N, "data": [...]}.
        """
        return await self._request("GET", "/paper/search", params={
            "query": query,
            "fields": PAPER_FIELDS,
            "limit": min(limit, 100),
            "offset": offset,
        })

    async def get_paper(self, paper_id: str) -> dict:
        """Fetch a single paper by S2 ID, DOI, or other external ID."""
        return await self._request("GET", f"/paper/{paper_id}", params={
            "fields": PAPER_FIELDS,
        })

    async def get_references(self, paper_id: str, limit: int = 100) -> dict:
        """
        Get papers that this paper cites (backward references).
        Returns {"data": [{"citedPaper": {...}}, ...]}.
        """
        return await self._request("GET", f"/paper/{paper_id}/references", params={
            "fields": PAPER_FIELDS,
            "limit": min(limit, 1000),
        })

    async def get_citations(self, paper_id: str, limit: int = 100) -> dict:
        """
        Get papers that cite this paper (forward citations).
        Returns {"data": [{"citingPaper": {...}}, ...]}.
        """
        return await self._request("GET", f"/paper/{paper_id}/citations", params={
            "fields": PAPER_FIELDS,
            "limit": min(limit, 1000),
        })

    async def close(self):
        await self.client.aclose()
