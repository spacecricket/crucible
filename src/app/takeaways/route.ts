import { generateText, Output, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod/v4";

/**
 * POST /takeaways
 *
 * Accepts {query, papers: [{s2_id, title, abstract}]}.
 * Returns NDJSON stream — each line is {paper_id, takeaways: string[]}.
 *
 * Flow:
 * 1. Check FastAPI cache for existing takeaways
 * 2. Stream cached results immediately
 * 3. Generate missing takeaways via LLM in parallel
 * 4. Stream each result as it completes
 * 5. Cache new takeaways in Postgres via FastAPI
 *
 * Auth: Uses AI Gateway (OIDC) if available, falls back to direct
 * ANTHROPIC_API_KEY if AI Gateway is not set up (e.g. no credit card).
 */

/**
 * Resolve the best available model. AI Gateway is preferred (unified billing,
 * observability), but direct provider key works for local dev.
 */
function getModel(): { model: LanguageModel; name: string } {
  return {
    model: anthropic("claude-haiku-4-5-20251001"),
    name: "anthropic/claude-haiku-4-5-20251001",
  };
}

const TakeawaySchema = z.object({
  takeaways: z
    .array(z.string())
    .describe("2-3 key takeaways from this paper relevant to the query"),
});

interface PaperInput {
  s2_id: string;
  title: string | null;
  abstract: string | null;
}

interface RequestBody {
  query: string;
  papers: PaperInput[];
}

const apiUrl = process.env.API_URL;

async function lookupCachedTakeaways(
  query: string,
  paperIds: string[],
): Promise<Record<string, string[]>> {
  if (!apiUrl || paperIds.length === 0) return {};

  try {
    const res = await fetch(`${apiUrl}/takeaways/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, paper_ids: paperIds }),
    });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

async function storeTakeaway(
  query: string,
  paperId: string,
  bullets: string[],
  modelName?: string,
): Promise<void> {
  if (!apiUrl) return;

  try {
    await fetch(`${apiUrl}/takeaways/store`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        paper_id: paperId,
        bullets,
        model: modelName ?? "unknown",
      }),
    });
  } catch {
    // Cache write failure is non-critical — we already streamed the result
  }
}

async function generateTakeaways(
  query: string,
  paper: PaperInput,
): Promise<string[]> {
  if (!paper.abstract && !paper.title) {
    return ["No abstract available for this paper."];
  }

  const { model, name: modelName } = getModel();
  console.log(`[takeaways] Generating for paper ${paper.s2_id} with model ${modelName}`);

  const result = await generateText({
    model,
    output: Output.object({ schema: TakeawaySchema }),
    prompt: `You are a research analyst. Given a research question and a paper's metadata, extract 2-3 key takeaways that are directly relevant to the question.

Research question: "${query}"

Paper title: ${paper.title ?? "Unknown"}
Abstract: ${paper.abstract ?? "No abstract available."}

Rules:
- Each takeaway should be 1-2 concise sentences.
- Be specific — cite numbers, findings, or conclusions from the abstract.
- If the paper doesn't directly address the question, say what it does cover and note the gap.
- Do NOT fabricate information not present in the abstract.`,
  });

  return result.output?.takeaways ?? ["Unable to generate takeaways."];
}

export async function POST(request: Request) {
  const body = (await request.json()) as RequestBody;
  const { query, papers } = body;

  if (!query || !papers?.length) {
    return Response.json({ error: "query and papers required" }, { status: 400 });
  }

  const paperIds = papers.map((p) => p.s2_id);

  // Step 1: Check cache
  const cached = await lookupCachedTakeaways(query, paperIds);

  // Step 2: Stream results as NDJSON
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Send cached results immediately
      for (const [paperId, takeaways] of Object.entries(cached)) {
        controller.enqueue(
          encoder.encode(JSON.stringify({ paper_id: paperId, takeaways }) + "\n"),
        );
      }

      // Generate missing takeaways in parallel
      const uncached = papers.filter((p) => !cached[p.s2_id]);

      if (uncached.length > 0) {
        const promises = uncached.map(async (paper) => {
          try {
            const takeaways = await generateTakeaways(query, paper);
            // Stream immediately
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ paper_id: paper.s2_id, takeaways }) + "\n",
              ),
            );
            // Cache in background (don't block the stream)
            const { name: usedModel } = getModel();
            storeTakeaway(query, paper.s2_id, takeaways, usedModel);
          } catch (err) {
            console.error(
              `[takeaways] Failed for paper ${paper.s2_id}:`,
              err instanceof Error ? err.message : err,
              err instanceof Error ? err.stack : "",
              JSON.stringify(err, Object.getOwnPropertyNames(err instanceof Error ? err : {})),
            );
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  paper_id: paper.s2_id,
                  takeaways: ["Failed to generate takeaways."],
                  error: true,
                }) + "\n",
              ),
            );
          }
        });

        await Promise.all(promises);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    },
  });
}
