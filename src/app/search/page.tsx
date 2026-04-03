"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, Suspense } from "react";
import { SearchBar } from "@/components/search-bar";
import { SearchResults } from "@/components/search-results";
import { useSearch } from "@/hooks/use-search";
import { useTakeaways } from "@/hooks/use-takeaways";

function SearchPageContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const { job, isLoading, search } = useSearch();
  const { takeaways, fetchTakeaways, stop: stopTakeaways } = useTakeaways();
  const lastQuery = useRef("");

  useEffect(() => {
    if (query && query !== lastQuery.current) {
      lastQuery.current = query;
      search(query);
    }
  }, [query, search]);

  // When search completes, trigger takeaways generation
  useEffect(() => {
    if (job?.status === "complete" && job.papers.length > 0 && job.query) {
      fetchTakeaways(job.query, job.papers);
    }
    return () => stopTakeaways();
  }, [job?.status, job?.papers, job?.query, fetchTakeaways, stopTakeaways]);

  function handleSearch(newQuery: string) {
    // Update URL without full navigation
    const url = `/search?q=${encodeURIComponent(newQuery)}`;
    window.history.pushState({}, "", url);
    lastQuery.current = newQuery;
    search(newQuery);
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-4">
        <a
          href="/"
          className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          Crucible
        </a>
        <div className="flex-1">
          <SearchBar
            onSearch={handleSearch}
            isLoading={isLoading}
            initialQuery={query}
          />
        </div>
      </div>

      {query && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Results for &ldquo;{query}&rdquo;
        </p>
      )}

      {job && <SearchResults job={job} takeaways={takeaways} />}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-zinc-100" />
        </div>
      }
    >
      <SearchPageContent />
    </Suspense>
  );
}
