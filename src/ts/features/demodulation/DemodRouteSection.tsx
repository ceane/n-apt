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
  useNodesInitialized,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDemodAnalysis } from "@n-apt/demodulation/context/DemodAnalysisContext";
import { useDemodFlow } from "@n-apt/demodulation/context/DemodFlowContext";
import { useAppSelector } from "@n-apt/redux";
import {
  StimulusNode,
  SignalConfigNode,
  MetadataNode,
  SourceNode,
  CoreMLNode,
  SpikeDetectionNode,
  BeatNode,
  FFTNode,
  WaterfallNode,
  SpectogramNode,
  ChannelNode,
  ChannelOptionsNode,
  SpanNode,
  AnalysisNode,
  AptNode,
  FmNode,
  FileOptionsNode,
  RadioNode,
  StreamNode,
  TempoNoteNode,
  OutputNode,
  IQCaptureNode,
  SymbolsTable,
  BitstreamViewer,
  TxNode,
  TxSignalConfigNode,
} from "@n-apt/demodulation/react-flow/nodes";
import {
  NodeContainer,
  FlowContainer,
} from "@n-apt/demodulation/react-flow/flows";
import {
  DEMOD_FIT_VIEW_OPTIONS,
  shouldRunDemodAutoLayout,
  shouldDeferDemodAutoLayout,
  shouldVirtualizeDemodFlowNodes,
  resolveDemodElkConstructor,
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
  let content: React.ReactNode;

  if (data.sourceNode) content = <SourceNode data={data} />;
  else if (data.coremlOptions) content = <CoreMLNode data={data} />;
  else if (data.spikeOptions) content = <SpikeDetectionNode data={data} />;
  else if (data.beatOptions) content = <BeatNode data={data} />;
  else if (data.fftOptions) content = <FFTNode data={data} id={id} />;
  else if (data.waterfallOptions) content = <WaterfallNode data={data} />;
  else if (data.spectogramOptions) content = <SpectogramNode data={data} />;
  else if (data.channelNode) content = <ChannelNode data={data} />;
  else if (data.txSignalOptions) content = <TxSignalConfigNode data={data} />;
  else if (data.signalOptions) content = <SignalConfigNode data={data} />;
  else if (data.metadataNode) content = <MetadataNode data={data} />;
  else if (data.channelOptions) content = <ChannelOptionsNode data={data} />;
  else if (data.spanOptions) content = <SpanNode data={data} />;
  else if (data.stimulusOptions) content = <StimulusNode data={data} />;
  else if (data.tempoNoteOptions) content = <TempoNoteNode data={data} />;
  else if (data.radioOptions) content = <RadioNode data={data} />;
  else if (data.streamOptions) content = <StreamNode data={data} />;
  else if (data.analysisOptions) content = <AnalysisNode data={data} />;
  else if (data.aptOptions) content = <AptNode data={data} />;
  else if (data.fmOptions) content = <FmNode data={data} />;
  else if (data.fileOptions) content = <FileOptionsNode data={data} />;
  else if (data.iqCaptureNode) content = <IQCaptureNode data={data} />;
  else if (data.txOptions) content = <TxNode data={data} />;
  else if (data.outputNode) content = <OutputNode data={data} />;
  else {
    content = (
      <div className="node-container">
        <div className="node-title">{data.label}</div>
        <div className="node-description">{data.description}</div>
      </div>
    );
  }

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
      {content}
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
          <SymbolsTable frequencyRange={frequencyRange} />
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
        <BitstreamViewer frequencyRange={frequencyRange} />
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
    if (nodeProps.data?.symbolOptions || nodeProps.data?.bitstreamOptions) {
      return <FrequencyAwareNode {...nodeProps} />;
    }

    return <CustomNode {...nodeProps} />;
  },
};

let elkBrowserScriptPromise: Promise<void> | null = null;

const ensureElkBrowserGlobal = () => {
  if (typeof document === "undefined") return Promise.resolve();
  if ((globalThis as { ELK?: unknown }).ELK) return Promise.resolve();
  elkBrowserScriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-n-apt-elk="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("ELK script failed to load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "/node_modules/elkjs/lib/elk.bundled.js";
    script.dataset.nAptElk = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("ELK script failed to load"));
    document.head.appendChild(script);
  });
  return elkBrowserScriptPromise;
};

