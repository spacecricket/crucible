import type { SearchJob } from "@/types/paper";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export async function startSearch(query: string, limit = 20): Promise<{ job_id: string }> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${API_BASE}/papers/search?${params}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status}`);
  }
  return res.json();
}

export async function getSearchResults(jobId: string): Promise<SearchJob> {
  const res = await fetch(`${API_BASE}/papers/search/${jobId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch results: ${res.status}`);
  }
  return res.json();
}
