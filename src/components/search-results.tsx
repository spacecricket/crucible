"use client";

import { PaperCard } from "@/components/paper-card";
import type { SearchJob } from "@/types/paper";

interface TakeawayState {
  takeaways: string[];
  loading: boolean;
}

interface TakeawaysMap {
  [paperId: string]: TakeawayState;
}

function StatusMessage({ status }: { status: string }) {
  const messages: Record<string, string> = {
    pending: "Queued...",
    searching_cache: "Checking cached papers...",
    searching_api: "Searching OpenAlex...",
  };

  return (
    <div className="flex items-center gap-3 py-8">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-zinc-100" />
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        {messages[status] ?? "Processing..."}
      </span>
    </div>
  );
}

export function SearchResults({
  job,
  takeaways,
}: {
  job: SearchJob;
  takeaways?: TakeawaysMap;
}) {
  if (job.status === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
        <p className="text-sm text-red-700 dark:text-red-300">
          {job.error ?? "Something went wrong"}
        </p>
      </div>
    );
  }

  const isLoading = job.status !== "complete";

  return (
    <div>
      {isLoading && <StatusMessage status={job.status} />}

      {job.papers.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {job.total} paper{job.total !== 1 ? "s" : ""} found
            {isLoading ? " so far" : ""}
          </p>
          {job.papers.map((paper) => (
            <PaperCard
              key={paper.s2_id}
              paper={paper}
              query={job.query}
              takeaway={takeaways?.[paper.s2_id]}
            />
          ))}
        </div>
      )}

      {!isLoading && job.papers.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No papers found for &ldquo;{job.query}&rdquo;
        </p>
      )}
    </div>
  );
}
