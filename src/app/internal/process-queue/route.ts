import { PollingQueueClient } from "@vercel/queue";

interface PaperSearchMessage {
  job_id: string;
  query: string;
  limit: number;
}

const queue = new PollingQueueClient({
  region: process.env.VERCEL_REGION ?? "iad1",
});

const CONSUMER_GROUP = "paper-search-worker";
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

  for (let i = 0; i < MAX_MESSAGES_PER_INVOCATION; i++) {
    const result = await queue.receive<PaperSearchMessage>(
      "paper-search",
      CONSUMER_GROUP,
      async (message) => {
        // Call FastAPI to execute the search.
        // Always acknowledge the message — execute_search writes errors
        // to the job in Redis, so the user sees them via polling.
        // If we throw here, the queue redelivers and resets the job state.
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
          // Don't throw — let the message be acknowledged.
          // The job already has status "error" in Redis.
        }
      },
      { limit: 1 },
    );

    if (!result.ok) {
      // Queue is empty — stop polling
      break;
    }

    processed++;
  }

  return Response.json({ processed });
}
