import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Union
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from upstash_redis import Redis

from backend.services.semantic_scholar import SemanticScholarClient
from backend.services.job_store import JobStore
from backend.services.paper_search import execute_search
from backend.services.graph_builder import build_citation_graph
from backend.services.rate_limiter import create_rate_limiter
from backend.db import get_paper_by_id, get_citation_graph, get_cached_takeaways, upsert_takeaway

logger = logging.getLogger(__name__)

# ─── In-process work queue ────────────────────────────────────────
#
# On Fly.io we run a persistent process, so we don't need an external
# queue service. Jobs are enqueued in-memory and drained by a single
# background asyncio task, which naturally serializes S2 API calls
# and respects the rate limiter.
#
# If the process restarts mid-job, the job stays in Redis as
# "pending/searching_*" and times out on the next poll — the user
# can retry. Good enough for a side project.

@dataclass
class PaperSearchWork:
    job_id: str
    query: str
    limit: int


@dataclass
class GraphBuildWork:
    job_id: str
    paper_id: str
    max_hops: int


WorkItem = Union[PaperSearchWork, GraphBuildWork]

_work_queue: asyncio.Queue[WorkItem] = asyncio.Queue()


async def _worker(client: SemanticScholarClient, jobs: JobStore):
    """
    Background worker — runs for the lifetime of the process.
    Drains _work_queue one item at a time, so S2 rate limiting is
    respected without any external coordination.
    """
    logger.info("Worker started")
    while True:
        item = await _work_queue.get()
        try:
            if isinstance(item, PaperSearchWork):
                await execute_search(
                    query=item.query,
                    limit=item.limit,
                    job_id=item.job_id,
                    client=client,
                    job_store=jobs,
                )
            elif isinstance(item, GraphBuildWork):
                await build_citation_graph(
                    paper_id=item.paper_id,
                    job_id=item.job_id,
                    client=client,
                    job_store=jobs,
                    max_hops=item.max_hops,
                )
        except Exception:
            logger.exception("Worker error processing %s", item)
        finally:
            _work_queue.task_done()


# ─── App state ───────────────────────────────────────────────────

s2_client: SemanticScholarClient | None = None
job_store: JobStore | None = None
JOB_TIMEOUT_SECONDS = 120


@asynccontextmanager
async def lifespan(app: FastAPI):
    global s2_client, job_store

    redis = Redis(
        url=os.environ["UPSTASH_REDIS_REST_URL"],
        token=os.environ["UPSTASH_REDIS_REST_TOKEN"],
    )
    s2_client = SemanticScholarClient(rate_limiter=create_rate_limiter())
    job_store = JobStore(redis)

    # Start the background worker
    worker_task = asyncio.create_task(_worker(s2_client, job_store))

    yield

    # Shutdown: cancel worker and close S2 client
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    await s2_client.close()


app = FastAPI(
    title="Crucible API",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {"status": "ok", "queue_depth": _work_queue.qsize()}


# ─── Paper search ─────────────────────────────────────────────────

@app.post("/papers/search")
async def start_search(q: str, limit: int = 20):
    """
    Start a paper search. Creates a job, enqueues work, returns job_id immediately.
    """
    job_id = job_store.create_job(q)
    await _work_queue.put(PaperSearchWork(job_id=job_id, query=q, limit=limit))
    return {"job_id": job_id}


@app.get("/papers/search/{job_id}")
async def get_search_results(job_id: str):
    """
    Poll for search results by job ID.
    Detects stuck jobs that have been processing too long.
    """
    job = job_store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")

    if job["status"] not in ("complete", "error"):
        started_at = job.get("started_at")
        if started_at and (time.time() - started_at) > JOB_TIMEOUT_SECONDS:
            job_store.update_job(
                job_id, status="error", error="Job timed out — please retry"
            )
            job["status"] = "error"
            job["error"] = "Job timed out — please retry"

    return job


# ─── Paper detail ─────────────────────────────────────────────────

@app.get("/papers/{paper_id}")
async def get_paper(paper_id: str):
    """Get a single paper by ID. Fetches from Semantic Scholar if not cached."""
    paper = get_paper_by_id(paper_id)
    if paper:
        return paper

    try:
        from backend.services.paper_normalizer import normalize_paper
        from backend.db import upsert_papers

        raw = await s2_client.get_paper(paper_id)
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
    await _work_queue.put(GraphBuildWork(
        job_id=job_id,
        paper_id=paper_id,
        max_hops=min(max_hops, 2),
    ))
    return {"job_id": job_id}


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
    cached = get_cached_takeaways(req.query, req.paper_ids)
    return cached


class TakeawaysStoreRequest(BaseModel):
    query: str
    paper_id: str
    bullets: list[str]
    model: str | None = None


@app.post("/takeaways/store")
async def store_takeaway(req: TakeawaysStoreRequest):
    upsert_takeaway(req.paper_id, req.query, req.bullets, req.model)
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8080, reload=True)
