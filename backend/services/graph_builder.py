"""
Citation graph builder — BFS traversal up to 2 hops.

Given a seed paper, fetches its references and citations (hop 0),
then fetches references/citations for each of those (hop 1).
Stores all edges in Postgres and all discovered papers in the papers cache.

Flow:
1. Fetch seed paper from OpenAlex (or cache)
2. BFS hop 0: get references + citations of seed
3. BFS hop 1: for each hop-0 paper, get its references + citations
4. Store edges + papers
5. Update job with the final graph
"""

import logging
from backend.services.openalex import OpenAlexClient
from backend.services.paper_normalizer import normalize_paper
from backend.services.job_store import JobStore
from backend.db import upsert_papers, upsert_citations, get_citation_graph, get_paper_by_id

logger = logging.getLogger(__name__)

# Limits per hop to keep API calls reasonable
MAX_REFS_PER_PAPER = 25
MAX_CITES_PER_PAPER = 25
# At hop 1, we only expand the top N most-cited papers from hop 0
MAX_HOP1_EXPAND = 10


async def build_citation_graph(
    paper_id: str,
    job_id: str,
    client: OpenAlexClient,
    job_store: JobStore,
    max_hops: int = 2,
):
    """
    Build a citation graph around a seed paper using BFS.
    Updates the job through statuses: building_graph → expanding_hop_N → complete/error.
    """
    try:
        job_store.update_job(job_id, status="building_graph")

        # --- Fetch or look up the seed paper ---
        seed = get_paper_by_id(paper_id)
        if not seed:
            # Not in cache yet — fetch from OpenAlex
            raw = await client.get_work(paper_id)
            normalized = normalize_paper(raw)
            if normalized:
                upsert_papers([normalized])
                seed = normalized

        if not seed:
            job_store.update_job(
                job_id, status="error", error=f"Paper {paper_id} not found"
            )
            return

        # --- BFS: hop 0 (direct references + citations of the seed) ---
        job_store.update_job(job_id, status="expanding_hop_0")

        hop0_edges, hop0_papers = await _expand_paper(
            paper_id, seed_id=paper_id, hop=0, client=client
        )

        # Store hop 0 results
        if hop0_papers:
            upsert_papers(hop0_papers)
        if hop0_edges:
            upsert_citations(hop0_edges)

        if max_hops < 2:
            # Only 1-hop graph requested
            graph = get_citation_graph(paper_id)
            job_store.update_job(
                job_id,
                status="complete",
                graph=graph,
            )
            return

        # --- BFS: hop 1 (references + citations of hop-0 papers) ---
        job_store.update_job(job_id, status="expanding_hop_1")

        # Pick the most-cited hop-0 papers to expand (avoid exploding the graph)
        hop0_ids = _unique_neighbor_ids(hop0_edges, exclude={paper_id})
        hop0_to_expand = _pick_top_papers(hop0_ids, hop0_papers, MAX_HOP1_EXPAND)

        all_hop1_edges = []
        all_hop1_papers = []

        for neighbor_id in hop0_to_expand:
            edges, papers = await _expand_paper(
                neighbor_id, seed_id=paper_id, hop=1, client=client
            )
            all_hop1_edges.extend(edges)
            all_hop1_papers.extend(papers)

        # Batch store hop 1
        if all_hop1_papers:
            upsert_papers(all_hop1_papers)
        if all_hop1_edges:
            upsert_citations(all_hop1_edges)

        # --- Done: read back the full graph ---
        graph = get_citation_graph(paper_id)
        job_store.update_job(
            job_id,
            status="complete",
            graph=graph,
        )

    except Exception as e:
        logger.exception("Graph build failed for %s", paper_id)
        job_store.update_job(
            job_id,
            status="error",
            error=str(e),
        )


async def _expand_paper(
    paper_id: str,
    seed_id: str,
    hop: int,
    client: OpenAlexClient,
) -> tuple[list[dict], list[dict]]:
    """
    Fetch references and citations for a single paper.
    Returns (edges, normalized_papers).
    """
    edges = []
    papers = []

    # References: papers this paper cites (paper_id → ref_id)
    try:
        ref_response = await client.get_references(paper_id, limit=MAX_REFS_PER_PAPER)
        for raw_work in ref_response.get("results", []):
            normalized = normalize_paper(raw_work)
            if normalized:
                edges.append({
                    "source_id": paper_id,
                    "target_id": normalized["s2_id"],
                    "hop": hop,
                    "seed_id": seed_id,
                })
                papers.append(normalized)
    except Exception as e:
        logger.warning("Failed to get references for %s: %s", paper_id, e)

    # Citations: papers that cite this paper (citing_id → paper_id)
    try:
        cite_response = await client.get_citations(paper_id, limit=MAX_CITES_PER_PAPER)
        for raw_work in cite_response.get("results", []):
            normalized = normalize_paper(raw_work)
            if normalized:
                edges.append({
                    "source_id": normalized["s2_id"],
                    "target_id": paper_id,
                    "hop": hop,
                    "seed_id": seed_id,
                })
                papers.append(normalized)
    except Exception as e:
        logger.warning("Failed to get citations for %s: %s", paper_id, e)

    return edges, papers


def _unique_neighbor_ids(edges: list[dict], exclude: set[str]) -> list[str]:
    """Extract unique paper IDs from edges, excluding the given set."""
    ids = set()
    for edge in edges:
        ids.add(edge["source_id"])
        ids.add(edge["target_id"])
    return [pid for pid in ids if pid not in exclude]


def _pick_top_papers(
    paper_ids: list[str],
    papers: list[dict],
    limit: int,
) -> list[str]:
    """
    From the discovered papers, pick the top N by citation count.
    This keeps the graph focused on the most impactful neighbors.
    """
    # Build a lookup: id → citation_count
    cite_counts = {}
    for p in papers:
        cite_counts[p["s2_id"]] = p.get("citation_count") or 0

    # Sort by citation count descending, take top N
    ranked = sorted(paper_ids, key=lambda pid: cite_counts.get(pid, 0), reverse=True)
    return ranked[:limit]
