"""
Neon Postgres connection utilities.
"""

import os
import json
from contextlib import contextmanager

import sqlalchemy
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
        return [dict(row._mapping) for row in result]
