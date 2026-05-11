import React from "react";
import { Zap, Activity, BarChart3, Waves, Music } from "lucide-react";
import type { Node, Edge } from "@xyflow/react";

export interface FlowTemplate {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  nodes: Node[];
  edges: Edge[];
}

export const flowTemplates: FlowTemplate[] = [
  {
    id: "default",
    label: "Default Flow",
    description: "Complete demodulation pipeline with symbol analysis",
    icon: <Zap size={16} />,
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
        id: "spike",
        type: "custom",
        position: { x: 50, y: 1250 },
        data: {
          label: "Spike Detection",
          description: "Detect spike prominences before FFT",
          spikeOptions: true,
        },
      },
      {
        id: "beat",
        type: "custom",
        position: { x: 450, y: 1250 },
        data: {
          label: "Beat Detection",
          description: "Tune beat offsets before FFT",
          beatOptions: true,
        },
      },
      {
        id: "fft",
        type: "custom",
        position: { x: 250, y: 1650 },
        data: {
          label: "FFT",
          description: "Fast Fourier Transform",
          fftOptions: true,
        },
      },
      {
        id: "symbols",
        type: "custom",
        position: { x: 250, y: 2050 },
        data: {
          label: "Symbols (I/Q)",
          description: "I/Q symbol analysis",
          symbolOptions: true,
        },
      },
      {
        id: "bitstream",
        type: "custom",
        position: { x: 250, y: 2450 },
        data: {
          label: "Bitstream (0s/1s)",
          description: "Binary data analysis",
          bitstreamOptions: true,
        },
      },
      {
        id: "stimulus",
        type: "custom",
        position: { x: 250, y: 2850 },
        data: {
          label: "Stimulus",
          description: "Stimulus selection",
          stimulusOptions: true,
        },
      },
      {
        id: "output",
        type: "custom",
        position: { x: 250, y: 3250 },
        data: {
          label: "Output",
          description: "Analysis results",
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
        source: "channel",
        target: "signal-config",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e3",
        source: "signal-config",
        target: "spike",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e4",
        source: "signal-config",
        target: "beat",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e5",
        source: "spike",
        target: "fft",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e6",
        source: "beat",
        target: "fft",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e7",
        source: "fft",
        target: "symbols",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e8",
        source: "symbols",
        target: "bitstream",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e9",
        source: "bitstream",
        target: "stimulus",
        animated: true,
        style: { stroke: "#666" },
      },
      {
        id: "e10",
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
    description: "Audio demodulation with APT processing",
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
        position: { x: 250, y: 850 },
        data: {
          label: "FFT",
          description: "Fast Fourier Transform",
          fftOptions: true,
          showDemodOverlay: true,
        },
      },
      {
        id: "radio",
        type: "custom",
        position: { x: 250, y: 1250 },
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
        source: "fft",
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
  {
    id: "find-beats",
    label: "Find Beats",
    description: "Detect beat frequencies and heterodyning",
    icon: <BarChart3 size={16} />,
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
        id: "beat",
        type: "custom",
        position: { x: 250, y: 1250 },
        data: {
          label: "Beat Detection",
          description: "Detect beat frequencies and heterodyning",
          beatOptions: true,
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
        target: "beat",
        animated: true,
        style: { stroke: "#666" },
      },
    ],
  },
];
