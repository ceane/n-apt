import {
  buildDemodFlowGraph,
  adaptDemodFlowForSourceMode,
  getDemodNodePolicy,
  shouldRunDemodAutoLayout,
  shouldVirtualizeDemodFlowNodes,
} from "@n-apt/components/react-flow/flows/demodFlowModel";

describe("buildDemodFlowGraph", () => {
  it("classifies backend tuning and static metadata nodes by source mode", () => {
    expect(getDemodNodePolicy({ channelNode: true }, "live")).toEqual({
      action: "keep",
    });
    expect(getDemodNodePolicy({ channelNode: true }, "file")).toEqual({
      action: "replace",
      replacement: "metadata",
    });
    expect(getDemodNodePolicy({ fftOptions: true }, "file")).toEqual({
      action: "keep",
    });
  });

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
    expect(
      graph.edges.some(
        (edge) => edge.source === "stimulus" || edge.target === "stimulus",
      ),
    ).toBe(false);
    expect(
      graph.edges.some(
        (edge) => edge.source === "channel" || edge.target === "channel",
      ),
    ).toBe(false);
    expect(
      graph.edges.some(
        (edge) => edge.source === "source" && edge.target === "metadata",
      ),
    ).toBe(true);
  });

  it("replaces a flow template Channel node with Metadata in file mode", () => {
    const flow = buildDemodFlowGraph("live");
    const adapted = adaptDemodFlowForSourceMode(flow, "file");
    expect(adapted.nodes.some((node) => node.id === "channel")).toBe(false);
    expect(
      adapted.nodes.some(
        (node) => node.id === "metadata" && node.data.metadataNode,
      ),
    ).toBe(true);
    expect(
      adapted.edges.some(
        (edge) => edge.source === "source" && edge.target === "metadata",
      ),
    ).toBe(true);
  });

  it("restores a source-specific node without replacing the selected flow", () => {
    const selectedFlow = buildDemodFlowGraph("live");
    const fileFlow = adaptDemodFlowForSourceMode(selectedFlow, "file");
    const liveFlow = adaptDemodFlowForSourceMode(fileFlow, "live");
    expect(liveFlow.nodes.map((node) => node.id)).toEqual(
      selectedFlow.nodes.map((node) => node.id),
    );
    expect(
      liveFlow.nodes.find((node) => node.id === "channel")?.data.channelNode,
    ).toBe(true);
    expect(liveFlow.nodes.some((node) => node.data.metadataNode)).toBe(false);
  });
});

describe("demod flow initial layout", () => {
  it("keeps the spacious model positions on the first render", () => {
    expect(shouldRunDemodAutoLayout(0)).toBe(false);
  });

  it("re-layouts flows after they change", () => {
    expect(shouldRunDemodAutoLayout(1)).toBe(true);
  });
});

describe("demod flow visualization persistence", () => {
  it("keeps the default live waterfall mounted while the viewport changes", () => {
    expect(
      shouldVirtualizeDemodFlowNodes([
        {
          id: "waterfall",
          position: { x: 0, y: 0 },
          data: { waterfallOptions: true },
        },
      ]),
    ).toBe(false);
  });

  it("keeps Tx Suite canvases mounted while zooming", () => {
    expect(
      shouldVirtualizeDemodFlowNodes([
        {
          id: "tx-waterfall",
          position: { x: 0, y: 0 },
          data: {
            waterfallOptions: true,
            sourceBindingGroup: "tx-suite",
          },
        },
      ]),
    ).toBe(false);
  });

  it("retains visible-node virtualization for ordinary stateless flows", () => {
    expect(
      shouldVirtualizeDemodFlowNodes([
        {
          id: "metadata",
          position: { x: 0, y: 0 },
          data: { metadataNode: true },
        },
      ]),
    ).toBe(true);
  });
});
