import {
  DEMOD_FLOW_VIEWPORT_SESSION_KEY,
  getDemodFlowGraphKey,
  isDefaultDemodFlowViewport,
  parseDemodFlowViewport,
  serializeDemodFlowViewport,
  shouldReusePersistedDemodViewport,
  type PersistedDemodFlowViewport,
} from "@n-apt/demodulation/react-flow/flows/demodFlowModel";

const graphKey = "source,waterfall|e-source-waterfall";

const persistedViewport: PersistedDemodFlowViewport = {
  sourceMode: "live",
  flowVersion: 2,
  graphKey,
  viewport: { x: -120.5, y: 64, zoom: 0.42 },
};

describe("demod flow viewport persistence", () => {
  it("round-trips a persisted framing", () => {
    expect(
      parseDemodFlowViewport(serializeDemodFlowViewport(persistedViewport)),
    ).toEqual(persistedViewport);
  });

  it("rejects payloads that cannot frame a graph", () => {
    expect(parseDemodFlowViewport(null)).toBeNull();
    expect(parseDemodFlowViewport("")).toBeNull();
    expect(parseDemodFlowViewport("not json")).toBeNull();
    expect(
      parseDemodFlowViewport(JSON.stringify({ sourceMode: "live" })),
    ).toBeNull();
    expect(
      parseDemodFlowViewport(
        JSON.stringify({ ...persistedViewport, graphKey: undefined }),
      ),
    ).toBeNull();
    expect(
      parseDemodFlowViewport(
        JSON.stringify({
          ...persistedViewport,
          viewport: { x: 0, y: 0, zoom: 0 },
        }),
      ),
    ).toBeNull();
    expect(
      parseDemodFlowViewport(
        JSON.stringify({
          ...persistedViewport,
          viewport: { x: Number.NaN, y: 0, zoom: 1 },
        }),
      ),
    ).toBeNull();
  });

  it("defaults a missing flow version to the initial revision", () => {
    expect(
      parseDemodFlowViewport(
        JSON.stringify({
          sourceMode: "file",
          graphKey,
          viewport: persistedViewport.viewport,
        }),
      ),
    ).toEqual({
      sourceMode: "file",
      flowVersion: 0,
      graphKey,
      viewport: persistedViewport.viewport,
    });
  });

  it("keys the graph by node and edge identity, not positions", () => {
    const nodes = [
      { id: "b", position: { x: 0, y: 0 } },
      { id: "a", position: { x: 10, y: 10 } },
    ] as any;
    const edges = [{ id: "e1" }, { id: "e0" }] as any;

    expect(getDemodFlowGraphKey(nodes, edges)).toBe("a,b|e0,e1");
    expect(
      getDemodFlowGraphKey(
        [
          { id: "b", position: { x: 99, y: 99 } },
          { id: "a", position: { x: 40, y: 40 } },
        ] as any,
        edges,
      ),
    ).toBe("a,b|e0,e1");
    expect(getDemodFlowGraphKey([nodes[0]] as any, edges)).toBe("b|e0,e1");
  });

  it("only reuses framing captured for the same graph", () => {
    expect(
      shouldReusePersistedDemodViewport(persistedViewport, "live", 2, graphKey),
    ).toBe(true);
    expect(
      shouldReusePersistedDemodViewport(persistedViewport, "live", 5, graphKey),
    ).toBe(false);
    expect(
      shouldReusePersistedDemodViewport(persistedViewport, "file", 2, graphKey),
    ).toBe(false);
    expect(
      shouldReusePersistedDemodViewport(persistedViewport, "live", 2, "other"),
    ).toBe(false);
    expect(shouldReusePersistedDemodViewport(null, "live", 2, graphKey)).toBe(
      false,
    );
  });

  it("reuses framing after a remount resets the revision counter", () => {
    // A remount (hot reload, route re-entry) rebuilds the same graph from
    // session storage with the revision counter back at zero.
    expect(
      shouldReusePersistedDemodViewport(persistedViewport, "live", 0, graphKey),
    ).toBe(true);
  });

  it("keeps the session storage key stable across builds", () => {
    expect(DEMOD_FLOW_VIEWPORT_SESSION_KEY).toBe(
      "n-apt:demod-flow-viewport:v3",
    );
  });

  it("does not treat React Flow's default transform as a framing", () => {
    expect(isDefaultDemodFlowViewport({ x: 0, y: 0, zoom: 1 })).toBe(true);
    expect(isDefaultDemodFlowViewport({ x: 0, y: 0, zoom: 0.42 })).toBe(false);
    expect(isDefaultDemodFlowViewport({ x: -12, y: 0, zoom: 1 })).toBe(false);
  });
});
