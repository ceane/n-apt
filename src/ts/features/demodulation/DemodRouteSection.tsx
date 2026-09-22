import React, {
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useState,
} from "react";
import styled from "styled-components";
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  addEdge,
  useReactFlow,
  Connection,
  ConnectionMode,
  BackgroundVariant,
  Handle,
  Position,
  useOnViewportChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDemodAnalysis } from "@n-apt/demodulation/context/DemodAnalysisContext";
import { useDemodFlow } from "@n-apt/demodulation/context/DemodFlowContext";
import { useAppSelector } from "@n-apt/redux";
import {
  DefaultDemodNodeContent,
  DemodNodeSuspense,
  LazyBitstreamViewer,
  LazyPhaseWaterfallNode,
  LazySymbolsTable,
  hasPendingDemodLazyNodeContent,
  resolveDemodNodeEntry,
} from "@n-apt/demodulation/react-flow/nodes/nodeRegistry";
import {
  NodeContainer,
  FlowContainer,
} from "@n-apt/demodulation/react-flow/flows";
import {
  DEMOD_FIT_VIEW_OPTIONS,
  DEMOD_FLOW_VIEWPORT_SESSION_KEY,
  getDemodFlowGraphKey,
  isDefaultDemodFlowViewport,
  parseDemodFlowViewport,
  serializeDemodFlowViewport,
  shouldReusePersistedDemodViewport,
  shouldRunDemodAutoLayout,
  shouldDeferDemodAutoLayout,
  shouldVirtualizeDemodFlowNodes,
  type DemodFlowViewport,
  type PersistedDemodFlowViewport,
} from "@n-apt/demodulation/react-flow/flows/demodFlowModel";
// Removed local buildDemodFlowGraph call

const VisibleFrequencyRangeContext = React.createContext<{
  min: number;
  max: number;
} | null>(null);

const ContextMenuPanel = styled.div`
  position: fixed;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 0;
  box-shadow: none;
  padding: 5px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 140px;
  font-family: ${({ theme }) => theme.typography.sans};
`;

const ContextMenuItem = styled.button`
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 8px 12px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const StyledReactFlow = styled(ReactFlow)`
  width: 100%;
  height: 100%;
  user-select: none;
  -webkit-user-select: none;

  input,
  textarea,
  select,
  [contenteditable="true"] {
    user-select: text;
    -webkit-user-select: text;
  }

  .react-flow__controls {
    background-color: ${(props) => props.theme.surface} !important;
    border: 1px solid ${(props) => props.theme.border} !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }

  .react-flow__controls-button {
    background-color: ${(props) => props.theme.surface} !important;
    border: 1px solid ${(props) => props.theme.border} !important;
    color: ${(props) => props.theme.textPrimary} !important;
  }

  .react-flow__controls-button:hover {
    background-color: ${(props) => props.theme.surfaceHover} !important;
  }
