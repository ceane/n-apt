import React, { useCallback, useMemo, useRef, useEffect } from "react";
import styled from "styled-components";
import { Play } from "lucide-react";
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  Connection,
  ConnectionMode,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlowProvider
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDemod } from "@n-apt/contexts/DemodContext";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import {
  StimulusNode,
  SignalConfigNode,
  SourceNode,
  CoreMLNode,
  SpikeNode,
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
  NodeContainer,
  SymbolsTable,
  BitstreamViewer
} from "@n-apt/components/react-flow/nodes";

const FlowContainer = styled.div`
  width: 100%;
  height: 100%;
  background-color: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.border};
  overflow: hidden;
  position: relative;
  z-index: 1;
  isolation: isolate;
  flex: 1;
`;



const BottomControlBar = styled.div`
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background-color: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10;
`;

const PlayButton = styled.button`
  background-color: ${(props) => props.theme.primary};
  color: white;
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 16px;

  &:hover {
    background-color: ${(props) => props.theme.primaryHover};
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }
`;

const ContextMenuPanel = styled.div`
  position: fixed;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
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
  border-radius: 4px;
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

  .react-flow__controls {
    background-color: ${(props) => props.theme.surface} !important;
    border: 1px solid ${(props) => props.theme.border} !important;
    border-radius: 8px !important;
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
// Removed local SignalOptions component — now imported from @n-apt/components/react-flow/nodes

const CustomNode: React.FC<{ data: any; id: string }> = ({ data, id }) => {
  // Node-level state and logic handled by delegated components

  const renderNodeContent = () => {
    const { state: spectrumState, sampleRateMHz } = useSpectrumStore();
    const { activeSignalArea, frequencyRange, lastKnownRanges, vizZoom, vizPanOffset } = spectrumState;
    const areaKey = activeSignalArea || "A";

    const calculateVisible = () => {
      const minFreq = 0;
      const maxFreq = 2000;
      const hardwareSpan = sampleRateMHz || 3.2;

      const safeZoom = (Number.isFinite(vizZoom) && vizZoom > 0) ? vizZoom : 1;

      if (!frequencyRange) {
        return lastKnownRanges[areaKey] || { min: minFreq, max: minFreq + hardwareSpan };
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

    const freqRange = calculateVisible();

    if (data.sourceNode) return <SourceNode data={data} />;
    if (data.coremlOptions) return <CoreMLNode data={data} />;
    if (data.spikeOptions) return <SpikeNode data={data} />;
    if (data.beatOptions) return <BeatNode data={data} />;
    if (data.fftOptions) return <FFTNode data={data} />;
    if (data.waterfallOptions) return <WaterfallNode data={data} />;
    if (data.spectogramOptions) return <SpectogramNode data={data} />;
    if (data.channelNode) return <ChannelNode data={data} />;
    if (data.signalOptions) return <SignalConfigNode data={data} />;
    if (data.channelOptions) return <ChannelOptionsNode data={data} />;
    if (data.spanOptions) return <SpanNode data={data} />;
    if (data.stimulusOptions) return <StimulusNode data={data} />;
    if (data.tempoNoteOptions) return <TempoNoteNode data={data} />;
    if (data.radioOptions) return <RadioNode data={data} />;
    if (data.streamOptions) return <StreamNode data={data} />;
    if (data.analysisOptions) return <AnalysisNode data={data} />;
    if (data.aptOptions) return <AptNode data={data} />;
    if (data.fmOptions) return <FmNode data={data} />;
    if (data.fileOptions) return <FileOptionsNode data={data} />;
    if (data.outputNode) return <OutputNode data={data} />;
    if (data.symbolOptions) return <SymbolsTable frequencyRange={freqRange} />;
    if (data.bitstreamOptions) return <BitstreamViewer frequencyRange={freqRange} />;

    return (
      <div className="node-container">
        <div className="node-title">{data.label}</div>
        <div className="node-description">{data.description}</div>
      </div>
    );
  };

  return (
    <NodeContainer data-nodeid={id}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#666', border: '1px solid #999', width: '8px', height: '8px' }}
      />
      {renderNodeContent()}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#666', border: '1px solid #999', width: '8px', height: '8px' }}
      />
    </NodeContainer>
  );
};

// Inner component that uses React Flow hooks
const DemodRouteSectionInner: React.FC = () => {
  const { analysisSession, flowNodes, setFlowNodes, flowEdges, setFlowEdges } = useDemod();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { deleteElements, fitView, screenToFlowPosition } = useReactFlow();

  const hasLaidOut = useRef(flowNodes.length > 0);

  // Define node types
  const nodeTypes = useMemo(() => ({
    custom: CustomNode,
  }), []);

  // Define initial nodes — Source → Channel → Signal Config fan-out
  const initialNodes: Node[] = useMemo(() => [
    {
      id: 'source',
      type: 'custom',
      position: { x: 250, y: 50 },
      data: {
        label: 'Source',
        sourceNode: true,
        nonRemovable: true,
      },
    },
    {
      id: 'channel',
      type: 'custom',
      position: { x: 250, y: 260 },
      data: {
        label: 'Channel',
        channelNode: true,
        nonRemovable: true,
      },
    },
    {
      id: 'signalOptions',
      type: 'custom',
      position: { x: 250, y: 480 },
      data: {
        label: 'Signal Configuration',
        signalOptions: true,
      },
    },
    {
      id: 'symbols',
      type: 'custom',
      position: { x: 50, y: 860 },
      data: {
        label: 'Symbol (I/Q) Analysis',
        symbolOptions: true,
      },
    },
    {
      id: 'bitstream',
      type: 'custom',
      position: { x: 250, y: 860 },
      data: {
        label: 'Bitstream Analysis',
        bitstreamOptions: true,
      },
    },
    {
      id: 'stimulus',
      type: 'custom',
      position: { x: 450, y: 860 },
      data: {
        label: 'Stimulus',
        stimulusOptions: true,
        subtext: 'Capture N-APT signals with a know baseline for demod later. Media is played while recording in order to learn what is where.',
      },
    },
    {
      id: 'output',
      type: 'custom',
      position: { x: 450, y: 1260 },
      data: { outputNode: true, state: 'idle' },
    },
  ], []);

  const initialEdges: Edge[] = useMemo(() => [
    {
      id: 'e-source-channel',
      source: 'source',
      target: 'channel',
      animated: true,
      style: { stroke: '#00d4ff', strokeWidth: 2 },
    },
    {
      id: 'e-channel-signalOptions',
      source: 'channel',
      target: 'signalOptions',
      animated: true,
      style: { stroke: '#00d4ffaa', strokeWidth: 2, strokeDasharray: '5 5' },
    },
    {
      id: 'e-signalOptions-symbols',
      source: 'signalOptions',
      target: 'symbols',
      animated: true,
      style: { stroke: '#00d4ffaa', strokeWidth: 2, strokeDasharray: '5 5' },
    },
    {
      id: 'e-signalOptions-bitstream',
      source: 'signalOptions',
      target: 'bitstream',
      animated: true,
      style: { stroke: '#00d4ffaa', strokeWidth: 2, strokeDasharray: '5 5' },
    },
    {
      id: 'e-signalOptions-stimulus',
      source: 'signalOptions',
      target: 'stimulus',
      animated: true,
      style: { stroke: '#a855f7', strokeWidth: 2 },
    },
    {
      id: 'e-stimulus-output',
      source: 'stimulus',
      target: 'output',
      animated: true,
      style: { stroke: '#e100ff', strokeWidth: 2 },
    },
  ], []);

  const [nodes, setNodesLocal, onNodesChange] = useNodesState(flowNodes.length > 0 ? flowNodes : initialNodes);
  const [edges, setEdgesLocal, onEdgesChange] = useEdgesState(flowEdges.length > 0 ? flowEdges : initialEdges);

  // Sync with global context to survive navigation
  useEffect(() => {
    setFlowNodes(nodes);
  }, [nodes, setFlowNodes]);

  useEffect(() => {
    setFlowEdges(edges);
  }, [edges, setFlowEdges]);

  const [isLaidOut, setIsLaidOut] = React.useState(flowNodes.length > 0);

  const [menu, setMenu] = React.useState<{ id: string, type: string, top: number, left: number } | null>(null);

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
    []
  );

  const onPaneClick = useCallback(() => {
    setMenu(null);
  }, []);

  const measureAndLayout = useCallback(async () => {
    if (!reactFlowWrapper.current) return;
    const wrapper = reactFlowWrapper.current;

    // Use React Flow's built-in measurements if available, else fallback to DOM, else 400x300
    const sizeMap = new Map<string, { w: number; h: number }>();
    const nodeEls = wrapper.querySelectorAll<HTMLElement>('[data-nodeid]');
    nodeEls.forEach((el) => {
      const id = el.getAttribute('data-nodeid');
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

    try {
      const ELKModule = await import('elkjs/lib/elk.bundled.js');
      // Handle both ES module default and direct export
      const ELKConstructor = ELKModule.default || (ELKModule as any);
      const elk = new ELKConstructor();

      // Sort nodes to guarantee Bitstream -> Stimulus -> Symbols ordering in ELK's eyes
      const sortedNodes = [...nodes].sort((a, b) => {
        const order = ['source', 'channel', 'signalOptions', 'bitstream', 'stimulus', 'symbols', 'output'];
        return order.indexOf(a.id) - order.indexOf(b.id);
      });

      const graph = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.spacing.nodeNode': '60',
          'elk.layered.spacing.nodeNodeBetweenLayers': '80',
          'elk.alignment': 'CENTER',
          'elk.layered.crossingMinimization.forceNodeModelOrder': 'true'
        },
        children: sortedNodes.map((node) => {
          const dims = getDimensions(node);
          return {
            id: node.id,
            width: dims.w,
            height: dims.h
          };
        }),
        edges: edges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })),
      };

      const layoutedGraph = await elk.layout(graph);

      setNodesLocal((nds) => {
        const stimulusElkNode = layoutedGraph.children?.find((n) => n.id === 'stimulus');
        const stimulusCenterX = stimulusElkNode && stimulusElkNode.x !== undefined && stimulusElkNode.width !== undefined
          ? stimulusElkNode.x + stimulusElkNode.width / 2
          : 0;

        return nds.map((node) => {
          const layoutNode = layoutedGraph.children?.find((n) => n.id === node.id);
          // If ELK failed to position this node, preserve its current position to avoid stacking at 0,0
          if (!layoutNode || layoutNode.x === undefined || layoutNode.y === undefined) return node;

          let targetX = layoutNode.x;

          // Force vertical visual centering for the top chain relative to the Stimulus node
          const isTopChain = ['source', 'channel', 'signalOptions'].includes(node.id);
          if (isTopChain && stimulusCenterX > 0 && layoutNode.width) {
            targetX = stimulusCenterX - layoutNode.width / 2;
          }

          return {
            ...node,
            position: { x: targetX, y: layoutNode.y },
          };
        });
      });

      // Fit after positions settle
      setTimeout(() => {
        setIsLaidOut(true);
        void fitView({ padding: 0.15, includeHiddenNodes: false, duration: 200, minZoom: 0.3, maxZoom: 1.2 });
      }, 50);
    } catch (error) {
      console.error("ELK Layout failed:", error);
    }
  }, [nodes, edges, fitView, setNodesLocal]);

  // After first render, measure real DOM sizes and reposition
  useEffect(() => {
    if (hasLaidOut.current) return;
    const timer = setTimeout(() => {
      hasLaidOut.current = true;
      measureAndLayout();
    }, 300);
    return () => clearTimeout(timer);
  }, [measureAndLayout]);

  // Re-layout on window resize
  useEffect(() => {
    const onResize = () => measureAndLayout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureAndLayout]);

  useEffect(() => {
    // Keep local React Flow state as the source of truth.
  }, [nodes, edges]);

  // Track which sessions have already produced an output node
  const processedSessionsRef = useRef<Set<string>>(new Set());

  // Count output nodes for positioning
  const outputCountRef = useRef(0);

  // Populate Output node (or chain new ones) when a capture completes
  useEffect(() => {
    if (analysisSession.state !== 'result' || !analysisSession.result) return;

    const sessionKey = analysisSession.result.jobId;
    if (!sessionKey || processedSessionsRef.current.has(sessionKey)) return;

    processedSessionsRef.current.add(sessionKey);
    const idx = outputCountRef.current;
    outputCountRef.current += 1;

    if (idx === 0) {
      // Update the static 'output' node in-place
      setNodesLocal(nds => nds.map(n => {
        if (n.id !== 'output') return n;
        return {
          ...n,
          data: {
            ...n.data,
            state: 'result',
            result: analysisSession.result,
            vector: analysisSession.type,
          },
        };
      }));
    } else {
      // Chain a new output node below the previous one
      const prevId = idx === 1 ? 'output' : `output-${[...processedSessionsRef.current][idx - 1]}`;
      const newId = `output-${sessionKey}`;

      const newNode: Node = {
        id: newId,
        type: 'custom',
        position: { x: 250, y: 580 + idx * 420 },
        data: {
          outputNode: true,
          state: 'result',
          result: analysisSession.result,
          vector: analysisSession.type,
        },
      };

      const newEdge: Edge = {
        id: `e-${prevId}-${newId}`,
        source: prevId,
        target: newId,
        animated: true,
        style: { stroke: '#888', strokeWidth: 1.5, strokeDasharray: '5 3' },
      };

      setNodesLocal(nds => [...nds, newNode]);
      setEdgesLocal(eds => [...eds, newEdge]);
    }
  }, [analysisSession, setNodesLocal, setEdgesLocal]);

  // Reset on new session
  useEffect(() => {
    if (analysisSession.state === 'idle') {
      processedSessionsRef.current = new Set();
      outputCountRef.current = 0;
      setNodesLocal(initialNodes);
      setEdgesLocal(initialEdges);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisSession.state]);

  const onConnect = useCallback(
    (params: Connection) => setEdgesLocal((eds) => addEdge(params, eds)),
    [setEdgesLocal]
  );

  // Handle drag and drop
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');

      if (typeof type === 'undefined' || !type) {
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

      setNodesLocal((nds) => nds.concat(newNode));
    },
    [setNodesLocal, screenToFlowPosition]
  );

  // Handle keyboard shortcuts
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteElements({ nodes: [], edges: [] });
      }
    },
    [deleteElements]
  );

  // Add keyboard event listener
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onKeyDown]);

  return (
    <FlowContainer
      ref={reactFlowWrapper}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <StyledReactFlow
        nodes={nodes}
        edges={edges}
        style={{ opacity: isLaidOut ? 1 : 0, transition: 'opacity 0.2s ease-in' }}
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
        fitView={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#666" />
        <Controls />
      </StyledReactFlow>

      <BottomControlBar>
        <PlayButton onClick={() => console.log('Play button clicked')}>
          <Play size={20} />
        </PlayButton>
      </BottomControlBar>

      {menu && (
        <ContextMenuPanel style={{ top: menu.top, left: menu.left }}>
          <ContextMenuItem
            onClick={() => {
              const node = nodes.find((n) => n.id === menu.id);
              if (node) {
                const newNode = {
                  ...node,
                  id: `${node.id}-copy-${Date.now()}`,
                  position: { x: node.position.x + 50, y: node.position.y + 50 },
                  selected: false,
                };
                setNodesLocal((nds) => [...nds, newNode as Node]);
              }
              setMenu(null);
            }}
          >
            Duplicate Node
          </ContextMenuItem>

          {(menu.type === 'bitstream' || menu.type === 'symbols') && (
            <ContextMenuItem
              onClick={() => {
                const nodeEl = document.querySelector(`.react-flow__node[data-id="${menu.id}"]`);
                if (nodeEl) {
                  const maximizeIcon = nodeEl.querySelector('svg.lucide-maximize');
                  const btn = maximizeIcon?.closest('button');
                  if (btn) btn.click();
                }
                setMenu(null);
              }}
            >
              Open Fullscreen
            </ContextMenuItem>
          )}

          <ContextMenuItem
            style={{ color: '#ff4444' }}
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

// Main component that wraps with ReactFlowProvider
export const DemodRouteSection: React.FC = () => {
  return (
    <ReactFlowProvider>
      <DemodRouteSectionInner />
    </ReactFlowProvider>
  );
};

export default DemodRouteSection;
