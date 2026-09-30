import React from "react";
import { Zap, Activity, Waves, Music, Radio } from "lucide-react";
import type { Node, Edge } from "@xyflow/react";
import { FindBeatsFlow } from "@n-apt/demodulation/react-flow/flows/FindBeatsFlow";
import {
  REFERENCE_CAPTURE_NODE_POSITIONS,
} from "@n-apt/demodulation/react-flow/flows/demodFlowModel";

export interface FlowTemplate {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  nodes: Node[];
  edges: Edge[];
}

const flowTemplatesDefinition: FlowTemplate[] = [
  {
    id: "reverse-engineering",
    label: "Reverse Engineering by Tx",
    description: "Compare one HackRF Tx pattern at a time against the RTL-SDR's 3.2 MS/s receive window; HackRF's 20 MHz bandwidth does not widen Rx visibility.",
    icon: <Radio size={16} />,
    nodes: [
      {
        id: "source",
        type: "custom",
        position: { x: 520, y: 40 },
        data: {
          label: "Rx / Tx Devices",
          sourceNode: true,
          txSuiteSource: true,
          sourceBindingGroup: "reverse-engineering",
          reverseEngineeringFlow: true,
          preferredRxName: "RTL-SDR",
          preferredTxName: "HackRF",
        },
      },
      {
        id: "rx-channel",
        type: "custom",
        position: { x: 760, y: 320 },
        data: {
          label: "Rx Channel A / B / C",
          description: "Tune one channel at a time; RTL-SDR receive span is limited to 3.2 MS/s.",
          channelNode: true,
          channelLabels: ["A", "B", "C"],
          receiveSampleRateLimitHz: 3_200_000,
          sourceRole: "rx",
          sourceBindingGroup: "reverse-engineering",
        },
      },
      {
        id: "rx-signal-config",
        type: "custom",
        position: { x: 1160, y: 760 },
        data: { label: "RTL-SDR Receive Configuration", signalOptions: true, sourceRole: "rx", sourceBindingGroup: "reverse-engineering" },
      },
      {
        id: "tx-settings",
        type: "custom",
        position: { x: 100, y: 320 },
        data: { label: "HackRF Tx Settings", txOptions: true, sourceRole: "tx", sourceBindingGroup: "reverse-engineering" },
      },
      {
        id: "experiment-control",
        type: "custom",
        position: { x: 100, y: 800 },
        data: { label: "Tx Pattern Condition", experimentControlOptions: true, sourceBindingGroup: "reverse-engineering" },
      },
      {
        id: "tx-signal-config",
        type: "custom",
        position: { x: 100, y: 1370 },
        data: { label: "HackRF Tx Signal Configuration", txSignalOptions: true, sourceRole: "tx", sourceBindingGroup: "reverse-engineering" },
      },
      {
        id: "rx-fft",
        type: "custom",
        position: { x: 760, y: 1190 },
        data: { label: "RTL-SDR Receive Spectrum", fftOptions: true, sourceRole: "rx", sourceBindingGroup: "reverse-engineering" },
      },
      {
        id: "rx-waterfall",
        type: "custom",
        position: { x: 760, y: 1740 },
        data: { label: "RTL-SDR Receive History", waterfallOptions: true, showMiniVfo: true, miniVfoPosition: "top", sourceRole: "rx", sourceBindingGroup: "reverse-engineering" },
      },
      {
        id: "experiment-observation",
        type: "custom",
        position: { x: 760, y: 2390 },
        data: { label: "Observation Log", experimentObservationOptions: true, sourceBindingGroup: "reverse-engineering" },
      },
      {
        id: "tx-fft",
        type: "custom",
        position: { x: 100, y: 1900 },
        data: { label: "HackRF Tx Preview", fftOptions: true, sourceRole: "tx", sourceBindingGroup: "reverse-engineering" },
      },
      {
        id: "tx-waterfall",
        type: "custom",
        position: { x: 100, y: 2460 },
        data: { label: "HackRF Tx History", waterfallOptions: true, showMiniVfo: true, miniVfoPosition: "top", sourceRole: "tx", sourceBindingGroup: "reverse-engineering" },
      },
    ],
    edges: [
      { id: "reverse-source-rx", source: "source", target: "rx-channel", animated: true, style: { stroke: "#00d4ff" } },
      { id: "reverse-source-tx", source: "source", target: "tx-settings", animated: true, style: { stroke: "#a855f7" } },
      { id: "reverse-rx-channel-config", source: "rx-channel", target: "rx-signal-config", animated: true, style: { stroke: "#00d4ff" } },
      { id: "reverse-rx-config-fft", source: "rx-signal-config", target: "rx-fft", animated: true, style: { stroke: "#00d4ff" } },
      { id: "reverse-rx-fft-waterfall", source: "rx-fft", target: "rx-waterfall", animated: true, style: { stroke: "#00d4ff" } },
      { id: "reverse-rx-observation", source: "rx-fft", target: "experiment-observation", animated: true, style: { stroke: "#00d4ff" } },
      { id: "reverse-tx-condition", source: "tx-settings", target: "experiment-control", animated: true, style: { stroke: "#a855f7" } },
      { id: "reverse-tx-signal-config", source: "experiment-control", target: "tx-signal-config", animated: true, style: { stroke: "#a855f7" } },
      { id: "reverse-tx-preview", source: "tx-signal-config", target: "tx-fft", animated: true, style: { stroke: "#a855f7" } },
      { id: "reverse-tx-history", source: "tx-fft", target: "tx-waterfall", animated: true, style: { stroke: "#a855f7" } },
    ],
  },
  {
    id: "tx-suite",
    label: "Tx Suite (Two Devices or One Duplex Device)",
    description: "Pair receive and transmit sources for controlled Tx analysis",
    icon: <Radio size={16} />,
    nodes: [
      {
        id: "source",
        type: "custom",
        position: { x: 425, y: 40 },
        data: { label: "Source", sourceNode: true, txSuite: true, txSuiteSource: true, sourceBindingGroup: "tx-suite" },
      },
      {
        id: "rx-channel",
        type: "custom",
        position: { x: 650, y: 360 },
        data: { label: "Rx Channels", txSuite: true, channelNode: true, sourceRole: "rx", sourceBindingGroup: "tx-suite" },
      },
      {
        id: "rx-signal-config",
        type: "custom",
        position: { x: 1250, y: 360 },
        data: { label: "Rx Signal Configuration", txSuite: true, signalOptions: true, sourceRole: "rx", sourceBindingGroup: "tx-suite" },
      },
      {
        id: "tx-settings",
        type: "custom",
        position: { x: 40, y: 360 },
        data: { label: "Tx Settings", txSuite: true, txOptions: true, sourceRole: "tx", sourceBindingGroup: "tx-suite" },
      },
      {
        id: "tx-signal-config",
        type: "custom",
        position: { x: 40, y: 850 },
        data: { label: "Tx Signal Configuration", txSuite: true, txSignalOptions: true, sourceRole: "tx", sourceBindingGroup: "tx-suite" },
      },
      {
        id: "rx-fft",
        type: "custom",
        position: { x: 650, y: 1350 },
        data: { label: "Rx FFT", txSuite: true, fftOptions: true, sourceRole: "rx", sourceBindingGroup: "tx-suite" },
      },
      {
        id: "rx-waterfall",
        type: "custom",
        position: { x: 650, y: 1900 },
        data: { label: "Rx Waterfall", txSuite: true, waterfallOptions: true, showMiniVfo: true, miniVfoPosition: "top", sourceRole: "rx", sourceBindingGroup: "tx-suite" },
      },
      {
        id: "tx-fft",
        type: "custom",
        position: { x: 40, y: 1350 },
        data: { label: "Tx FFT", txSuite: true, fftOptions: true, sourceRole: "tx", sourceBindingGroup: "tx-suite" },
      },
      {
        id: "tx-waterfall",
        type: "custom",
        position: { x: 40, y: 1900 },
        data: { label: "Tx Waterfall", txSuite: true, waterfallOptions: true, showMiniVfo: true, miniVfoPosition: "top", sourceRole: "tx", sourceBindingGroup: "tx-suite" },
      },
    ],
    edges: [
      { id: "tx-suite-source-rx-channel", source: "source", target: "rx-channel", animated: true, style: { stroke: "#00d4ff" } },
      { id: "tx-suite-source-tx-settings", source: "source", target: "tx-settings", animated: true, style: { stroke: "#a855f7" } },
      { id: "tx-suite-rx-channel-config", source: "rx-channel", target: "rx-signal-config", animated: true, style: { stroke: "#00d4ff" } },
      { id: "tx-suite-rx-config-fft", source: "rx-signal-config", target: "rx-fft", animated: true, style: { stroke: "#00d4ff" } },
      { id: "tx-suite-rx-config-waterfall", source: "rx-signal-config", target: "rx-waterfall", animated: true, style: { stroke: "#00d4ff" } },
      { id: "tx-suite-tx-signal-config", source: "tx-settings", target: "tx-signal-config", animated: true, style: { stroke: "#a855f7" } },
      { id: "tx-suite-tx-fft", source: "tx-signal-config", target: "tx-fft", animated: true, style: { stroke: "#a855f7" } },
      { id: "tx-suite-tx-waterfall", source: "tx-signal-config", target: "tx-waterfall", animated: true, style: { stroke: "#a855f7" } },
    ],
  },
  {
    id: "default",
    label: "Reference Capture (Default)",
    description: "Capture a reference signal for demodulation",
    icon: <Zap size={16} />,
    nodes: [
      {
        id: "source",
        type: "custom",
        position: { ...REFERENCE_CAPTURE_NODE_POSITIONS.source },
        data: {
          label: "Source",
          description: "Signal source",
          sourceNode: true,
        },
      },
      {
        id: "channel",
        type: "custom",
        position: { ...REFERENCE_CAPTURE_NODE_POSITIONS.channel },
        data: {
          label: "Channel",
          description: "Channel configuration",
          channelNode: true,
        },
      },
      {
        id: "signal-config",
        type: "custom",
        position: { ...REFERENCE_CAPTURE_NODE_POSITIONS["signal-config"] },
        data: {
          label: "Signal Configuration",
          description: "Configure sampling and FFT",
          signalOptions: true,
        },
      },
      {
        id: "demod-readiness",
        type: "custom",
        position: { ...REFERENCE_CAPTURE_NODE_POSITIONS["demod-readiness"] },
        data: {
          label: "Demodulation Readiness",
          demodReadinessOptions: true,
        },
      },
      {
        id: "stimulus",
        type: "custom",
        position: { ...REFERENCE_CAPTURE_NODE_POSITIONS.stimulus },
        data: {
          label: "Stimulus",
          description: "Select a known reference stimulus",
          stimulusOptions: true,
        },
      },
      {
        id: "output",
        type: "custom",
        position: { ...REFERENCE_CAPTURE_NODE_POSITIONS.output },
        data: {
          label: "Output",
          description: "Use the generated I/Q capture for demodulation",
          outputNode: true,
        },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "source",
        target: "channel",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e2",
        source: "source",
        target: "signal-config",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e3",
        source: "channel",
        target: "demod-readiness",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e4",
        source: "signal-config",
        target: "demod-readiness",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e-readiness-stimulus",
        source: "demod-readiness",
        target: "stimulus",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e5",
        source: "stimulus",
        target: "output",
        animated: true,
        style: { stroke: "#666" },
      },
    ],
  },
  {
    id: "apt-audio",
    label: "Try N-APT Audio",
    description: "Valley FM discriminator probe with Span, FFT, and Waterfall Analysis",
    icon: <Music size={16} />,
    nodes: [
      {
        id: "source",
        type: "custom",
        position: { x: 250, y: 50 },
        data: {
          label: "Source",
          description: "Signal source",
          sourceNode: true,
        },
      },
      {
        id: "span",
        type: "custom",
        position: { x: 250, y: 450 },
        data: {
          label: "Span",
          description: "Hardware tuning range",
          spanOptions: true,
        },
      },
      {
        id: "fft",
        type: "custom",
        position: { x: 50, y: 850 },
        data: {
          label: "FFT",
          description: "Fast Fourier Transform",
          fftOptions: true,
          showDemodOverlay: true,
        },
      },
      {
        id: "waterfall-analysis",
        type: "custom",
        position: { x: 450, y: 850 },
        data: {
          label: "Waterfall Analysis",
          description: "Tune and inspect a waterfall signal window",
          waterfallOptions: true,
          analysisOptions: true,
        },
      },
      {
        id: "radio",
        type: "custom",
        position: { x: 250, y: 1450 },
        data: {
          label: "Radio",
          description: "Radio demodulation",
          radioOptions: true,
        },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "source",
        target: "span",
        animated: true,
        style: { stroke: "#00d4ffaa", strokeWidth: 2 },
      },
      {
        id: "e2",
        source: "span",
        target: "fft",
        animated: true,
        style: { stroke: "#00d4ffaa", strokeWidth: 2 },
      },
      {
        id: "e3",
        source: "span",
        target: "waterfall-analysis",
        animated: true,
        style: { stroke: "#00d4ffaa", strokeWidth: 2 },
      },
      {
        id: "e4",
        source: "fft",
        target: "radio",
        animated: true,
        style: { stroke: "#00d4ffaa", strokeWidth: 2 },
      },
      {
        id: "e5",
        source: "waterfall-analysis",
        target: "radio",
        animated: true,
        style: { stroke: "#00d4ffaa", strokeWidth: 2 },
      },
    ],
  },
  {
    id: "fm-radio",
    label: "Listen to FM radio",
    description: "Fast demod radio (WFM/NFM) with Span tuning",
    icon: <Waves size={16} />,
    nodes: [
      {
        id: "source",
        type: "custom",
        position: { x: 250, y: 50 },
        data: {
          label: "Source",
          description: "Signal source",
          sourceNode: true,
        },
      },
      {
        id: "fm",
        type: "custom",
        position: { x: 250, y: 450 },
        data: {
          label: "FM",
          description: "FM station selection",
          fmOptions: true,
        },
      },
      {
        id: "radio",
        type: "custom",
        position: { x: 250, y: 850 },
        data: {
          label: "Radio",
          description: "Radio demodulation",
          radioOptions: true,
        },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "source",
        target: "fm",
        animated: true,
        style: { stroke: "#00d4ffaa", strokeWidth: 2 },
      },
      {
        id: "e2",
        source: "fm",
        target: "radio",
        animated: true,
        style: { stroke: "#00d4ffaa", strokeWidth: 2 },
      },
    ],
  },
  {
    id: "visualize",
    label: "Visualize",
    description: "Signal visualization with FFT and waterfall",
    icon: <Waves size={16} />,
    nodes: [
      {
        id: "source",
        type: "custom",
        position: { x: 250, y: 50 },
        data: {
          label: "Source",
          description: "Signal source",
          sourceNode: true,
        },
      },
      {
        id: "channel",
        type: "custom",
        position: { x: 250, y: 450 },
        data: {
          label: "Channel",
          description: "Channel configuration",
          channelNode: true,
        },
      },
      {
        id: "signal-config",
        type: "custom",
        position: { x: 250, y: 850 },
        data: {
          label: "Signal Configuration",
          description: "Configure sampling and FFT",
          signalOptions: true,
        },
      },
      {
        id: "fft",
        type: "custom",
        position: { x: 50, y: 1250 },
        data: {
          label: "FFT",
          description: "Fast Fourier Transform",
          fftOptions: true,
        },
      },
      {
        id: "waterfall",
        type: "custom",
        position: { x: 450, y: 1250 },
        data: {
          label: "Waterfall",
          description: "Waterfall visualization",
          waterfallOptions: true,
          showMiniVfo: true,
          miniVfoPosition: "top",
        },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "source",
        target: "channel",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e2",
        source: "channel",
        target: "signal-config",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e3",
        source: "signal-config",
        target: "fft",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e4",
        source: "signal-config",
        target: "waterfall",
        animated: true,
        style: { stroke: "#666" },
      },
    ],
  },
  {
    id: "find-spikes",
    label: "Find Spikes",
    description: "Detect signal spikes in frequency domain",
    icon: <Activity size={16} />,
    nodes: [
      {
        id: "source",
        type: "custom",
        position: { x: 250, y: 50 },
        data: {
          label: "Source",
          description: "Signal source",
          sourceNode: true,
        },
      },
      {
        id: "channel",
        type: "custom",
        position: { x: 250, y: 450 },
        data: {
          label: "Channel",
          description: "Channel configuration",
          channelNode: true,
        },
      },
      {
        id: "fft",
        type: "custom",
        position: { x: 250, y: 850 },
        data: {
          label: "FFT",
          description: "Fast Fourier Transform",
          fftOptions: true,
        },
      },
      {
        id: "spike",
        type: "custom",
        position: { x: 250, y: 1250 },
        data: {
          label: "Spike Detection",
          description: "Scan the FFT for prominent spikes",
          spikeOptions: true,
        },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "source",
        target: "channel",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e2",
        source: "channel",
        target: "fft",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e3",
        source: "fft",
        target: "spike",
        animated: true,
        style: { stroke: "#666" },
      },
    ],
  },
  FindBeatsFlow,
];

export const flowTemplates: FlowTemplate[] = [
  // Reference Capture is the canonical first/default experience.
  flowTemplatesDefinition.find(({ id }) => id === "default")!,
  flowTemplatesDefinition.find(({ id }) => id === "tx-suite")!,
  flowTemplatesDefinition.find(({ id }) => id === "reverse-engineering")!,
  flowTemplatesDefinition.find(({ id }) => id === "apt-audio")!,
  ...flowTemplatesDefinition.filter(
    ({ id }) => id !== "default" && id !== "apt-audio" && id !== "tx-suite" && id !== "reverse-engineering",
  ),
];
