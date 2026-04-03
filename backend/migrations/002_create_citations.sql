-- Migration 002: Create citations table for citation graph edges
-- Run against Neon via SQL Editor or psql

CREATE TABLE IF NOT EXISTS citations (
    source_id       TEXT NOT NULL,   -- the citing paper (OpenAlex ID, e.g. "W1234567")
    target_id       TEXT NOT NULL,   -- the cited paper
    hop             INTEGER NOT NULL DEFAULT 0,  -- distance from the seed paper (0 = direct)
    seed_id         TEXT NOT NULL,   -- the paper that initiated this graph build
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (source_id, target_id, seed_id)
);

-- Fast lookups: "give me all edges for this seed paper"
CREATE INDEX IF NOT EXISTS idx_citations_seed ON citations(seed_id);

-- Fast lookups: "give me all citations/references for a paper"
CREATE INDEX IF NOT EXISTS idx_citations_source ON citations(source_id);
CREATE INDEX IF NOT EXISTS idx_citations_target ON citations(target_id);
