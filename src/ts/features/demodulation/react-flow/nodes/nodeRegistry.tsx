import React, { Suspense, useCallback, useEffect, useRef } from "react";
import { SourceNode } from "@n-apt/demodulation/react-flow/nodes/SourceNode";
import { MetadataNode } from "@n-apt/demodulation/react-flow/nodes/MetadataNode";
import { SpanNode } from "@n-apt/demodulation/react-flow/nodes/SpanNode";
import { SignalConfigNode } from "@n-apt/demodulation/react-flow/nodes/SignalConfigNode";
import { StimulusNode } from "@n-apt/demodulation/react-flow/nodes/StimulusNode";
import { OutputNode } from "@n-apt/demodulation/react-flow/nodes/OutputNode";

export interface DemodNodeData {
  label?: React.ReactNode;
  description?: string;
  [key: string]: unknown;
}

type DemodNodeComponent = React.ComponentType<{ data: any; id?: string }>;

const LazyCoreMLNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/CoreMLNode").then((m) => ({
    default: m.CoreMLNode as DemodNodeComponent,
  })),
);
const LazySpikeDetectionNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/SpikeDetectionNode").then(
    (m) => ({ default: m.SpikeDetectionNode as DemodNodeComponent }),
  ),
);
const LazyBeatNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/BeatNode").then((m) => ({
    default: m.BeatNode as DemodNodeComponent,
  })),
);
const LazyFFTNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/FFTNode").then((m) => ({
    default: m.FFTNode as DemodNodeComponent,
  })),
);
const LazyWaterfallNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/WaterfallNode").then((m) => ({
    default: m.WaterfallNode as DemodNodeComponent,
  })),
);
const LazySpectogramNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/SpectogramNode").then((m) => ({
    default: m.SpectogramNode as DemodNodeComponent,
  })),
);
const LazyChannelNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/ChannelNode").then((m) => ({
    default: m.ChannelNode as DemodNodeComponent,
  })),
);
const LazyTxSignalConfigNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/TxSignalConfigNode").then(
    (m) => ({ default: m.TxSignalConfigNode as DemodNodeComponent }),
  ),
);
const LazyChannelOptionsNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/ChannelOptionsNode").then(
    (m) => ({ default: m.ChannelOptionsNode as DemodNodeComponent }),
  ),
);
const LazyTempoNoteNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/TempoNoteNode").then((m) => ({
    default: m.TempoNoteNode as DemodNodeComponent,
  })),
);
const LazyRadioNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/RadioNode").then((m) => ({
    default: m.RadioNode as DemodNodeComponent,
  })),
);
const LazyStreamNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/StreamNode").then((m) => ({
    default: m.StreamNode as DemodNodeComponent,
  })),
);
const LazyAnalysisNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/AnalysisNode").then((m) => ({
    default: m.AnalysisNode as DemodNodeComponent,
  })),
);
const LazyAptNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/AptNode").then((m) => ({
    default: m.AptNode as DemodNodeComponent,
  })),
);
const LazyFmNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/FmNode").then((m) => ({
    default: m.FmNode as DemodNodeComponent,
  })),
);
const LazyFileOptionsNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/FileOptionsNode").then((m) => ({
    default: m.FileOptionsNode as DemodNodeComponent,
  })),
);
const LazyIQCaptureNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/IQCaptureNode").then((m) => ({
    default: m.IQCaptureNode as DemodNodeComponent,
  })),
);
const LazyTxNode = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/TxNode").then((m) => ({
    default: m.TxNode as DemodNodeComponent,
  })),
);

export const LazySymbolsTable = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/SymbolsTable").then((m) => ({
    default: m.SymbolsTable,
  })),
);
export const LazyBitstreamViewer = React.lazy(() =>
  import("@n-apt/demodulation/react-flow/nodes/BitstreamViewer").then((m) => ({
    default: m.BitstreamViewer,
  })),
);

