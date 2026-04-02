"use client";

import { useState, useCallback, useRef } from "react";
import { startSearch, getSearchResults } from "@/lib/api";
import type { SearchJob } from "@/types/paper";

const POLL_INTERVAL = 1000; // 1 second
const MAX_POLLS = 120; // 2 minutes max

export function useSearch() {
  const [job, setJob] = useState<SearchJob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const search = useCallback(
    async (query: string) => {
      stopPolling();
      setIsLoading(true);
      setJob(null);

      try {
        const { job_id } = await startSearch(query);

        let polls = 0;
        const poll = async () => {
          try {
            const result = await getSearchResults(job_id);
            setJob(result);

            if (result.status === "complete" || result.status === "error") {
              setIsLoading(false);
              return;
            }

            polls++;
            if (polls >= MAX_POLLS) {
              setJob((prev) =>
                prev
                  ? { ...prev, status: "error", error: "Polling timed out" }
                  : null,
              );
              setIsLoading(false);
              return;
            }

            pollRef.current = setTimeout(poll, POLL_INTERVAL);
          } catch {
            setJob((prev) =>
              prev
                ? { ...prev, status: "error", error: "Failed to fetch results" }
                : null,
            );
            setIsLoading(false);
          }
        };

        await poll();
      } catch {
        setJob({
          status: "error",
          query,
          papers: [],
          total: 0,
          error: "Failed to start search",
          started_at: Date.now() / 1000,
        });
        setIsLoading(false);
      }
    },
    [stopPolling],
  );

  return { job, isLoading, search, stopPolling };
}
