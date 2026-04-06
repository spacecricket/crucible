"""
Paper search orchestration.

Flow:
1. Check Postgres cache for matching papers
2. If cache has enough fresh results (< 24h old), return them directly
3. Otherwise call Semantic Scholar API for fresh results
4. Normalize, cache, and merge
"""

from datetime import datetime, timezone, timedelta

from backend.services.semantic_scholar import SemanticScholarClient
from backend.services.paper_normalizer import normalize_paper
from backend.services.job_store import JobStore
from backend.db import upsert_papers, search_cached_papers

# Skip API call if cached results are newer than this
CACHE_FRESHNESS_THRESHOLD = timedelta(hours=24)


def _cache_is_fresh(papers: list[dict]) -> bool:
    """Check if all cached papers were fetched within the freshness threshold."""
    if not papers:
        return False
    now = datetime.now(timezone.utc)
    for paper in papers:
        fetched_at = paper.get("fetched_at")
        if fetched_at is None:
            return False
        if isinstance(fetched_at, str):
            fetched_at = datetime.fromisoformat(fetched_at)
        if now - fetched_at > CACHE_FRESHNESS_THRESHOLD:
            return False
    return True


async def execute_search(
    query: str,
    limit: int,
    job_id: str,
    client: SemanticScholarClient,
    job_store: JobStore,
):
    """
    Run a paper search: check cache, call Semantic Scholar if needed, merge results, update job.
    """
    try:
        job_store.update_job(job_id, status="searching_cache")

        # Step 1: Check local cache
        cached = search_cached_papers(query, limit=limit)
        cached_ids = {p["s2_id"] for p in cached}

        # Step 2: If cache has enough fresh results, skip the API call
        if len(cached) >= limit and _cache_is_fresh(cached):
            job_store.update_job(
                job_id,
                status="complete",
                papers=cached[:limit],
                total=len(cached),
            )
            return

        # Step 3: Cache miss or stale — fetch from Semantic Scholar
        if cached:
            job_store.update_job(
                job_id,
                status="searching_api",
                papers=cached,
                total=len(cached),
            )

        response = await client.search_papers(query, limit=limit)
        raw_works = response.get("data") or []

        # Step 4: Normalize and deduplicate against cache
        new_papers = []
        for raw in raw_works:
            normalized = normalize_paper(raw)
            if normalized and normalized["s2_id"] not in cached_ids:
                new_papers.append(normalized)

        # Step 5: Cache new papers in Postgres
        if new_papers:
            upsert_papers(new_papers)

        # Step 6: Merge cached + new, deduplicated
        all_papers = cached + new_papers

        job_store.update_job(
            job_id,
            status="complete",
            papers=all_papers[:limit],
            total=len(all_papers),
        )

    except Exception as e:
        job_store.update_job(
            job_id,
            status="error",
            error=str(e),
        )