// Inner component that uses React Flow hooks
const DemodRouteSectionInner: React.FC = () => {
  const { analysisSession } = useDemodAnalysis();
  const { flowVersion } = useDemodFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { deleteElements, fitView, screenToFlowPosition } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
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
  const elkRef = useRef<any>(null);
  const layoutRunIdRef = useRef(0);
  const shouldFitAfterLayoutRef = useRef(true);
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

  const measureAndLayout = useCallback(
    async (force: boolean = false) => {
      if (!reactFlowWrapper.current) return;
      const wrapper = reactFlowWrapper.current;
      const currentRunId = ++layoutRunIdRef.current;

      // Use React Flow's built-in measurements if available, else fallback to DOM, else 400x300
      const sizeMap = new Map<string, { w: number; h: number }>();
      const nodeEls = wrapper.querySelectorAll<HTMLElement>("[data-nodeid]");
      nodeEls.forEach((el) => {
        const id = el.getAttribute("data-nodeid");
        if (id) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            sizeMap.set(id, { w: rect.width, h: rect.height });
          }
        }
      });

      const getDimensions = (node: Node) => {
        // React Flow v11+ internal measurement
        if (node.measured?.width && node.measured?.height) {
          return { w: node.measured.width, h: node.measured.height };
        }
        // DOM fallback
        const domSz = sizeMap.get(node.id);
        if (domSz) return domSz;
        // Default guess
        return { w: 400, h: 300 };
      };

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

      // Create cache key from node IDs, sizes, and edges
      const cacheKey = JSON.stringify({
        nodes: nodesRef.current.map((n) => ({ id: n.id, type: n.type })),
        edges: edgesRef.current.map((e) => ({
          source: e.source,
          target: e.target,
        })),
        sizes: Array.from(sizeMap.entries()),
      });

      // Check cache for existing layout
      const cachedLayout = layoutCacheRef.current.get(cacheKey);
      if (cachedLayout && !force) {
        setNodesLocal((nds: Node[]) => {
          return nds.map((node: Node) => {
            const cachedNode = cachedLayout.find((n: any) => n.id === node.id);
            if (cachedNode) {
              return {
                ...node,
                position: { x: cachedNode.x, y: cachedNode.y },
              };
            }
            return node;
          });
        });
        setIsLaidOut(true);
        setIsFlowTransitioning(false);
        hasLaidOut.current = true;
        shouldFitAfterLayoutRef.current = false;
        void fitView({
          ...DEMOD_FIT_VIEW_OPTIONS,
        });
        return;
      }

      try {
        if (!elkRef.current) {
          const ELKModule = await import("elkjs/lib/elk.bundled.js");
          const ELKConstructor =
            resolveDemodElkConstructor(ELKModule) ??
            resolveDemodElkConstructor(
              (globalThis as { ELK?: unknown }).ELK,
            );
          if (ELKConstructor) {
            elkRef.current = new ELKConstructor();
          } else {
            await ensureElkBrowserGlobal();
            const BrowserELK = resolveDemodElkConstructor(
              (globalThis as { ELK?: unknown }).ELK,
            );
            if (!BrowserELK) {
              throw new Error("Unable to resolve the ELK layout constructor");
            }
            elkRef.current = new BrowserELK();
          }
        }
        const elk = elkRef.current;

        // Preserve the current visual order so source changes do not cause
        // the flow to flash or reshuffle. ELK still receives the live node
        // list, but we keep the existing ordering stable.
        const sortedNodes = nodesRef.current.slice();

        const graph = {
          id: "root",
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": "DOWN",
            "elk.spacing.nodeNode": "60",
            "elk.layered.spacing.nodeNodeBetweenLayers": "80",
            "elk.alignment": "CENTER",
            "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
          },
          children: sortedNodes.map((node: Node) => {
            const dims = getDimensions(node);
            return {
              id: node.id,
              width: dims.w,
              height: dims.h,
            };
          }),
          edges: edgesRef.current.map((edge: Edge) => ({
            id: edge.id,
            sources: [edge.source],
            targets: [edge.target],
          })),
        };

        const layoutedGraph = await elk.layout(graph);
        if (layoutRunIdRef.current !== currentRunId) {
          return;
        }

        // Cache the layout result
        layoutCacheRef.current.set(cacheKey, layoutedGraph.children);

        setNodesLocal((nds: Node[]) => {
          let hasPositionChanges = false;
          const isTxSuite = nodesRef.current.some(
            (candidate) => candidate.data?.txSuite === true,
          );
          const txSuiteLayout: Record<string, { x: number; y: number }> = {
            source: { x: 425, y: 40 },
            "tx-settings": { x: 40, y: 360 },
            "tx-signal-config": { x: 40, y: 850 },
            "tx-fft": { x: 40, y: 1350 },
            "tx-waterfall": { x: 40, y: 1900 },
            "rx-channel": { x: 650, y: 360 },
            "rx-signal-config": { x: 1250, y: 360 },
            "rx-fft": { x: 650, y: 1350 },
            "rx-waterfall": { x: 650, y: 1900 },
          };
          const nextNodes = nds.map((node: Node) => {
            const layoutNode = layoutedGraph.children?.find(
              (n: { id: string }) => n.id === node.id,
            );
            // If ELK failed to position this node, preserve its current position to avoid stacking at 0,0
            if (
              !layoutNode ||
              layoutNode.x === undefined ||
              layoutNode.y === undefined
            )
              return node;

            let targetX = layoutNode.x;
            let targetY = layoutNode.y;

            if (isTxSuite && txSuiteLayout[node.id]) {
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
          window.requestAnimationFrame(() => {
            if (layoutRunIdRef.current !== currentRunId) {
              return;
            }
            setIsLaidOut(true);
            setIsFlowTransitioning(false);
            hasLaidOut.current = true;
            shouldFitAfterLayoutRef.current = false;
            void fitView({
              ...DEMOD_FIT_VIEW_OPTIONS,
            });
          });
        } else {
          setIsLaidOut(true);
          setIsFlowTransitioning(false);
          hasLaidOut.current = true;
        }
      } catch (error) {
        console.error("Layout error:", error);
      }
    },
    [fitView, setNodesLocal, setEdgesLocal],
  );

  const nodeTypes = useMemo(() => NODE_TYPES, []);

  const scheduleMeasureAndLayout = useCallback(
    (force: boolean = false) => {
      if (layoutFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(layoutFrameRef.current);
      }

      if (typeof window === "undefined") {
        void measureAndLayout(force);
        return;
      }

      layoutFrameRef.current = window.requestAnimationFrame(() => {
        layoutFrameRef.current = null;
        void measureAndLayout(force);
      });
    },
    [measureAndLayout],
  );

  useEffect(() => {
    if (
      shouldDeferDemodAutoLayout({
        hasNodes: nodes.length > 0,
        nodesInitialized,
      })
    ) {
      return;
    }
    if (!shouldRunDemodAutoLayout(flowVersion)) {
      hasLaidOut.current = true;
      shouldFitAfterLayoutRef.current = false;
      setIsFlowTransitioning(false);
      const frame = window.requestAnimationFrame(() => {
        void fitView({
          ...DEMOD_FIT_VIEW_OPTIONS,
        });
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
    nodesInitialized,
    flowVersion,
    fitView,
    scheduleMeasureAndLayout,
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
        scheduleMeasureAndLayout(true);
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
    // Keep local React Flow state as the source of truth.
  }, [nodes, edges]);

  useEffect(() => {
    const onNodeResize = () => {
      shouldFitAfterLayoutRef.current = true;
      scheduleMeasureAndLayout(true);
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

      setNodesLocal((nds: Node[]) => {
        const isSpikeNode = !!nodeData.data?.spikeOptions;
        const fftNode = isSpikeNode
          ? (nds
              .filter((node) => node.data?.fftOptions)
              .sort((a, b) => a.position.y - b.position.y)[0] ?? null)
          : null;
        const nextNode =
          isSpikeNode && fftNode
            ? {
                ...newNode,
                position: {
                  x: fftNode.position.x,
                  y: fftNode.position.y + 180,
                },
              }
            : newNode;
        const nextNodes = nds.concat(nextNode);
        if (!isSpikeNode || !fftNode) {
          return nextNodes;
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

        return nextNodes;
      });
    },
    [setNodesLocal, setEdgesLocal, screenToFlowPosition],
  );

  // Handle keyboard shortcuts
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteElements({ nodes: [], edges: [] });
      }
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
          onlyRenderVisibleElements={
            isFlowTransitioning
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
