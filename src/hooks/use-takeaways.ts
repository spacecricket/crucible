"use client";

import { useState, useCallback, useRef } from "react";
import type { Paper } from "@/types/paper";

interface TakeawaysMap {
  [paperId: string]: {
    takeaways: string[];
    loading: boolean;
  };
}

/**
 * Streams per-paper takeaways from /takeaways (NDJSON).
 * Cached results arrive first, then LLM-generated ones trickle in.
 */
export function useTakeaways() {
  const [takeaways, setTakeaways] = useState<TakeawaysMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchTakeaways = useCallback(
    async (query: string, papers: Paper[]) => {
      // Abort any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const validPapers = papers.filter((p) => p.abstract || p.title);
      if (!query || validPapers.length === 0) return;

      // Initialize all papers as loading
      setTakeaways(
        Object.fromEntries(
          validPapers.map((p) => [p.s2_id, { takeaways: [], loading: true }]),
        ),
      );
      setIsLoading(true);

      try {
        const res = await fetch("/takeaways", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            papers: validPapers.map((p) => ({
              s2_id: p.s2_id,
              title: p.title,
              abstract: p.abstract,
            })),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          setIsLoading(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? ""; // keep incomplete last line

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as {
                paper_id: string;
                takeaways: string[];
              };
              setTakeaways((prev) => ({
                ...prev,
                [parsed.paper_id]: {
                  takeaways: parsed.takeaways,
                  loading: false,
                },
              }));
            } catch {
              // Skip malformed lines
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            setTakeaways((prev) => ({
              ...prev,
              [parsed.paper_id]: {
                takeaways: parsed.takeaways,
                loading: false,
              },
            }));
          } catch {
            // Skip
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      } finally {
        setIsLoading(false);
        // Mark any still-loading papers as done
        setTakeaways((prev) => {
          const updated = { ...prev };
          for (const key of Object.keys(updated)) {
            if (updated[key].loading) {
              updated[key] = { ...updated[key], loading: false };
            }
          }
          return updated;
        });
      }
    },
    [],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { takeaways, isLoading, fetchTakeaways, stop };
}
