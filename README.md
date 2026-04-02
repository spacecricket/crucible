# Crucible

Evaluate scientific rigor by tracing claims through citation graphs and scoring the strength of evidence.

## Architecture

Crucible is a monorepo deployed on Vercel using [Services](https://vercel.com/docs/services):

- **Next.js frontend** at `/` — search UI, graph visualization
- **FastAPI backend** at `/api` — paper search, S2 client, rigor scoring

### External Services

- **Neon** — Postgres + pgvector (paper cache, citation graph)
- **Upstash Redis** — rate limiting + job state
- **OpenAlex API** — paper search, metadata, citations (primary, free, 10 req/sec)
- **Semantic Scholar API** — paper search, metadata, citations (secondary, pending API key)
- **Vercel Queues** — durable async job processing (poll mode)

## Search Flow

### User-initiated search

```
Browser                          Vercel (Next.js)              Vercel (FastAPI)            External
  |                                   |                              |                        |
  |  POST /api/papers/search?q=...    |                              |                        |
  |---------------------------------->|----------------------------->|                        |
  |                                   |                              |                        |
  |                                   |              create job in Redis (status: pending)     |
  |                                   |                              |                        |
  |                                   |              publish message to Vercel Queue           |
  |                                   |                              |----> [Queue: paper-search]
  |                                   |                              |                        |
  |                                   |    fire-and-forget POST /api/process-queue             |
  |                                   |<-----------------------------|                        |
  |                                   |                              |                        |
  |         { job_id: "abc123" }      |                              |                        |
  |<----------------------------------|<-----------------------------|                        |
  |                                   |                              |                        |
  |                                   |  /api/process-queue          |                        |
  |                                   |  (poll consumer picks up     |                        |
  |                                   |   message from queue)        |                        |
  |                                   |         POST /api/execute-search                      |
  |                                   |----------------------------->|                        |
  |                                   |                              |                        |
  |                                   |                              |  check Postgres cache   |
  |                                   |                              |  (fresh enough? done)   |
  |                                   |                              |                        |
  |                                   |                              |  GET OpenAlex API       |
  |                                   |                              |----------------------->|
  |                                   |                              |  (10 req/sec polite)    |
  |                                   |                              |<-----------------------|
  |                                   |                              |                        |
  |                                   |                              |  normalize + upsert     |
  |                                   |                              |  into Postgres cache    |
  |                                   |                              |                        |
  |                                   |                              |  update job in Redis    |
  |                                   |                              |  (status: complete)     |
  |                                   |                              |                        |
  |  GET /api/papers/search/abc123    |                              |                        |
  |  (polling)                        |                              |                        |
  |---------------------------------->|----------------------------->|                        |
  |                                   |                              |  read job from Redis    |
  |  { status: "complete",            |                              |                        |
  |    papers: [...] }                |                              |                        |
  |<----------------------------------|<-----------------------------|                        |
```

### Cron-initiated processing (safety net)

```
Cron (every 1 min)               Vercel (Next.js)              Vercel (FastAPI)
  |                                   |                              |
  |  POST /api/process-queue          |                              |
  |---------------------------------->|                              |
  |                                   |                              |
  |                                   |  poll Queue for message      |
  |                                   |----> [Queue: paper-search]   |
  |                                   |                              |
  |                                   |  (if message found)          |
  |                                   |  POST /api/execute-search    |
  |                                   |----------------------------->|
  |                                   |                              |
  |                                   |                              |  (same flow as above:
  |                                   |                              |   cache check, S2 call,
  |                                   |                              |   normalize, upsert,
  |                                   |                              |   update job in Redis)
  |                                   |                              |
  |                                   |  loop until queue empty      |
  |                                   |  (max 10 per invocation)     |
  |                                   |                              |
  |  { processed: N }                 |                              |
  |<----------------------------------|                              |
```

The cron ensures no messages are stuck in the queue if the fire-and-forget trigger from the search endpoint fails.

## Job Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Job created, message published to queue, waiting for consumer |
| `searching_cache` | Consumer picked up job, checking Postgres for cached papers |
| `searching_api` | Cache miss or stale, calling Semantic Scholar API |
| `complete` | Search finished, `papers` and `total` populated |
| `error` | Failed or timed out (2 min threshold), `error` has details |

## Local Development

```bash
# Frontend
pnpm dev

# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py

# Pull env vars (Neon, Upstash, OIDC)
vercel link && vercel env pull .env.local
```

## Project Structure

```
crucible/
├── src/
│   ├── app/
│   │   ├── page.tsx                         # Landing page
│   │   └── api/
│   │       └── process-queue/
│   │           └── route.ts                 # Poll-mode queue consumer
│   └── lib/
│       └── queue.ts                         # PollingQueueClient setup
├── backend/
│   ├── main.py                              # FastAPI app
│   ├── db.py                                # Neon Postgres connection + queries
│   ├── migrations/
│   │   └── 001_create_papers.sql
│   └── services/
│       ├── openalex.py                      # OpenAlex API client (primary)
│       ├── semantic_scholar.py              # S2 API client (secondary, rate limited)
│       ├── paper_search.py                  # Search orchestration
│       ├── paper_normalizer.py              # API response → DB schema (OpenAlex + S2)
│       ├── rate_limiter.py                  # Upstash-backed rate limiter
│       ├── job_store.py                     # Redis-backed job state
│       └── queue_publisher.py               # Publish to Vercel Queues (REST API)
└── vercel.json                              # Services config
```
