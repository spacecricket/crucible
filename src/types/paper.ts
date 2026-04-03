export interface Paper {
  s2_id: string;
  doi: string | null;
  pubmed_id: string | null;
  arxiv_id: string | null;
  title: string | null;
  abstract: string | null;
  year: number | null;
  authors: { name: string; s2_id: string | null }[];
  journal: string | null;
  publication_type: string | null;
  citation_count: number | null;
  reference_count: number | null;
  is_open_access: boolean | null;
  pdf_url: string | null;
  fields_of_study: string[] | null;
  fetched_at: string;
}

export interface SearchJob {
  status: "pending" | "searching_cache" | "searching_api" | "complete" | "error";
  query: string;
  papers: Paper[];
  total: number;
  error: string | null;
  started_at: number;
}

export interface CitationEdge {
  source_id: string;
  target_id: string;
  hop: number;
}

export interface CitationGraph {
  nodes: Paper[];
  edges: CitationEdge[];
}

export interface GraphJob {
  status:
    | "pending"
    | "building_graph"
    | "expanding_hop_0"
    | "expanding_hop_1"
    | "complete"
    | "error";
  query: string;
  graph?: CitationGraph;
  error: string | null;
  started_at: number;
}
