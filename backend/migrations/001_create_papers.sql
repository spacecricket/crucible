-- Migration 001: Create papers table
-- Run against Neon via SQL Editor or psql

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS papers (
    s2_id           TEXT PRIMARY KEY,
    doi             TEXT,
    pubmed_id       TEXT,
    arxiv_id        TEXT,
    title           TEXT,
    abstract        TEXT,
    year            INTEGER,
    authors         JSONB,
    journal         TEXT,
    publication_type TEXT,
    citation_count  INTEGER,
    reference_count INTEGER,
    is_open_access  BOOLEAN,
    pdf_url         TEXT,
    fields_of_study JSONB,
    fetched_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
