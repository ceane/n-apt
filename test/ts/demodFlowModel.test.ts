import { buildDemodFlowGraph } from "@n-apt/components/react-flow/flows/demodFlowModel";

describe("buildDemodFlowGraph", () => {
  it("includes a stimulus node for live source graphs", () => {
    const graph = buildDemodFlowGraph("live");
    const nodeIds = new Set(graph.nodes.map((node) => node.id));

    expect(nodeIds.has("stimulus")).toBe(true);

    graph.edges.forEach((edge) => {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    });
  });

  it("removes stimulus-specific edges for file source graphs", () => {
    const graph = buildDemodFlowGraph("file");
    const nodeIds = new Set(graph.nodes.map((node) => node.id));

    expect(nodeIds.has("stimulus")).toBe(false);
    expect(nodeIds.has("channel")).toBe(false);
    expect(nodeIds.has("metadata")).toBe(true);
    expect(nodeIds.has("signalOptions")).toBe(false);
    expect(graph.edges.some((edge) => edge.source === "stimulus" || edge.target === "stimulus")).toBe(false);
    expect(graph.edges.some((edge) => edge.source === "channel" || edge.target === "channel")).toBe(false);
    expect(graph.edges.some((edge) => edge.source === "source" && edge.target === "metadata")).toBe(true);
  });
});
