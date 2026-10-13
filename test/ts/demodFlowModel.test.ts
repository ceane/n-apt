import {
  buildDemodFlowGraph,
  adaptDemodFlowForSourceMode,
  getDemodNodePolicy,
  shouldRunDemodAutoLayout,
  shouldVirtualizeDemodFlowNodes,
  resolveDemodCaptureRange,
  serializeDemodFlow,
  shouldDeferDemodAutoLayout,
  DEMOD_FIT_VIEW_OPTIONS,
} from "@n-apt/demodulation/react-flow/flows/demodFlowModel";
import { flowTemplates } from "@n-apt/demodulation/react-flow/flows/templates";

describe("buildDemodFlowGraph", () => {
  it("always resolves a non-empty capture range for reference captures", () => {
    expect(
      resolveDemodCaptureRange({ sampleRateHz: 3_200_000 }),
    ).toEqual({ min: 0, max: 3_200_000 });
  });

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

  it("uses Reference Capture as the initial live flow", () => {
    const graph = buildDemodFlowGraph("live");
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    expect([...nodeIds]).toEqual([
      "source",
      "channel",
      "signal-config",
      "demod-readiness",
      "stimulus",
      "output",
    ]);
    const expectedPositions = {
      source: { x: 445, y: 50 },
      channel: { x: 45, y: 450 },
      "signal-config": { x: 455, y: 450 },
      "demod-readiness": { x: 250, y: 1200 },
      stimulus: { x: 250, y: 1650 },
      output: { x: 250, y: 2350 },
    };
    const expectedConnections = [
      { source: "source", target: "channel" },
      { source: "source", target: "signal-config" },
      { source: "channel", target: "demod-readiness" },
      { source: "signal-config", target: "demod-readiness" },
      { source: "demod-readiness", target: "stimulus" },
      { source: "stimulus", target: "output" },
    ];
    const positionsById = (nodes: typeof graph.nodes) =>
      Object.fromEntries(nodes.map(({ id, position }) => [id, position]));
    const connections = (edges: typeof graph.edges) =>
      edges.map(({ source, target }) => ({ source, target }));
    expect(positionsById(graph.nodes)).toEqual(expectedPositions);
    expect(connections(graph.edges)).toEqual(expectedConnections);

    const referenceTemplate = flowTemplates.find(({ id }) => id === "default");
    expect(referenceTemplate).toBeDefined();
    if (!referenceTemplate) return;
    expect(positionsById(referenceTemplate.nodes)).toEqual(expectedPositions);
    expect(connections(referenceTemplate.edges)).toEqual(expectedConnections);
    graph.edges.forEach((edge) => {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    });
  });

  it("removes stimulus-specific edges for file source graphs", () => {
    const graph = buildDemodFlowGraph("file");
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    expect(nodeIds.has("stimulus")).toBe(true);
    expect(nodeIds.has("channel")).toBe(false);
    expect(nodeIds.has("metadata")).toBe(true);
    expect(nodeIds.has("signalOptions")).toBe(false);
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
    expect(liveFlow.nodes.find((node) => node.id === "channel")?.data.channelNode).toBe(true);
    expect(liveFlow.nodes.some((node) => node.data.metadataNode)).toBe(false);
  });
});

describe("demod flow initial layout", () => {
  it("fits against hidden template nodes so the selected flow stays on-screen", () => {
    expect(DEMOD_FIT_VIEW_OPTIONS.includeHiddenNodes).toBe(true);
    expect(DEMOD_FIT_VIEW_OPTIONS.minZoom).toBeLessThan(0.3);
  });

  it("keeps the spacious model positions on the first render", () => {
    expect(shouldRunDemodAutoLayout(0)).toBe(false);
  });

  it("re-layouts flows after they change", () => {
    expect(shouldRunDemodAutoLayout(1)).toBe(true);
  });

  it("defers layout until a non-empty graph has measured nodes", () => {
    expect(
      shouldDeferDemodAutoLayout({ hasNodes: true, nodesInitialized: false }),
    ).toBe(true);
    expect(
      shouldDeferDemodAutoLayout({ hasNodes: true, nodesInitialized: true }),
    ).toBe(false);
    expect(
      shouldDeferDemodAutoLayout({ hasNodes: false, nodesInitialized: false }),
    ).toBe(false);
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

  it("keeps the phase waterfall mounted so its history survives panning", () => {
    expect(
      shouldVirtualizeDemodFlowNodes([
        {
          id: "phase",
          position: { x: 0, y: 0 },
          data: { phaseOptions: true },
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

  it("serializes only the persisted flow state", () => {
    expect(
      serializeDemodFlow("live", [{ id: "source" } as any], []),
    ).toBe(
      JSON.stringify({ sourceMode: "live", nodes: [{ id: "source" }], edges: [] }),
    );
  });
});
