import { PollingQueueClient } from "@vercel/queue";

interface PaperSearchMessage {
  job_id: string;
  query: string;
  limit: number;
}

interface CitationGraphMessage {
  job_id: string;
  paper_id: string;
  max_hops: number;
}

const queue = new PollingQueueClient({
  region: process.env.VERCEL_REGION ?? "iad1",
});

const MAX_MESSAGES_PER_INVOCATION = 10;

export async function POST(request: Request) {
  // Verify cron secret if called by Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCron =
    cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isInternal = request.headers.get("x-internal-trigger") === "true";

  if (!isCron && !isInternal) {
    return new Response("Unauthorized", { status: 401 });
  }

  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    return Response.json(
      { error: "API_URL not set" },
      { status: 500 },
    );
  }

  let processed = 0;

  // --- Drain paper-search queue ---
  for (let i = 0; i < MAX_MESSAGES_PER_INVOCATION; i++) {
    const result = await queue.receive<PaperSearchMessage>(
      "paper-search",
      "paper-search-worker",
      async (message) => {
        // Always acknowledge — execute_search writes errors to Redis.
        const response = await fetch(`${apiUrl}/execute-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: message.job_id,
            query: message.query,
            limit: message.limit,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          console.error(
            `execute-search failed (${response.status}): ${text}`,
          );
        }
      },
      { limit: 1 },
    );

    if (!result.ok) break;
    processed++;
  }

  // --- Drain citation-graph queue ---
  for (let i = 0; i < MAX_MESSAGES_PER_INVOCATION; i++) {
    const result = await queue.receive<CitationGraphMessage>(
      "citation-graph",
      "citation-graph-worker",
      async (message) => {
        // Always acknowledge — build_citation_graph writes errors to Redis.
        const response = await fetch(`${apiUrl}/execute-graph`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: message.job_id,
            paper_id: message.paper_id,
            max_hops: message.max_hops,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          console.error(
            `execute-graph failed (${response.status}): ${text}`,
          );
        }
      },
      { limit: 1 },
    );

    if (!result.ok) break;
    processed++;
  }

  return Response.json({ processed });
}
