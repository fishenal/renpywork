"use client";

import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import type { GraphEdge, LabelNode, ProjectIndex } from "@/lib/types";
import { edgesWithinReachable } from "@/lib/parse/graph";

const NODE_W = 160;
const NODE_H = 36;

function layoutGraph(
  labelIds: string[],
  labels: Record<string, LabelNode>,
  graphEdges: GraphEdge[],
  entryLabel: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 48, marginx: 24, marginy: 24 });

  for (const id of labelIds) {
    g.setNode(id, { width: NODE_W, height: NODE_H });
  }
  for (const e of graphEdges) {
    if (g.hasNode(e.from) && g.hasNode(e.to)) {
      g.setEdge(e.from, e.to);
    }
  }
  dagre.layout(g);

  const nodes: Node[] = labelIds.map((id) => {
    const meta = labels[id];
    const pos = g.node(id);
    const isDynamic = meta?.kind === "dynamic" || id.startsWith("dynamic:");
    const isEntry = id === entryLabel;
    return {
      id,
      position: {
        x: (pos?.x ?? 0) - NODE_W / 2,
        y: (pos?.y ?? 0) - NODE_H / 2,
      },
      data: {
        label: isDynamic ? "⋯ expression" : id,
      },
      style: {
        width: NODE_W,
        fontSize: 12,
        borderRadius: 8,
        border: isEntry
          ? "2px solid #2f5d50"
          : isDynamic
            ? "1px dashed #9a948a"
            : "1px solid #c4b9a8",
        background: isDynamic ? "#efeae3" : isEntry ? "#e5efe9" : "#fffdf9",
        color: isDynamic ? "#6b6560" : "#1c1a17",
        opacity: isDynamic ? 0.85 : 1,
        padding: "6px 8px",
        textAlign: "center" as const,
      },
    };
  });

  // Dedupe parallel edges for display; keep first caption
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const e of graphEdges) {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const caption =
      e.caption && e.caption.length > 18
        ? `${e.caption.slice(0, 16)}…`
        : e.caption;
    edges.push({
      id: `${e.from}-${e.to}-${e.line}`,
      source: e.from,
      target: e.to,
      label: caption,
      type: "smoothstep",
      animated: e.kind === "menu",
      style: {
        stroke: e.kind === "dynamic" ? "#9a948a" : "#8a8278",
        strokeDasharray: e.kind === "dynamic" ? "4 4" : undefined,
      },
      labelStyle: { fontSize: 10, fill: "#6b6560" },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    });
  }

  return { nodes, edges };
}

type Props = {
  index: ProjectIndex;
  onSelectLabelFile?: (file: string) => void;
};

export function BranchGraph({ index, onSelectLabelFile }: Props) {
  const built = useMemo(() => {
    const reachableSet = new Set(index.reachable);
    if (index.entryLabel) reachableSet.add(index.entryLabel);
    const ids = index.reachable.length
      ? index.reachable
      : index.entryLabel
        ? [index.entryLabel]
        : [];
    const edges = edgesWithinReachable(index.edges, reachableSet);
    return layoutGraph(ids, index.labels, edges, index.entryLabel);
  }, [index]);

  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);

  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = (_evt, node) => {
    if (node.id.startsWith("dynamic:")) return;
    const meta = index.labels[node.id];
    if (meta?.file && onSelectLabelFile) {
      onSelectLabelFile(meta.file);
    }
  };

  if (!index.entryLabel) {
    return (
      <div className="graph-empty muted">未找到入口 label（期望 start）</div>
    );
  }

  if (built.nodes.length === 0) {
    return <div className="graph-empty muted">关系图为空</div>;
  }

  return (
    <div className="branch-graph">
      <div className="graph-caption muted">
        入口 <code>{index.entryLabel}</code> · 可达 {index.reachable.length} 节点
        （深度≤12）
      </div>
      <div className="graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.15}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}
