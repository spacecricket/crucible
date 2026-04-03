import os
import time
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from upstash_redis import Redis

from backend.services.openalex import OpenAlexClient
from backend.services.job_store import JobStore
from backend.services.paper_search import execute_search
from backend.services.graph_builder import build_citation_graph
from backend.services.queue_publisher import QueuePublisher
from backend.db import get_paper_by_id, get_citation_graph, get_cached_takeaways, upsert_takeaway


# --- App state initialized at startup ---

openalex_client: OpenAlexClient | None = None
job_store: JobStore | None = None
queue: QueuePublisher | None = None

JOB_TIMEOUT_SECONDS = 120


@asynccontextmanager
async def lifespan(app: FastAPI):
    global openalex_client, job_store, queue

    # Startup
    redis = Redis(
        url=os.environ["UPSTASH_REDIS_REST_URL"],
        token=os.environ["UPSTASH_REDIS_REST_TOKEN"],
    )
    openalex_client = OpenAlexClient()
    job_store = JobStore(redis)
    queue = QueuePublisher()

    yield

    # Shutdown
    if openalex_client:
        await openalex_client.close()


app = FastAPI(
    title="Crucible API",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/papers/search")
async def start_search(q: str, limit: int = 20):
    """
    Start a paper search. Returns a job ID to poll for results.
    Publishes to Vercel Queue, then triggers the poll consumer immediately.
    """
    job_id = job_store.create_job(q)

    await queue.publish("paper-search", {
        "job_id": job_id,
        "query": q,
        "limit": limit,
    })

    # Trigger the poll consumer immediately so the user doesn't wait for cron.
    # Fire-and-forget — if this fails, the cron will pick it up within 1 minute.
    web_url = os.environ.get("WEB_URL", "")
    if web_url:
        try:
            import httpx
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{web_url}/internal/process-queue",
                    headers={"x-internal-trigger": "true"},
                    timeout=1.0,  # don't block the response on this
                )
        except Exception:
            pass  # cron will handle it

    return {"job_id": job_id}


class ExecuteSearchRequest(BaseModel):
    job_id: str
    query: str
    limit: int = 20


@app.post("/execute-search")
async def execute_search_endpoint(req: ExecuteSearchRequest):
    """
    Internal endpoint called by the Vercel Queue consumer.
    Runs the search, caches results, updates the job.
    """
    await execute_search(
        query=req.query,
        limit=req.limit,
        job_id=req.job_id,
        client=openalex_client,
        job_store=job_store,
    )

    return {"status": "ok"}


@app.get("/papers/search/{job_id}")
async def get_search_results(job_id: str):
    """
    Poll for search results by job ID.
    Detects stuck jobs that have been processing too long.
    """
    job = job_store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")

    # Detect stuck jobs
    if job["status"] not in ("complete", "error"):
        started_at = job.get("started_at")
        if started_at and (time.time() - started_at) > JOB_TIMEOUT_SECONDS:
            job_store.update_job(
                job_id, status="error", error="Job timed out — please retry"
            )
            job["status"] = "error"
            job["error"] = "Job timed out — please retry"

    return job


# ─── Paper detail ────────────────────────────────────────────────

@app.get("/papers/{paper_id}")
async def get_paper(paper_id: str):
    """Get a single paper by ID. Fetches from OpenAlex if not cached."""
    paper = get_paper_by_id(paper_id)
    if paper:
        return paper

    # Not cached — try fetching from OpenAlex
    try:
        from backend.services.paper_normalizer import normalize_paper
        from backend.db import upsert_papers

        raw = await openalex_client.get_work(paper_id)
        normalized = normalize_paper(raw)
        if normalized:
            upsert_papers([normalized])
            return normalized
    except Exception:
        pass

    raise HTTPException(status_code=404, detail="Paper not found")


# ─── Citation graph ──────────────────────────────────────────────

@app.post("/papers/{paper_id}/graph")
async def start_graph_build(paper_id: str, max_hops: int = 2):
    """
    Start building a citation graph around a paper.
    Returns a job ID to poll for results.
    """
    job_id = job_store.create_job(f"graph:{paper_id}")

    await queue.publish("citation-graph", {
        "job_id": job_id,
        "paper_id": paper_id,
        "max_hops": min(max_hops, 2),
    })

    # Fire-and-forget trigger for the poll consumer
    web_url = os.environ.get("WEB_URL", "")
    if web_url:
        try:
            import httpx
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{web_url}/internal/process-queue",
                    headers={"x-internal-trigger": "true"},
                    timeout=1.0,
                )
        except Exception:
            pass

    return {"job_id": job_id}


class BuildGraphRequest(BaseModel):
    job_id: str
    paper_id: str
    max_hops: int = 2


@app.post("/execute-graph")
async def execute_graph_endpoint(req: BuildGraphRequest):
    """
    Internal endpoint called by the Vercel Queue consumer.
    Builds the citation graph, caches results, updates the job.
    """
    await build_citation_graph(
        paper_id=req.paper_id,
        job_id=req.job_id,
        client=openalex_client,
        job_store=job_store,
        max_hops=req.max_hops,
    )
    return {"status": "ok"}


@app.get("/papers/{paper_id}/graph")
async def get_graph(paper_id: str):
    """
    Get the citation graph for a paper (if already built).
    Returns {nodes: [...], edges: [...]}.
    """
    graph = get_citation_graph(paper_id)
    if not graph["nodes"] and not graph["edges"]:
        raise HTTPException(status_code=404, detail="Graph not found — build it first")
    return graph


# ─── Takeaways cache ─────────────────────────────────────────────

class TakeawaysLookupRequest(BaseModel):
    query: str
    paper_ids: list[str]


@app.post("/takeaways/lookup")
async def lookup_takeaways(req: TakeawaysLookupRequest):
    """
    Batch lookup cached takeaways for papers + query.
    Returns {paper_id: [bullet, ...]} for papers that have cached takeaways.
    """
    cached = get_cached_takeaways(req.query, req.paper_ids)
    return cached


class TakeawaysStoreRequest(BaseModel):
    query: str
    paper_id: str
    bullets: list[str]
    model: str | None = None


@app.post("/takeaways/store")
async def store_takeaway(req: TakeawaysStoreRequest):
    """Store a single paper's takeaways in the cache."""
    upsert_takeaway(req.paper_id, req.query, req.bullets, req.model)
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5001, reload=True)
