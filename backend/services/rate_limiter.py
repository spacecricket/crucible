import os
import asyncio
from upstash_ratelimit import Ratelimit, SlidingWindow
from upstash_redis import Redis


def create_rate_limiter() -> Ratelimit:
    """Create a global rate limiter backed by Upstash Redis."""
    redis = Redis(
        url=os.environ["UPSTASH_REDIS_REST_URL"],
        token=os.environ["UPSTASH_REDIS_REST_TOKEN"],
    )
    return Ratelimit(
        redis=redis,
        # Authenticated S2 API key: 1 RPS
        limiter=SlidingWindow(max_requests=1, window=1),
        prefix="crucible:s2",
    )


async def wait_for_rate_limit(limiter: Ratelimit, identifier: str = "global"):
    """Block until a request is allowed through the rate limiter."""
    while True:
        response = limiter.limit(identifier)
        if response.allowed:
            return
        # Wait until the reset time
        await asyncio.sleep(response.reset / 1000)
