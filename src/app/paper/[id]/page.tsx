"use client";

import { useEffect, useState, use, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getPaper, getCitationGraph } from "@/lib/api";
import { useGraph } from "@/hooks/use-graph";
import { CitationList } from "@/components/citation-list";
import { CitationGraphFlow, GraphLegend } from "@/components/citation-graph-flow";
import type { Paper, CitationGraph } from "@/types/paper";

function PaperMeta({ paper }: { paper: Paper }) {
  const authorList = paper.authors?.slice(0, 5).map((a) => a.name).join(", ");
  const hasMore = (paper.authors?.length ?? 0) > 5;

  return (
    <div className="space-y-4">
      {/* Type + Year + OA badges */}
      <div className="flex flex-wrap items-center gap-2">
        {paper.publication_type && (
          <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            {paper.publication_type}
          </span>
        )}
        {paper.year && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {paper.year}
          </span>
        )}
        {paper.is_open_access && (
          <span className="text-xs font-medium text-green-600 dark:text-green-400">
            Open Access
          </span>
        )}
      </div>

      {/* Title */}
      <h1 className="text-2xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
        {paper.title}
      </h1>

      {/* Authors */}
      {authorList && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {authorList}
          {hasMore && " et al."}
        </p>
      )}

      {/* Journal */}
      {paper.journal && (
        <p className="text-sm italic text-zinc-500 dark:text-zinc-500">
          {paper.journal}
        </p>
      )}

      {/* Abstract */}
      {paper.abstract && (
        <div>
          <h2 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Abstract
          </h2>
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {paper.abstract}
          </p>
        </div>
      )}

      {/* Stats + Links */}
      <div className="flex flex-wrap gap-4 text-sm text-zinc-500 dark:text-zinc-400">
        {paper.citation_count != null && (
          <span>{paper.citation_count.toLocaleString()} citations</span>
        )}
        {paper.reference_count != null && (
          <span>{paper.reference_count.toLocaleString()} references</span>
        )}
        {paper.doi && (
          <a
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs hover:underline"
          >
            {paper.doi}
          </a>
        )}
        {paper.pdf_url && (
          <a
            href={paper.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            PDF
          </a>
        )}
      </div>

      {/* Fields of study */}
      {paper.fields_of_study && paper.fields_of_study.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {paper.fields_of_study.map((field) => (
            <span
              key={field}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {field}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function GraphStatus({ status }: { status: string }) {
  const messages: Record<string, string> = {
    pending: "Queued...",
    building_graph: "Starting graph build...",
    expanding_hop_0: "Fetching direct references & citations...",
    expanding_hop_1: "Expanding 2nd-hop connections...",
  };

  return (
    <div className="flex items-center gap-3 py-6">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-zinc-100" />
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        {messages[status] ?? "Building citation graph..."}
      </span>
    </div>
  );
}

function PaperDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: paperId } = use(params);
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const [paper, setPaper] = useState<Paper | null>(null);
  const [graph, setGraph] = useState<CitationGraph | null>(null);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"references" | "citations">(
    "references",
  );
  const [viewMode, setViewMode] = useState<"graph" | "list">("graph");
  const router = useRouter();
  const queryParam = query ? `?q=${encodeURIComponent(query)}` : "";

  const { job: graphJob, isLoading: graphLoading, buildGraph } = useGraph();

  // Fetch paper metadata
  useEffect(() => {
    getPaper(paperId)
      .then(setPaper)
      .catch((e) => setPaperError(e.message));
  }, [paperId]);

  // Try to load existing graph, or trigger a build
  useEffect(() => {
    getCitationGraph(paperId)
      .then(setGraph)
      .catch(() => {
        // No cached graph — build one
        buildGraph(paperId);
      });
  }, [paperId, buildGraph]);

  // When graph job completes, store the graph
  useEffect(() => {
    if (graphJob?.status === "complete" && graphJob.graph) {
      setGraph(graphJob.graph);
    }
  }, [graphJob]);

  if (paperError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">
            {paperError}
          </p>
        </div>
      </div>
    );
  }

  if (!paper) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-zinc-100" />
      </div>
    );
  }

  const refCount = graph
    ? graph.edges.filter(
        (e) => e.source_id === paperId && e.hop === 0,
      ).length
    : paper.reference_count ?? 0;

  const citeCount = graph
    ? graph.edges.filter(
        (e) => e.target_id === paperId && e.hop === 0,
      ).length
    : paper.citation_count ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {/* Header / Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm">
        <Link
          href="/"
          className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          Crucible
        </Link>
        {query && (
          <>
            <span className="text-zinc-300 dark:text-zinc-700">/</span>
            <Link
              href={`/search?q=${encodeURIComponent(query)}`}
              className="max-w-[260px] truncate text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              title={query}
            >
              &ldquo;{query}&rdquo;
            </Link>
          </>
        )}
        <span className="text-zinc-300 dark:text-zinc-700">/</span>
        <span className="max-w-[300px] truncate text-zinc-500 dark:text-zinc-400">
          {paper?.title ?? "Paper detail"}
        </span>
      </nav>

      {/* Paper metadata */}
      <PaperMeta paper={paper} />

      {/* Citation graph section */}
      <div className="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Citation Graph
          </h2>

          {/* View mode toggle */}
          {graph && (
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
              <button
                onClick={() => setViewMode("graph")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  viewMode === "graph"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                Graph
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  viewMode === "list"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                List
              </button>
            </div>
          )}
        </div>

        {/* Graph loading state */}
        {graphLoading && graphJob && (
          <GraphStatus status={graphJob.status} />
        )}

        {graphJob?.status === "error" && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
            <p className="text-sm text-red-700 dark:text-red-300">
              {graphJob.error ?? "Failed to build graph"}
            </p>
            <button
              onClick={() => buildGraph(paperId)}
              className="mt-2 text-sm font-medium text-red-700 hover:underline dark:text-red-300"
            >
              Retry
            </button>
          </div>
        )}

        {graph && viewMode === "graph" && (
          <>
            <CitationGraphFlow
              papers={graph.nodes}
              edges={graph.edges}
              seedId={paperId}
              onNodeClick={(id) => {
                if (id !== paperId) {
                  router.push(`/paper/${id}${queryParam}`);
                }
              }}
            />
            <GraphLegend />
          </>
        )}

        {graph && viewMode === "list" && (
          <>
            <div className="mb-4 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
              <button
                onClick={() => setActiveTab("references")}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === "references"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                References ({refCount})
              </button>
              <button
                onClick={() => setActiveTab("citations")}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === "citations"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                Citations ({citeCount})
              </button>
            </div>

            <CitationList
              papers={graph.nodes}
              edges={graph.edges}
              seedId={paperId}
              direction={activeTab}
              query={query}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function PaperDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-zinc-100" />
        </div>
      }
    >
      <PaperDetailContent params={params} />
    </Suspense>
  );
}