`;

// Local NodeContainer removed
// Redundant local styles removed

// Helper component for Signal Options Node
// Removed local SignalOptions component — now imported from @n-apt/demodulation/react-flow/nodes

export const calculateVisibleFrequencyRange = ({
  activeSignalArea,
  frequencyRange,
  lastKnownRanges,
  sampleRateHz,
  vizZoom,
  vizPanOffset,
}: {
  activeSignalArea: string;
  frequencyRange: { min: number; max: number } | null;
  lastKnownRanges: Record<string, { min: number; max: number }>;
  sampleRateHz: number;
  vizZoom: number;
  vizPanOffset: number;
}) => {
  const minFreq = 0;
  const maxFreq = 2_000_000_000; // 2GHz max
  const hardwareSpan = sampleRateHz > 0 ? sampleRateHz : 3_200_000;
  const areaKey = activeSignalArea || "A";
  const safeZoom = Number.isFinite(vizZoom) && vizZoom > 0 ? vizZoom : 1;

  if (!frequencyRange) {
    return lastKnownRanges[areaKey] ?? null;
  }

  const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
  const visualSpan = hardwareSpan / safeZoom;
  const halfVisualSpan = visualSpan / 2;
  let visualCenter = hardwareCenter + vizPanOffset;

  visualCenter = Math.max(
    minFreq + halfVisualSpan,
    Math.min(maxFreq - halfVisualSpan, visualCenter),
  );

  return {
    min: visualCenter - halfVisualSpan,
    max: visualCenter + halfVisualSpan,
  };
};

const CustomNode = React.memo(({ data, id }: { data: any; id: string }) => {
  const entry = resolveDemodNodeEntry(data);

  return (
    <NodeContainer data-nodeid={id}>
      {!data.sourceNode && (
        <Handle
          type="target"
          position={Position.Top}
          style={{
            background: "#666",
            border: "1px solid #999",
            width: "8px",
            height: "8px",
          }}
        />
      )}
      <DemodNodeSuspense label={data.label}>
        {entry ? (
          <entry.Component data={data} id={id} />
        ) : (
          <DefaultDemodNodeContent data={data} />
        )}
      </DemodNodeSuspense>
      {!data.outputNode && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{
            background: "#666",
            border: "1px solid #999",
            width: "8px",
            height: "8px",
          }}
        />
      )}
    </NodeContainer>
  );
});

const FrequencyAwareNode = React.memo(
  ({ data, id }: { data: any; id: string }) => {
    const frequencyRange = React.useContext(VisibleFrequencyRangeContext);

    if (data.symbolOptions) {
      return (
        <NodeContainer data-nodeid={id}>
          <Handle
            type="target"
            position={Position.Top}
            style={{
              background: "#666",
              border: "1px solid #999",
              width: "8px",
              height: "8px",
            }}
          />
          <DemodNodeSuspense label={data.label}>
            <LazySymbolsTable frequencyRange={frequencyRange} />
          </DemodNodeSuspense>
          <Handle
            type="source"
            position={Position.Bottom}
            style={{
              background: "#666",
              border: "1px solid #999",
              width: "8px",
              height: "8px",
            }}
          />
        </NodeContainer>
      );
    }

    if (data.phaseOptions) {
      return (
        <NodeContainer data-nodeid={id}>
          <Handle
            type="target"
            position={Position.Top}
            style={{
              background: "#666",
              border: "1px solid #999",
              width: "8px",
              height: "8px",
            }}
          />
          <DemodNodeSuspense label={data.label}>
            <LazyPhaseWaterfallNode
              data={data}
              frequencyRange={frequencyRange}
            />
          </DemodNodeSuspense>
          <Handle
            type="source"
            position={Position.Bottom}
            style={{
              background: "#666",
              border: "1px solid #999",
              width: "8px",
              height: "8px",
            }}
          />
        </NodeContainer>
      );
    }

    return (
      <NodeContainer data-nodeid={id}>
        <Handle
          type="target"
          position={Position.Top}
          style={{
            background: "#666",
            border: "1px solid #999",
            width: "8px",
            height: "8px",
          }}
        />
        <DemodNodeSuspense label={data.label}>
          <LazyBitstreamViewer frequencyRange={frequencyRange} />
        </DemodNodeSuspense>
        <Handle
          type="source"
          position={Position.Bottom}
          style={{
            background: "#666",
            border: "1px solid #999",
            width: "8px",
            height: "8px",
          }}
        />
      </NodeContainer>
    );
  },
);

const NODE_TYPES = {
  custom: (nodeProps: { data: any; id: string }) => {
    if (
      nodeProps.data?.symbolOptions ||
      nodeProps.data?.bitstreamOptions ||
      nodeProps.data?.phaseOptions
    ) {
      return <FrequencyAwareNode {...nodeProps} />;
    }

    return <CustomNode {...nodeProps} />;
  },
};

const DEMOD_LAYOUT_CACHE_LIMIT = 8;
/** How long a framing pass waits for React Flow to report node boxes before
 * falling back to whatever it has. A node type that cannot measure itself must
 * not leave the graph unframed at the identity transform. */
const DEMOD_MEASUREMENT_GRACE_MS = 400;
/** A fit waits for the graph to stop changing shape (lazy node content and the
 * layout both move boxes after mount). Fitting mid-change frames a too-small
 * bounding box, which is what zoomed the graph in. */
const DEMOD_FIT_SETTLE_MS = 250;
const DEMOD_FIT_SETTLE_CAP_MS = 1200;

const readPersistedDemodViewport = (): PersistedDemodFlowViewport | null => {
  if (typeof window === "undefined") return null;
  try {
    return parseDemodFlowViewport(
      window.sessionStorage.getItem(DEMOD_FLOW_VIEWPORT_SESSION_KEY),
    );
  } catch {
    // Session storage can be unavailable in private or restricted contexts.
    return null;
  }
};

// Inner component that uses React Flow hooks
const DemodRouteSectionInner: React.FC = () => {
  const { analysisSession } = useDemodAnalysis();
  const { flowVersion } = useDemodFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const {
    deleteElements,
    fitView,
    getViewport,
    screenToFlowPosition,
    setViewport,
  } = useReactFlow();
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const activeSignalArea = useAppSelector(
    (state) => state.spectrum.activeSignalArea,
  );
  const frequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const lastKnownRanges = useAppSelector(
    (state) => state.spectrum.lastKnownRanges,
  );
  const sampleRateHz = useAppSelector((state) => state.spectrum.sampleRateHz);
  const vizZoom = useAppSelector((state) => state.spectrum.vizZoom);
  const vizPanOffset = useAppSelector((state) => state.spectrum.vizPanOffset);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  const hasLaidOut = useRef(false);
  const layoutFrameRef = useRef<number | null>(null);
  const lastMeasuredSizesRef = useRef<Map<string, { w: number; h: number }>>(
    new Map(),
  );
  const onKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const layoutRunIdRef = useRef(0);
  const shouldFitAfterLayoutRef = useRef(true);
  // Set when a layout pass had to wait for node measurements, so it is retried
  // as soon as they are available instead of being dropped.
  const deferredLayoutRef = useRef(false);
  const layoutCacheRef = useRef<Map<string, any>>(new Map()); // Cache layout results
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const visibleFrequencyRange = useMemo(
    () =>
      calculateVisibleFrequencyRange({
        activeSignalArea,
        frequencyRange,
        lastKnownRanges,
        sampleRateHz,
        vizZoom,
        vizPanOffset,
      }),
    [
      activeSignalArea,
      frequencyRange,
      lastKnownRanges,
      sampleRateHz,
      vizZoom,
      vizPanOffset,
    ],
  );

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    setNodes: setNodesLocal,
    setEdges: setEdgesLocal,
  } = useDemodFlow();

  const [, setIsLaidOut] = useState(false);
  const [isFlowTransitioning, setIsFlowTransitioning] = useState(false);
  const [fitViewEpoch, setFitViewEpoch] = useState(0);

  // React Flow keeps its viewport in memory, so any remount (dev hot reload,
  // route re-entry) would drop the graph back to the identity transform and
  // strand the already-laid-out nodes off screen. Persist the framing per
  // source mode and restore it for the revision it was captured for.
  const persistedViewportRef = useRef<
    PersistedDemodFlowViewport | null | undefined
  >(undefined);
  if (persistedViewportRef.current === undefined) {
    persistedViewportRef.current = readPersistedDemodViewport();
  }
  const restoredViewportRef = useRef(false);
  const latestViewportRef = useRef<PersistedDemodFlowViewport | null>(null);
  const viewportPersistTimerRef = useRef<number | null>(null);
  const sourceModeRef = useRef(sourceMode);
  sourceModeRef.current = sourceMode;
  const flowVersionRef = useRef(flowVersion);
  flowVersionRef.current = flowVersion;
  const graphKey = useMemo(
    () => getDemodFlowGraphKey(nodes, edges),
    [edges, nodes],
  );
  const graphKeyRef = useRef(graphKey);
  graphKeyRef.current = graphKey;

  // Hand the persisted framing to React Flow as its initial viewport. Setting it
  // from an effect races the canvas coming up (and a `setViewport` that lands
  // before the pan/zoom exists is dropped), which left the graph at the identity
  // transform — 1:1 off the origin, which reads as nodes zoomed in.
  const defaultViewport = useMemo(() => {
    const persisted = persistedViewportRef.current;
    return shouldReusePersistedDemodViewport(
      persisted,
      sourceMode,
      flowVersion,
      graphKey,
    )
      ? persisted.viewport
      : undefined;
  }, [flowVersion, graphKey, sourceMode]);

  // A remount re-measures every node, and lazy node content arrives late: a fit
  // taken while boxes are still changing frames whatever exists at that instant,
  // and a too-small box is what zooms the graph in. Fit only after the graph has
  // stopped changing shape, with a bounded wait so it can never stall.
  const frameSignature = useMemo(
    () =>
      nodes
        .map(
          (node) =>
            `${node.id}:${Math.round(node.position.x)},${Math.round(
              node.position.y,
            )},${node.measured?.width ?? 0}x${node.measured?.height ?? 0}`,
        )
        .join("|"),
    [nodes],
  );
  const [graphSettled, setGraphSettled] = useState(false);
  const unsettledSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    if (unsettledSinceRef.current === null) unsettledSinceRef.current = now;
    const overdue =
      now - (unsettledSinceRef.current ?? now) >= DEMOD_FIT_SETTLE_CAP_MS;
    const timer = window.setTimeout(
      () => {
        unsettledSinceRef.current = null;
        setGraphSettled(true);
      },
      overdue ? 0 : DEMOD_FIT_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [frameSignature]);

  useEffect(() => {
    setGraphSettled(false);
  }, [graphKey]);

  // React Flow reports a node's box only after measuring it, and a remount can
  // adopt nodes before that pass runs. Fitting in that window frames whatever
  // subset already has a box — a too-small bounding box is what zoomed the graph
  // in — so a fit waits for real, positive boxes on every visible node.
  const nodesMeasured = useMemo(
    () =>
      nodes.length > 0 &&
      nodes.every((node) => {
        if (node.hidden) return true;
        const width = node.measured?.width ?? node.width;
        const height = node.measured?.height ?? node.height;
        return (
          typeof width === "number" &&
          width > 0 &&
          typeof height === "number" &&
          height > 0
        );
      }),
    [nodes],
  );
  const nodesMeasuredRef = useRef(nodesMeasured);
  nodesMeasuredRef.current = nodesMeasured;

  // Off-screen nodes are unmounted by virtual rendering, and an unmounted node
  // reports no box. React Flow then keeps `nodesInitialized` false forever, and
  // both its fit and every measurement-gated pass here are queued on that flag,
  // so the graph could never be framed at all. Keep every node mounted until the
  // graph has been framed once; virtual rendering resumes afterwards and the
  // measured boxes stay on the nodes.
  const [graphFramed, setGraphFramed] = useState(false);
  const graphFramedRef = useRef(false);
  const markGraphFramed = useCallback(() => {
    if (graphFramedRef.current) return;
    graphFramedRef.current = true;
    setGraphFramed(true);
  }, []);
  useEffect(() => {
    // A different graph has to be framed from scratch.
    graphFramedRef.current = false;
    setGraphFramed(false);
  }, [graphKey]);

  const flushPersistedViewport = useCallback(() => {
    if (viewportPersistTimerRef.current !== null) {
      window.clearTimeout(viewportPersistTimerRef.current);
      viewportPersistTimerRef.current = null;
    }
    const snapshot = latestViewportRef.current;
    if (!snapshot || typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        DEMOD_FLOW_VIEWPORT_SESSION_KEY,
        serializeDemodFlowViewport(snapshot),
      );
    } catch {
      // Session storage can be unavailable in private or restricted contexts.
    }
  }, []);

  const persistViewport = useCallback(
    (viewport: DemodFlowViewport) => {
      if (isDefaultDemodFlowViewport(viewport)) {
        // React Flow's initial transform, not a framing the user chose.
        return;
      }
      const snapshot: PersistedDemodFlowViewport = {
        sourceMode: sourceModeRef.current,
        flowVersion: flowVersionRef.current,
        graphKey: graphKeyRef.current,
        viewport,
      };
      latestViewportRef.current = snapshot;
      persistedViewportRef.current = snapshot;
      if (typeof window === "undefined") return;
      if (viewportPersistTimerRef.current !== null) {
        window.clearTimeout(viewportPersistTimerRef.current);
      }
      viewportPersistTimerRef.current = window.setTimeout(() => {
        viewportPersistTimerRef.current = null;
        flushPersistedViewport();
      }, 150);
    },
    [flushPersistedViewport],
  );

  const persistViewportRef = useRef(persistViewport);
  persistViewportRef.current = persistViewport;
  const handleViewportChange = useCallback((viewport: DemodFlowViewport) => {
    persistViewportRef.current(viewport);
  }, []);
  useOnViewportChange({ onChange: handleViewportChange });

  useEffect(
    () => () => {
      // A navigation inside the debounce window must not lose the last framing.
      flushPersistedViewport();
    },
    [flushPersistedViewport],
  );

  const [menu, setMenu] = React.useState<{
    id: string;
    type: string;
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setMenu({
        id: node.id,
        type: node.type || "default",
        top: event.clientY,
        left: event.clientX,
      });
    },
    [],
  );

  const onPaneClick = useCallback(() => {
    setMenu(null);
  }, []);

  /** Frame the graph after a layout pass. A layout pass on the same graph must
   * never move the camera: ELK only re-seats nodes, so re-fitting there is what
   * zoomed the graph in under the user after a layout ran. The camera moves for
   * a different graph (the persisted framing no longer matches) or an explicit
   * reframe (`refit`, i.e. a container geometry change). */
  const frameAfterLayout = useCallback(
    (refit: boolean) => {
      const persisted = persistedViewportRef.current;
      const keepFraming =
        !refit &&
        shouldReusePersistedDemodViewport(
          persisted,
          sourceModeRef.current,
          flowVersionRef.current,
          graphKeyRef.current,
        );
      if (keepFraming) {
        void setViewport(persisted.viewport, { duration: 0 }).then(() =>
          markGraphFramed(),
        );
        return;
      }
      setFitViewEpoch((epoch) => epoch + 1);
    },
    [markGraphFramed, setViewport],
  );

  /** Restore the framing captured for the current revision, otherwise fit. */
  const frameForCurrentRevision = useCallback(() => {
    const persisted = persistedViewportRef.current;
    if (
      shouldReusePersistedDemodViewport(
        persisted,
        sourceModeRef.current,
        flowVersionRef.current,
        graphKeyRef.current,
      )
    ) {
      void setViewport(persisted.viewport, { duration: 0 }).then(() =>
        markGraphFramed(),
      );
      return;
    }
    void fitView({ ...DEMOD_FIT_VIEW_OPTIONS }).then(() => {
      if (!nodesMeasuredRef.current) return;
      markGraphFramed();
      persistViewportRef.current(getViewport());
    });
  }, [fitView, getViewport, markGraphFramed, setViewport]);

  const measureAndLayout = useCallback(
    async (
      force: boolean = false,
      remeasure: boolean = false,
      refit: boolean = false,
    ) => {
      if (!reactFlowWrapper.current) return;
      const wrapper = reactFlowWrapper.current;
      const currentRunId = ++layoutRunIdRef.current;

      const sizeMap = new Map<string, { w: number; h: number }>();
      if (remeasure) {
        const nodeEls = wrapper.querySelectorAll<HTMLElement>("[data-nodeid]");
        nodeEls.forEach((el) => {
          const id = el.getAttribute("data-nodeid");
          if (!id) return;
          if (el.offsetWidth > 0 && el.offsetHeight > 0) {
            sizeMap.set(id, { w: el.offsetWidth, h: el.offsetHeight });
          }
        });
      } else {
        let hasUnmeasuredNodes = false;
        for (const node of nodesRef.current) {
          const measuredWidth = node.measured?.width;
          const measuredHeight = node.measured?.height;
          if (measuredWidth && measuredHeight) {
            sizeMap.set(node.id, { w: measuredWidth, h: measuredHeight });
          } else {
            hasUnmeasuredNodes = true;
          }
        }
        if (hasUnmeasuredNodes) {
          const nodeEls =
            wrapper.querySelectorAll<HTMLElement>("[data-nodeid]");
          nodeEls.forEach((el) => {
            const id = el.getAttribute("data-nodeid");
            if (!id || sizeMap.has(id)) return;
            if (el.offsetWidth > 0 && el.offsetHeight > 0) {
              sizeMap.set(id, { w: el.offsetWidth, h: el.offsetHeight });
            }
          });
        }
      }

      const getDimensions = (node: Node) => {
        if (node.measured?.width && node.measured?.height) {
          return { w: node.measured.width, h: node.measured.height };
        }
        const domSz = sizeMap.get(node.id);
        if (domSz) return domSz;
        return { w: 400, h: 300 };
      };

      // A node React Flow has not measured yet has no real box. Laying out with
      // the 400x300 placeholder produces a compacted graph, and the fit that
      // follows then frames those wrong bounds — the "hot reload moved my nodes
      // and zoomed in" look. Defer instead: the measurement pass re-runs this
      // through nodesInitialized / the node-resize event.
      const hasUnmeasuredNodes = nodesRef.current.some(
        (node) =>
          !node.hidden &&
          !(node.measured?.width && node.measured?.height) &&
          !sizeMap.has(node.id),
      );
      if (hasUnmeasuredNodes) {
        lastMeasuredSizesRef.current = new Map();
        deferredLayoutRef.current = true;
        return;
      }

      const sizesChanged = (() => {
        if (sizeMap.size !== lastMeasuredSizesRef.current.size) return true;

        for (const [id, size] of sizeMap.entries()) {
          const prev = lastMeasuredSizesRef.current.get(id);
          // Add 1px tolerance to prevent jitter from subpixel rendering during drag/hover transitions
          if (
            !prev ||
            Math.abs(prev.w - size.w) > 1 ||
            Math.abs(prev.h - size.h) > 1
          ) {
            return true;
          }
        }

        return false;
      })();

      if (!force && !sizesChanged && hasLaidOut.current) {
        return;
      }

      lastMeasuredSizesRef.current = sizeMap;

      const layoutNodes = nodesRef.current.map((node: Node) => {
        const dims = getDimensions(node);
        return { id: node.id, width: dims.w, height: dims.h };
      });
      const layoutEdges = edgesRef.current.map((edge: Edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      }));

      const cacheKey = `${layoutNodes
        .map((node) => `${node.id}:${node.width}x${node.height}`)
        .join(";")}|${layoutEdges
        .map((edge) => `${edge.sources[0]}>${edge.targets[0]}`)
        .join(";")}`;

      const cachedPositions = force
        ? null
        : layoutCacheRef.current.get(cacheKey);
      if (cachedPositions) {
        setNodesLocal((nds: Node[]) =>
          nds.map((node: Node) => {
            const position = cachedPositions[node.id];
            if (!position) return node;
            return { ...node, position: { x: position.x, y: position.y } };
          }),
        );
        frameAfterLayout(refit);
        return;
      }

      try {
        const { runDemodLayout } = await import(
          "@n-apt/demodulation/react-flow/flows/demodLayoutClient"
        );
        const positions = await runDemodLayout(
          currentRunId,
          layoutNodes,
          layoutEdges,
        );
        if (layoutRunIdRef.current !== currentRunId) {
          return;
        }

        if (layoutCacheRef.current.size >= DEMOD_LAYOUT_CACHE_LIMIT) {
          const oldestKey = layoutCacheRef.current.keys().next().value;
          if (oldestKey !== undefined) {
            layoutCacheRef.current.delete(oldestKey);
          }
        }
        layoutCacheRef.current.set(cacheKey, positions);

        const isTxSuite = nodesRef.current.some(
          (candidate) => candidate.data?.txSuite === true,
        );
        const txSuiteLayout = (() => {
          if (!isTxSuite) return null;
          const next: Record<string, { x: number; y: number }> = {
            source: { x: 425, y: 40 },
          };
          const columns = [
            {
              x: 40,
              ids: [
                "tx-settings",
                "tx-signal-config",
                "tx-fft",
                "tx-waterfall",
              ],
            },
            { x: 650, ids: ["rx-channel", "rx-fft", "rx-waterfall"] },
            { x: 1250, ids: ["rx-signal-config"] },
          ];
          for (const column of columns) {
            let y = 360;
            for (const id of column.ids) {
              next[id] = { x: column.x, y };
              y += (sizeMap.get(id)?.h ?? 400) + 80;
            }
          }
          return next;
        })();

        setNodesLocal((nds: Node[]) => {
          let hasPositionChanges = false;
          const nextNodes = nds.map((node: Node) => {
            const layoutPosition = positions[node.id];
            if (!layoutPosition) return node;

            let targetX = layoutPosition.x;
            let targetY = layoutPosition.y;

            if (txSuiteLayout && txSuiteLayout[node.id]) {
              targetX = txSuiteLayout[node.id].x;
              targetY = txSuiteLayout[node.id].y;
            }

          const nextNode = {
              ...node,
              position: { x: targetX, y: targetY },
            };

            if (
              Math.abs(node.position.x - nextNode.position.x) > 0.5 ||
              Math.abs(node.position.y - nextNode.position.y) > 0.5
            ) {
              hasPositionChanges = true;
            }

            return nextNode;
          });

          return hasPositionChanges ? nextNodes : nds;
        });

        if (typeof window !== "undefined") {
          if (layoutRunIdRef.current !== currentRunId) {
            return;
          }
          frameAfterLayout(refit);
        } else {
          setIsLaidOut(true);
          setIsFlowTransitioning(false);
          hasLaidOut.current = true;
        }
      } catch (error) {
        console.error("Layout error:", error);
      }
    },
    [frameAfterLayout, setNodesLocal, setEdgesLocal],
  );

  const nodeTypes = useMemo(() => NODE_TYPES, []);

  const scheduleMeasureAndLayout = useCallback(
    (
      force: boolean = false,
      remeasure: boolean = false,
      refit: boolean = false,
    ) => {
      if (layoutFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(layoutFrameRef.current);
      }

      if (typeof window === "undefined") {
        void measureAndLayout(force, remeasure, refit);
        return;
      }

      layoutFrameRef.current = window.requestAnimationFrame(() => {
        layoutFrameRef.current = null;
        void measureAndLayout(force, remeasure, refit);
      });
    },
    [measureAndLayout],
  );

  // A fit needs real boxes, and a node type that never reports one must not hold
  // every framing pass off (that leaves the graph at 1:1 off the origin), so the
  // wait for measurement is bounded.
  const [measurementGraceElapsed, setMeasurementGraceElapsed] = useState(false);
  const nodesReady = nodesMeasured || measurementGraceElapsed;

  useEffect(() => {
    if (nodesMeasured || nodes.length === 0) {
      setMeasurementGraceElapsed(false);
      return;
    }
    const timer = window.setTimeout(
      () => setMeasurementGraceElapsed(true),
      DEMOD_MEASUREMENT_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [nodes.length, nodesMeasured]);

  // Retry a layout pass that had to wait for node measurements (a remount
  // remeasures every node, so the first pass after a hot reload can arrive
  // before the DOM has boxes).
  useEffect(() => {
    if (!nodesMeasured || !deferredLayoutRef.current) return;
    deferredLayoutRef.current = false;
    scheduleMeasureAndLayout(true);
  }, [nodesMeasured, scheduleMeasureAndLayout]);

  useEffect(() => {
    if (fitViewEpoch === 0) return;
    // A fit needs real boxes, and it must not run while the graph is still
    // changing shape: either way it frames a partial bounding box, which is what
    // zoomed the graph in. Both waits are bounded (measurement grace, settle
    // cap) so the graph can never be left unframed at the origin.
    if (!nodesReady || !graphSettled) return;
    setIsLaidOut(true);
    setIsFlowTransitioning(false);
    hasLaidOut.current = true;
    shouldFitAfterLayoutRef.current = false;
    // Virtual rendering waits for this fit to land: `fitView` only resolves once
    // React Flow has measured every node. Record what it produced so the next
    // remount can restore this framing instead of fitting again — but only if
    // the fit framed real boxes, never a partially measured graph.
    void fitView({
      ...DEMOD_FIT_VIEW_OPTIONS,
    }).then(() => {
      if (!nodesMeasuredRef.current) return;
      markGraphFramed();
      persistViewportRef.current(getViewport());
    });
  }, [
    fitView,
    fitViewEpoch,
    getViewport,
    graphSettled,
    markGraphFramed,
    nodesReady,
  ]);

  // Restore the persisted framing for an unchanged revision (a remount, e.g. a
  // dev hot reload) instead of re-fitting or re-running ELK over it. A viewport
  // is a transform, so it does not depend on node measurement: restoring it must
  // not wait for the measurement pass the way a fit has to.
  useEffect(() => {
    if (restoredViewportRef.current) return;
    const persisted = persistedViewportRef.current;
    if (
      !shouldReusePersistedDemodViewport(
        persisted,
        sourceMode,
        flowVersion,
        graphKey,
      )
    ) {
      return;
    }
    if (nodes.length === 0) return;
    void setViewport(persisted.viewport, { duration: 0 }).then((applied) => {
      // Without a pan/zoom to apply to yet there is nothing to restore here;
      // `defaultViewport` is what frames the canvas in that case.
      if (!applied) return;
      restoredViewportRef.current = true;
      hasLaidOut.current = true;
      shouldFitAfterLayoutRef.current = false;
      markGraphFramed();
    });
  }, [
    flowVersion,
    graphKey,
    markGraphFramed,
    nodes.length,
    setViewport,
    sourceMode,
  ]);

  useEffect(() => {
    // The graph is already laid out for this revision and its framing is being
    // restored: keep it instead of relayouting and re-centering (which is what
    // dropped the nodes out of frame on hot reload).
    if (
      !restoredViewportRef.current &&
      shouldReusePersistedDemodViewport(
        persistedViewportRef.current,
        sourceMode,
        flowVersion,
        graphKey,
      )
    ) {
      hasLaidOut.current = true;
      setIsFlowTransitioning(false);
      return;
    }
    if (hasPendingDemodLazyNodeContent()) {
      return;
    }
    if (
      shouldDeferDemodAutoLayout({
        hasNodes: nodes.length > 0,
        // Measured, or the bounded wait for measurement has expired.
        nodesInitialized: nodesReady,
      })
    ) {
      return;
    }
    if (!shouldRunDemodAutoLayout(flowVersion)) {
      hasLaidOut.current = true;
      shouldFitAfterLayoutRef.current = false;
      setIsFlowTransitioning(false);
      const frame = window.requestAnimationFrame(() => {
        frameForCurrentRevision();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (!hasLaidOut.current || flowVersion > 0) {
      shouldFitAfterLayoutRef.current = true;
      setIsFlowTransitioning(true);
    }
    lastMeasuredSizesRef.current = new Map();
    const timer = setTimeout(() => {
      scheduleMeasureAndLayout(true);
    }, 16); // ~1 frame
    return () => clearTimeout(timer);
  }, [
    edges.length,
    nodes.length,
    flowVersion,
    frameForCurrentRevision,
    graphKey,
    nodesReady,
    scheduleMeasureAndLayout,
    sourceMode,
  ]);

  // Re-layout on window resize with debouncing
  useEffect(() => {
    const onResize = () => {
      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // Debounce resize to 200ms
      debounceTimerRef.current = setTimeout(() => {
        shouldFitAfterLayoutRef.current = true;
        scheduleMeasureAndLayout(true, true, true);
      }, 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [scheduleMeasureAndLayout]);

  useEffect(() => {
    const onNodeResize = () => {
      shouldFitAfterLayoutRef.current = true;
      scheduleMeasureAndLayout(true, true);
    };

    window.addEventListener("demod-flow-node-resize", onNodeResize);
    return () =>
      window.removeEventListener("demod-flow-node-resize", onNodeResize);
  }, [scheduleMeasureAndLayout]);

  // Track which sessions have already produced an output node
  const processedSessionsRef = useRef<Set<string>>(new Set());

  // Count output nodes for positioning
  const outputCountRef = useRef(0);

  // Populate Output node (or chain new ones) when a capture completes
  useEffect(() => {
    if (analysisSession.state !== "result" || !analysisSession.result) return;

    const sessionKey = analysisSession.result.jobId;
    if (!sessionKey || processedSessionsRef.current.has(sessionKey)) return;

    processedSessionsRef.current.add(sessionKey);
    const idx = outputCountRef.current;
    outputCountRef.current += 1;

    if (idx === 0) {
      // Update the static 'output' node in-place
      setNodesLocal((nds: Node[]) =>
        nds.map((n: Node) => {
          if (n.id !== "output") return n;
          return {
            ...n,
            data: {
              ...n.data,
              state: "result",
              result: analysisSession.result,
              vector: analysisSession.type,
            },
          };
        }),
      );
    } else {
      // Chain a new output node below the previous one
      const prevId =
        idx === 1
          ? "output"
          : `output-${[...processedSessionsRef.current][idx - 1]}`;
      const newId = `output-${sessionKey}`;

      const newNode: Node = {
        id: newId,
        type: "custom",
        position: { x: 250, y: 580 + idx * 420 },
        data: {
          outputNode: true,
          state: "result",
          result: analysisSession.result,
          vector: analysisSession.type,
        },
      };

      const newEdge: Edge = {
        id: `e-${prevId}-${newId}`,
        source: prevId,
        target: newId,
        animated: true,
        style: { stroke: "#888", strokeWidth: 1.5, strokeDasharray: "5 3" },
      };

      setNodesLocal((nds: Node[]) => [...nds, newNode]);
      setEdgesLocal((eds: Edge[]) => [...eds, newEdge]);
    }
  }, [analysisSession, setNodesLocal, setEdgesLocal]);

  // Reset on new session
  useEffect(() => {
    if (analysisSession.state === "idle") {
      processedSessionsRef.current = new Set();
      outputCountRef.current = 0;
      // Note: Flow reset is now handled via explicit setFlow or context initial state
    }
  }, [analysisSession.state]);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdgesLocal((eds: Edge[]) => addEdge(params, eds)),
    [setEdgesLocal],
  );

  // Handle drag and drop
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow");

      if (typeof type === "undefined" || !type) {
        return;
      }

      const nodeData = JSON.parse(type);

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Offset slightly so mouse drops in the center of a typical node
      position.x -= 75;
      position.y -= 40;

      const newNode: Node = {
        id: `${nodeData.id}-${Date.now()}`,
        type: nodeData.type,
        position,
        data: nodeData.data,
      };

      const isSpikeNode = !!nodeData.data?.spikeOptions;
      const fftNode = isSpikeNode
        ? (nodesRef.current
            .filter((node) => node.data?.fftOptions)
            .sort((a, b) => a.position.y - b.position.y)[0] ?? null)
        : null;
      const placedNode =
        isSpikeNode && fftNode
          ? {
              ...newNode,
              position: {
                x: fftNode.position.x,
                y: fftNode.position.y + 180,
              },
            }
          : newNode;

      setNodesLocal((nds: Node[]) => nds.concat(placedNode));

      if (!isSpikeNode || !fftNode) {
        return;
      }

      const nextEdge: Edge = {
        id: `e-${fftNode.id}-${newNode.id}`,
        source: fftNode.id,
        target: newNode.id,
        animated: true,
        style: {
          stroke: "#00d4ffaa",
          strokeWidth: 2,
          strokeDasharray: "5 5",
        },
      };

      setEdgesLocal((eds: Edge[]) => {
        if (
          eds.some(
            (edge) =>
              edge.source === fftNode.id && edge.target === newNode.id,
          )
        ) {
          return eds;
        }
        return [...eds, nextEdge];
      });

      window.requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("demod-flow-node-resize"));
      });
    },
    [setNodesLocal, setEdgesLocal, screenToFlowPosition],
  );

  // Handle keyboard shortcuts
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      const activeElement = document.activeElement as HTMLElement | null;
      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.tagName === "SELECT" ||
          activeElement.isContentEditable)
      ) {
        return;
      }
      const selectedNodes = nodesRef.current.filter(
        (node) => node.selected && node.data?.nonRemovable !== true,
      );
      const selectedEdges = edgesRef.current.filter((edge) => edge.selected);
      if (selectedNodes.length === 0 && selectedEdges.length === 0) {
        return;
      }
      deleteElements({ nodes: selectedNodes, edges: selectedEdges });
    },
    [deleteElements],
  );

  useEffect(() => {
    onKeyDownRef.current = onKeyDown;
  }, [onKeyDown]);

  // Add keyboard event listener
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => onKeyDownRef.current(event);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <FlowContainer
      ref={reactFlowWrapper}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ position: "relative" }}
    >
      <VisibleFrequencyRangeContext.Provider value={visibleFrequencyRange}>
        <StyledReactFlow
          nodes={nodes}
          edges={edges}
          style={{
            // Keep the canvas visible while source-specific nodes are adapted
            // and measured; hiding the whole graph causes a distracting flash.
            opacity: 1,
          }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          attributionPosition="bottom-left"
          panOnDrag={true}
          selectionOnDrag={false}
          elementsSelectable={true}
          defaultViewport={defaultViewport}
          onlyRenderVisibleElements={
            isFlowTransitioning || !graphFramed
              ? false
              : shouldVirtualizeDemodFlowNodes(nodes)
          }
          fitView={false}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#666"
          />
          <Controls />
        </StyledReactFlow>
      </VisibleFrequencyRangeContext.Provider>

      {menu && (
        <ContextMenuPanel style={{ top: menu.top, left: menu.left }}>
          <ContextMenuItem
            onClick={() => {
              const node = nodes.find((n) => n.id === menu.id);
              if (node) {
                const newNode = {
                  ...node,
                  id: `${node.id}-copy-${Date.now()}`,
                  position: {
                    x: node.position.x + 50,
                    y: node.position.y + 50,
                  },
                  selected: false,
                };
                setNodesLocal((nds: Node[]) => [...nds, newNode as Node]);
              }
              setMenu(null);
            }}
          >
            Duplicate Node
          </ContextMenuItem>

          {(menu.type === "bitstream" || menu.type === "symbols") && (
            <ContextMenuItem
              onClick={() => {
                const nodeEl = document.querySelector(
                  `.react-flow__node[data-id="${menu.id}"]`,
                );
                if (nodeEl) {
                  const maximizeIcon = nodeEl.querySelector(
                    "svg.lucide-maximize",
                  );
                  const btn = maximizeIcon?.closest("button");
                  if (btn) btn.click();
                }
                setMenu(null);
              }}
            >
              Open Fullscreen
            </ContextMenuItem>
          )}

          <ContextMenuItem
            style={{ color: "#ff4444" }}
            onClick={() => {
              deleteElements({ nodes: [{ id: menu.id }] });
              setMenu(null);
            }}
          >
            Delete Node
          </ContextMenuItem>
        </ContextMenuPanel>
      )}
    </FlowContainer>
  );
};

// Main component uses the top-level ReactFlowProvider from AppRoutes.
export const DemodRouteSection: React.FC = () => {
  return <DemodRouteSectionInner />;
};

export default DemodRouteSection;
