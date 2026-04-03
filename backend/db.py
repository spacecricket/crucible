"""
Neon Postgres connection utilities.
"""

import os
import json
from contextlib import contextmanager
from datetime import datetime, date

from sqlalchemy import create_engine, text


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(
            os.environ["DATABASE_URL"],
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
        )
    return _engine


@contextmanager
def get_connection():
    engine = get_engine()
    with engine.connect() as conn:
        yield conn


def upsert_papers(papers: list[dict]):
    """
    Insert papers into the cache table, skip conflicts (already cached).
    """
    if not papers:
        return

    with get_connection() as conn:
        for paper in papers:
            conn.execute(
                text("""
                    INSERT INTO papers (
                        s2_id, doi, pubmed_id, arxiv_id, title, abstract,
                        year, authors, journal, publication_type,
                        citation_count, reference_count, is_open_access,
                        pdf_url, fields_of_study, fetched_at
                    ) VALUES (
                        :s2_id, :doi, :pubmed_id, :arxiv_id, :title, :abstract,
                        :year, :authors, :journal, :publication_type,
                        :citation_count, :reference_count, :is_open_access,
                        :pdf_url, :fields_of_study, NOW()
                    )
                    ON CONFLICT (s2_id) DO UPDATE SET
                        citation_count = EXCLUDED.citation_count,
                        reference_count = EXCLUDED.reference_count,
                        fetched_at = NOW()
                """),
                {
                    **paper,
                    "authors": json.dumps(paper["authors"]),
                    "fields_of_study": json.dumps(paper["fields_of_study"]),
                },
            )
        conn.commit()


def search_cached_papers(query: str, limit: int = 20) -> list[dict]:
    """
    Search our local cache using Postgres full-text search.
    Returns papers matching the query, ranked by relevance.
    """
    with get_connection() as conn:
        result = conn.execute(
            text("""
                SELECT *,
                    ts_rank(
                        to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(abstract, '')),
                        plainto_tsquery('english', :query)
                    ) AS rank
                FROM papers
                WHERE to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(abstract, ''))
                    @@ plainto_tsquery('english', :query)
                ORDER BY rank DESC
                LIMIT :limit
            """),
            {"query": query, "limit": limit},
        )
        return [_serialize_row(row._mapping) for row in result]


def upsert_citations(edges: list[dict]):
    """
    Insert citation edges into the citations table, skip conflicts.
    Each edge is: {source_id, target_id, hop, seed_id}
    """
    if not edges:
        return

    with get_connection() as conn:
        for edge in edges:
            conn.execute(
                text("""
                    INSERT INTO citations (source_id, target_id, hop, seed_id)
                    VALUES (:source_id, :target_id, :hop, :seed_id)
                    ON CONFLICT (source_id, target_id, seed_id) DO NOTHING
                """),
                edge,
            )
        conn.commit()


def get_citation_graph(seed_id: str) -> dict:
    """
    Retrieve the full citation graph for a seed paper.
    Returns {nodes: [{paper data}], edges: [{source_id, target_id, hop}]}
    """
    with get_connection() as conn:
        # Get all edges
        edge_result = conn.execute(
            text("""
                SELECT source_id, target_id, hop
                FROM citations
                WHERE seed_id = :seed_id
                ORDER BY hop, source_id
            """),
            {"seed_id": seed_id},
        )
        edges = [dict(row._mapping) for row in edge_result]

        if not edges:
            return {"nodes": [], "edges": []}

        # Collect all unique paper IDs from edges
        paper_ids = set()
        for edge in edges:
            paper_ids.add(edge["source_id"])
            paper_ids.add(edge["target_id"])
        # Include the seed itself
        paper_ids.add(seed_id)

        # Fetch paper metadata for all nodes
        placeholders = ", ".join(f":id_{i}" for i in range(len(paper_ids)))
        params = {f"id_{i}": pid for i, pid in enumerate(paper_ids)}
        node_result = conn.execute(
            text(f"""
                SELECT * FROM papers WHERE s2_id IN ({placeholders})
            """),
            params,
        )
        nodes = [_serialize_row(row._mapping) for row in node_result]

        return {"nodes": nodes, "edges": edges}


def get_paper_by_id(paper_id: str) -> dict | None:
    """Fetch a single paper from the cache by its ID."""
    with get_connection() as conn:
        result = conn.execute(
            text("SELECT * FROM papers WHERE s2_id = :paper_id"),
            {"paper_id": paper_id},
        )
        row = result.fetchone()
        if row is None:
            return None
        return _serialize_row(row._mapping)


def get_cached_takeaways(query: str, paper_ids: list[str]) -> dict[str, list[str]]:
    """
    Look up cached takeaways for a batch of papers + query.
    Returns {paper_id: [bullet1, bullet2, ...]} for papers that have cached takeaways.
    """
    if not paper_ids:
        return {}

    with get_connection() as conn:
        placeholders = ", ".join(f":id_{i}" for i in range(len(paper_ids)))
        params = {f"id_{i}": pid for i, pid in enumerate(paper_ids)}
        params["query"] = query.strip().lower()

        result = conn.execute(
            text(f"""
                SELECT paper_id, bullets
                FROM takeaways
                WHERE query = :query AND paper_id IN ({placeholders})
            """),
            params,
        )
        return {row.paper_id: row.bullets for row in result}


def upsert_takeaway(paper_id: str, query: str, bullets: list[str], model: str | None = None):
    """Store or update a takeaway for a paper + query pair."""
    with get_connection() as conn:
        conn.execute(
            text("""
                INSERT INTO takeaways (paper_id, query, bullets, model)
                VALUES (:paper_id, :query, :bullets, :model)
                ON CONFLICT (paper_id, query) DO UPDATE SET
                    bullets = EXCLUDED.bullets,
                    model = EXCLUDED.model,
                    created_at = NOW()
            """),
            {
                "paper_id": paper_id,
                "query": query.strip().lower(),
                "bullets": json.dumps(bullets),
                "model": model,
            },
        )
        conn.commit()


def _serialize_row(mapping) -> dict:
    """Convert a SQLAlchemy row mapping to a JSON-safe dict."""
    result = {}
    for key, value in dict(mapping).items():
        if isinstance(value, (datetime, date)):
            result[key] = value.isoformat()
        else:
            result[key] = value
    return result
