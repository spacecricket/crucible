"use client";

import { useState, useCallback, useRef } from "react";
import { startGraphBuild, getGraphJob } from "@/lib/api";
import type { GraphJob } from "@/types/paper";

const POLL_INTERVAL = 2000; // 2 seconds (graph builds are slower)
const MAX_POLLS = 150; // 5 minutes max

export function useGraph() {
  const [job, setJob] = useState<GraphJob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const buildGraph = useCallback(
    async (paperId: string, maxHops = 2) => {
      stopPolling();
      setIsLoading(true);
      setJob(null);

      try {
        const { job_id } = await startGraphBuild(paperId, maxHops);

        let polls = 0;
        const poll = async () => {
          try {
            const result = await getGraphJob(job_id);
            setJob(result);

            if (result.status === "complete" || result.status === "error") {
              setIsLoading(false);
              return;
            }

            polls++;
            if (polls >= MAX_POLLS) {
              setJob((prev) =>
                prev
                  ? { ...prev, status: "error", error: "Graph build timed out" }
                  : null,
              );
              setIsLoading(false);
              return;
            }

            pollRef.current = setTimeout(poll, POLL_INTERVAL);
          } catch {
            setJob((prev) =>
              prev
                ? { ...prev, status: "error", error: "Failed to fetch graph status" }
                : null,
            );
            setIsLoading(false);
          }
        };

        await poll();
      } catch {
        setJob({
          status: "error",
          query: `graph:${paperId}`,
          error: "Failed to start graph build",
          started_at: Date.now() / 1000,
        });
        setIsLoading(false);
      }
    },
    [stopPolling],
  );

  return { job, isLoading, buildGraph, stopPolling };
}
