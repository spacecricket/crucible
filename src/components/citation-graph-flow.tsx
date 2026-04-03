"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Paper, CitationEdge } from "@/types/paper";

// ── Layout helpers ──────────────────────────────────────────────

/**
 * Place nodes in concentric rings:
 *   - Seed at (0, 0)
 *   - Hop-0 neighbors on a ring of radius R0
 *   - Hop-1 neighbors on a ring of radius R1
 */
function concentricLayout(
  seedId: string,
  papers: Paper[],
  edges: CitationEdge[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Classify each paper by minimum hop distance from seed
  const hopMap = new Map<string, number>();
  hopMap.set(seedId, -1); // seed = special

  for (const e of edges) {
    const neighbor = e.source_id === seedId ? e.target_id : e.target_id === seedId ? e.source_id : null;
    if (neighbor && !hopMap.has(neighbor)) {
      hopMap.set(neighbor, e.hop);
    }
  }
  // Any paper not yet placed is hop-1 (connected to a hop-0 paper, not seed directly)
  for (const p of papers) {
    if (!hopMap.has(p.s2_id)) {
      hopMap.set(p.s2_id, 1);
    }
  }

  const hop0 = papers.filter((p) => hopMap.get(p.s2_id) === 0);
  const hop1 = papers.filter((p) => hopMap.get(p.s2_id) === 1);

  // Seed at center
  positions.set(seedId, { x: 0, y: 0 });

  // Hop-0 ring
  const R0 = 350;
  hop0.forEach((p, i) => {
    const angle = (2 * Math.PI * i) / Math.max(hop0.length, 1);
    positions.set(p.s2_id, {
      x: R0 * Math.cos(angle),
      y: R0 * Math.sin(angle),
    });
  });

  // Hop-1 ring
  const R1 = 700;
  hop1.forEach((p, i) => {
    const angle = (2 * Math.PI * i) / Math.max(hop1.length, 1);
    positions.set(p.s2_id, {
      x: R1 * Math.cos(angle),
      y: R1 * Math.sin(angle),
    });
  });

  return positions;
}

// ── Node styling ────────────────────────────────────────────────

function truncate(text: string | null, maxLen: number): string {
  if (!text) return "Untitled";
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "\u2026" : text;
}

/** Map citation count to a node pixel size (width). */
function nodeWidth(citationCount: number | null): number {
  const c = citationCount ?? 0;
  // log scale, clamped between 140 and 260
  return Math.min(260, Math.max(140, 140 + Math.log10(c + 1) * 30));
}

type NodeRole = "seed" | "reference" | "citation" | "hop1";

function roleColor(role: NodeRole): { bg: string; border: string; text: string } {
  switch (role) {
    case "seed":
      return { bg: "#fef3c7", border: "#f59e0b", text: "#78350f" }; // amber
    case "reference":
      return { bg: "#dbeafe", border: "#3b82f6", text: "#1e3a5f" }; // blue
    case "citation":
      return { bg: "#d1fae5", border: "#10b981", text: "#064e3b" }; // green
    case "hop1":
      return { bg: "#f4f4f5", border: "#a1a1aa", text: "#3f3f46" }; // zinc
  }
}

// ── Main component ──────────────────────────────────────────────

interface CitationGraphFlowProps {
  papers: Paper[];
  edges: CitationEdge[];
  seedId: string;
  onNodeClick?: (paperId: string) => void;
}

export function CitationGraphFlow({
  papers,
  edges,
  seedId,
  onNodeClick,
}: CitationGraphFlowProps) {
  const { flowNodes, flowEdges } = useMemo(() => {
    const positions = concentricLayout(seedId, papers, edges);
    const paperMap = new Map(papers.map((p) => [p.s2_id, p]));

    // Determine role for each paper
    const directRefIds = new Set(
      edges.filter((e) => e.source_id === seedId && e.hop === 0).map((e) => e.target_id),
    );
    const directCiteIds = new Set(
      edges.filter((e) => e.target_id === seedId && e.hop === 0).map((e) => e.source_id),
    );

    function getRole(id: string): NodeRole {
      if (id === seedId) return "seed";
      if (directRefIds.has(id)) return "reference";
      if (directCiteIds.has(id)) return "citation";
      return "hop1";
    }

    const nodes: Node[] = [];

    // Always include the seed, even if it's not in papers array
    const allIds = new Set([seedId, ...papers.map((p) => p.s2_id)]);

    for (const id of allIds) {
      const pos = positions.get(id);
      if (!pos) continue;

      const paper = paperMap.get(id);
      const role = getRole(id);
      const colors = roleColor(role);
      const w = role === "seed" ? 220 : nodeWidth(paper?.citation_count ?? null);
      const label = truncate(paper?.title ?? id, role === "seed" ? 60 : 40);
      const year = paper?.year ?? "";
      const cites = paper?.citation_count ?? 0;

      nodes.push({
        id,
        position: pos,
        data: { label, year, cites, role, paperId: id },
        style: {
          background: colors.bg,
          border: `2px solid ${colors.border}`,
          borderRadius: "8px",
          padding: "8px 10px",
          width: w,
          fontSize: role === "seed" ? 12 : 11,
          color: colors.text,
          fontWeight: role === "seed" ? 600 : 400,
          cursor: "pointer",
          textAlign: "center" as const,
          lineHeight: "1.3",
        },
      });
    }

    const flowEdgeList: Edge[] = edges.map((e, i) => ({
      id: `e-${i}`,
      source: e.source_id,
      target: e.target_id,
      animated: e.hop === 0,
      style: {
        stroke: e.hop === 0 ? "#71717a" : "#d4d4d8",
        strokeWidth: e.hop === 0 ? 1.5 : 1,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: e.hop === 0 ? "#71717a" : "#d4d4d8",
      },
    }));

    return { flowNodes: nodes, flowEdges: flowEdgeList };
  }, [papers, edges, seedId]);

  const [nodes, , onNodesChange] = useNodesState(flowNodes);
  const [edgesState, , onEdgesChange] = useEdgesState(flowEdges);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (onNodeClick) {
        onNodeClick(node.id);
      }
    },
    [onNodeClick],
  );

  return (
    <div className="h-[500px] w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <ReactFlow
        nodes={nodes}
        edges={edgesState}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={20} size={1} color="#e4e4e7" />
        <Controls
          showInteractive={false}
          className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <MiniMap
          nodeColor={(n) => {
            const role = (n.data as { role?: NodeRole })?.role ?? "hop1";
            return roleColor(role).border;
          }}
          maskColor="rgba(0,0,0,0.08)"
          className="rounded-lg border border-zinc-200 dark:border-zinc-800"
        />
      </ReactFlow>
    </div>
  );
}

// ── Legend ───────────────────────────────────────────────────────

export function GraphLegend() {
  const items: { role: NodeRole; label: string }[] = [
    { role: "seed", label: "Seed paper" },
    { role: "reference", label: "References (cites)" },
    { role: "citation", label: "Citations (cited by)" },
    { role: "hop1", label: "2nd-hop connections" },
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {items.map(({ role, label }) => {
        const colors = roleColor(role);
        return (
          <div key={role} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm border"
              style={{
                background: colors.bg,
                borderColor: colors.border,
              }}
            />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {label}
            </span>
          </div>
        );
      })}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-zinc-400">
          Node size = citation count
        </span>
      </div>
    </div>
  );
}
