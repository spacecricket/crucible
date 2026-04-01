"""
Publish messages to Vercel Queues from Python via the REST API.

Works both on Vercel and locally (after running `vercel env pull`
to get OIDC credentials).
"""

import os
import json
import httpx


class QueuePublisher:
    def __init__(self):
        self.region = os.environ.get("VERCEL_REGION", "iad1")
        self.base_url = f"https://{self.region}.vercel-queue.com/api/v3"

    def _get_oidc_token(self) -> str | None:
        """Read OIDC token from env. Available on Vercel and locally via `vercel env pull`."""
        return os.environ.get("VERCEL_OIDC_TOKEN")

    async def publish(self, topic: str, message: dict) -> str:
        """
        Publish a message to a Vercel Queue topic.
        Raises if OIDC token is missing or the publish fails.
        """
        oidc_token = self._get_oidc_token()
        if not oidc_token:
            raise RuntimeError(
                "VERCEL_OIDC_TOKEN not found. "
                "Run `vercel link && vercel env pull` to set up local credentials."
            )

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/topic/{topic}",
                headers={
                    "Authorization": f"Bearer {oidc_token}",
                    "Content-Type": "application/json",
                },
                content=json.dumps(message),
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("messageId")
