import { PollingQueueClient } from "@vercel/queue";

export const queue = new PollingQueueClient({
  region: process.env.VERCEL_REGION ?? "iad1",
});
