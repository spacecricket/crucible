import type { SearchJob, Paper, CitationGraph, GraphJob } from "@/types/paper";

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

export async function getPaper(paperId: string): Promise<Paper> {
  const res = await fetch(`${API_BASE}/papers/${paperId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch paper: ${res.status}`);
  }
  return res.json();
}

export async function startGraphBuild(
  paperId: string,
  maxHops = 2,
): Promise<{ job_id: string }> {
  const params = new URLSearchParams({ max_hops: String(maxHops) });
  const res = await fetch(`${API_BASE}/papers/${paperId}/graph?${params}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Graph build failed: ${res.status}`);
  }
  return res.json();
}

export async function getGraphJob(jobId: string): Promise<GraphJob> {
  const res = await fetch(`${API_BASE}/papers/search/${jobId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch graph job: ${res.status}`);
  }
  return res.json();
}

export async function getCitationGraph(paperId: string): Promise<CitationGraph> {
  const res = await fetch(`${API_BASE}/papers/${paperId}/graph`);
  if (!res.ok) {
    throw new Error(`Failed to fetch graph: ${res.status}`);
  }
  return res.json();
}
