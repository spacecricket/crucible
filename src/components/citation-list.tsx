"use client";

import Link from "next/link";
import type { Paper, CitationEdge } from "@/types/paper";

interface CitationListProps {
  papers: Paper[];
  edges: CitationEdge[];
  seedId: string;
  direction: "references" | "citations";
  query?: string;
}

export function CitationList({
  papers,
  edges,
  seedId,
  direction,
  query,
}: CitationListProps) {
  // Filter edges to get direct (hop 0) connections in the right direction
  const relevantEdges = edges.filter((e) => {
    if (direction === "references") {
      // Seed paper cites these (source=seed → target=ref)
      return e.source_id === seedId && e.hop === 0;
    }
    // These cite the seed paper (source=citing → target=seed)
    return e.target_id === seedId && e.hop === 0;
  });

  const relevantIds = new Set(
    relevantEdges.map((e) =>
      direction === "references" ? e.target_id : e.source_id,
    ),
  );

  const relevantPapers = papers
    .filter((p) => relevantIds.has(p.s2_id))
    .sort((a, b) => (b.citation_count ?? 0) - (a.citation_count ?? 0));

  if (relevantPapers.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No {direction} found.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {relevantPapers.map((paper) => (
        <Link
          key={paper.s2_id}
          href={`/paper/${paper.s2_id}${query ? `?q=${encodeURIComponent(query)}` : ""}`}
          className="block rounded-lg border border-zinc-200 p-3 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
        >
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {paper.title}
          </p>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            {paper.year && <span>{paper.year}</span>}
            {paper.citation_count != null && (
              <span>{paper.citation_count.toLocaleString()} citations</span>
            )}
            {paper.journal && (
              <span className="italic">{paper.journal}</span>
            )}
          </div>
          {paper.authors && paper.authors.length > 0 && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {paper.authors
                .slice(0, 3)
                .map((a) => a.name)
                .join(", ")}
              {paper.authors.length > 3 && " et al."}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}