interface DemodNodeRegistryEntry {
  flag: string;
  Component: DemodNodeComponent;
}

export const DEMOD_NODE_REGISTRY: DemodNodeRegistryEntry[] = [
  { flag: "sourceNode", Component: SourceNode },
  { flag: "coremlOptions", Component: LazyCoreMLNode },
  { flag: "spikeOptions", Component: LazySpikeDetectionNode },
  { flag: "beatOptions", Component: LazyBeatNode },
  { flag: "fftOptions", Component: LazyFFTNode },
  { flag: "waterfallOptions", Component: LazyWaterfallNode },
  { flag: "spectogramOptions", Component: LazySpectogramNode },
  { flag: "channelNode", Component: LazyChannelNode },
  { flag: "txSignalOptions", Component: LazyTxSignalConfigNode },
  { flag: "signalOptions", Component: SignalConfigNode },
  { flag: "metadataNode", Component: MetadataNode },
  { flag: "channelOptions", Component: LazyChannelOptionsNode },
  { flag: "spanOptions", Component: SpanNode },
  { flag: "stimulusOptions", Component: StimulusNode },
  { flag: "tempoNoteOptions", Component: LazyTempoNoteNode },
  { flag: "radioOptions", Component: LazyRadioNode },
  { flag: "streamOptions", Component: LazyStreamNode },
  { flag: "analysisOptions", Component: LazyAnalysisNode },
  { flag: "aptOptions", Component: LazyAptNode },
  { flag: "fmOptions", Component: LazyFmNode },
  { flag: "fileOptions", Component: LazyFileOptionsNode },
  { flag: "iqCaptureNode", Component: LazyIQCaptureNode },
  { flag: "txOptions", Component: LazyTxNode },
  { flag: "outputNode", Component: OutputNode },
];

export const resolveDemodNodeEntry = (
  data: Record<string, unknown>,
): DemodNodeRegistryEntry | null =>
  DEMOD_NODE_REGISTRY.find((entry) => data[entry.flag]) ?? null;

export const DefaultDemodNodeContent: React.FC<{ data: DemodNodeData }> = ({
  data,
}) => (
  <div className="node-container">
    <div className="node-title">{data.label}</div>
    <div className="node-description">{data.description}</div>
  </div>
);

const FallbackMountNotifier: React.FC<{
  onMount: () => void;
  onUnmount: () => void;
}> = ({ onMount, onUnmount }) => {
  useEffect(() => {
    onMount();
    return onUnmount;
  }, [onMount, onUnmount]);
  return null;
};

const ContentMountNotifier: React.FC<{ onMount: () => void }> = ({
  onMount,
}) => {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return null;
};

const pendingLazyLoads = { count: 0 };

export const hasPendingDemodLazyNodeContent = (): boolean =>
  pendingLazyLoads.count > 0;

export const DemodNodeSuspense: React.FC<{
  label?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, children }) => {
  const suspendedRef = useRef(false);

  const handleFallbackMounted = useCallback(() => {
    pendingLazyLoads.count += 1;
    suspendedRef.current = true;
  }, []);

  const handleFallbackUnmounted = useCallback(() => {
    if (!suspendedRef.current) return;
    suspendedRef.current = false;
    pendingLazyLoads.count = Math.max(0, pendingLazyLoads.count - 1);
  }, []);

  const handleContentMounted = useCallback(() => {
    if (!suspendedRef.current) return;
    suspendedRef.current = false;
    pendingLazyLoads.count = Math.max(0, pendingLazyLoads.count - 1);
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("demod-flow-node-resize"));
    });
  }, []);

  return (
    <Suspense
      fallback={
        <>
          <FallbackMountNotifier
            onMount={handleFallbackMounted}
            onUnmount={handleFallbackUnmounted}
          />
          <div className="node-container">
            <div className="node-title">{label}</div>
          </div>
        </>
      }
    >
      {children}
      <ContentMountNotifier onMount={handleContentMounted} />
    </Suspense>
  );
};
