"""
Job state management backed by Upstash Redis.

Jobs track async search operations so the frontend can poll for progress.

Job statuses:
    "pending"         - Job created, message published to queue, waiting for consumer pickup.
    "searching_cache" - Consumer picked up the job, checking Postgres cache for existing papers.
    "searching_api"   - Cache checked, now calling Semantic Scholar API for fresh results.
    "complete"        - Search finished successfully. `papers` and `total` are populated.
    "error"           - Something went wrong. `error` contains a human-readable message.
                        Also set by the polling endpoint if a job exceeds the timeout threshold.
"""

import json
import time
import uuid
from upstash_redis import Redis


class JobStore:
    def __init__(self, redis: Redis):
        self.redis = redis
        self.ttl = 60 * 30  # jobs expire after 30 minutes

    def create_job(self, query: str) -> str:
        """Create a new job, return its ID."""
        job_id = str(uuid.uuid4())
        self.redis.set(
            f"crucible:job:{job_id}",
            json.dumps({
                "status": "pending",
                "query": query,
                "papers": [],
                "total": 0,
                "error": None,
                "started_at": time.time(),
            }),
            ex=self.ttl,
        )
        return job_id

    def update_job(self, job_id: str, **kwargs):
        """Update specific fields on a job."""
        key = f"crucible:job:{job_id}"
        raw = self.redis.get(key)
        if raw is None:
            return
        data = json.loads(raw)
        data.update(kwargs)
        self.redis.set(key, json.dumps(data), ex=self.ttl)

    def get_job(self, job_id: str) -> dict | None:
        """Get job state. Returns None if expired or not found."""
        raw = self.redis.get(f"crucible:job:{job_id}")
        if raw is None:
            return None
        return json.loads(raw)
