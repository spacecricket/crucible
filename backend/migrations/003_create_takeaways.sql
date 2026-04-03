-- Migration 003: Create takeaways table for query-specific paper takeaways
-- Run against Neon via SQL Editor or psql
--
-- Takeaways are LLM-generated bullet points summarizing a paper's
-- relevance to a specific research question. Same paper can have
-- different takeaways for different queries.

CREATE TABLE IF NOT EXISTS takeaways (
    paper_id    TEXT NOT NULL,
    query       TEXT NOT NULL,
    bullets     JSONB NOT NULL,       -- ["takeaway 1", "takeaway 2", ...]
    model       TEXT,                 -- which LLM generated these
    created_at  TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (paper_id, query)
);

-- Fast lookup: "get all takeaways for this query"
CREATE INDEX IF NOT EXISTS idx_takeaways_query ON takeaways(query);
