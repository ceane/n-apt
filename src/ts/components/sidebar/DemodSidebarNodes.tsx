import React from "react";
import styled from "styled-components";
import { Collapsible } from "@n-apt/components/ui";
import { ToyBrick, Plus, Radio, Settings, Wifi, Volume2, Play, Image, RadioIcon, Brain, Activity, Zap, Cpu, Waves, BarChart3, Music, Camera, Binary, Signal, FileBox } from "lucide-react";

const NodePaletteContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
`;

const NodeSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  grid-column: 1 / -1;
`;

const NodeItem = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background-color: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 10px;
  cursor: grab;
  transition: all 0.2s ease;
  font-family: "JetBrains Mono", monospace;
  min-width: 0;

  &:hover {
    background-color: ${(props) => props.theme.surfaceHover};
    border-color: ${(props) => props.theme.primary};
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  &:active {
    cursor: grabbing;
    transform: translateY(0);
  }
`;

const NodeIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background-color: ${(props) => props.theme.primary}1a;
  border-radius: 8px;
  color: ${(props) => props.theme.primary};
  flex-shrink: 0;
`;

const NodeInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const NodeTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => props.theme.textPrimary};
  line-height: 1.2;
`;

const NodeDescription = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.2;
`;

interface NodeType {
  id: string;
  type: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  position: { x: number; y: number };
  data: any;
}

const availableNodes: NodeType[] = [
  {
    id: 'source',
    type: 'custom',
    label: 'Source',
    description: 'Auto-populated from sidebar',
    icon: <Radio size={16} />,
    position: { x: 250, y: 50 },
    data: { label: 'Source', description: 'Auto-populated from sidebar', sourceNode: true, nonRemovable: true }
  },
  {
    id: 'signal-config',
    type: 'custom',
    label: 'Signal Configuration',
    description: 'Configure sampling, FFT resolution, and hardware gain.',
    icon: <Settings size={16} />,
    position: { x: 250, y: 150 },
    data: {
      label: 'Signal Configuration',
      description: 'Hardware sampling and FFT settings',
      signalOptions: true
    }
  },
  {
    id: 'metadata',
    type: 'custom',
    label: 'Metadata',
    description: 'Recorded file metadata, frequency span, and capture properties.',
    icon: <FileBox size={16} />,
    position: { x: 250, y: 250 },
    data: {
      label: 'Metadata',
      description: 'Recorded file metadata, frequency span, and capture properties.',
      metadataNode: true
    }
  },
  {
    id: 'coreml',
    type: 'custom',
    label: 'CoreML',
    description: 'Machine learning inference',
    icon: <Cpu size={16} />,
    position: { x: 100, y: 150 },
    data: { label: 'CoreML', description: 'Machine learning inference', coremlOptions: true }
  },
  {
    id: 'spike-detection',
    type: 'custom',
    label: 'Spike Detection',
    description: 'Detect signal spikes',
    icon: <Zap size={16} />,
    position: { x: 400, y: 150 },
    data: { label: 'Spike Detection', description: 'Detect signal spikes', spikeOptions: true }
  },
  {
    id: 'beat-detection',
    type: 'custom',
    label: 'Beat Detection',
    description: 'Beat frequencies/heterodyning',
    icon: <BarChart3 size={16} />,
    position: { x: 100, y: 250 },
    data: { label: 'Beat Detection', description: 'Beat frequencies/heterodyning', beatOptions: true }
  },
  {
    id: 'fft',
    type: 'custom',
    label: 'FFT',
    description: 'Fast Fourier Transform',
    icon: <Activity size={16} />,
    position: { x: 400, y: 250 },
    data: { label: 'FFT', description: 'Fast Fourier Transform', fftOptions: true }
  },
  {
    id: 'waterfall',
    type: 'custom',
    label: 'Waterfall',
    description: 'Frequency spectrum waterfall',
    icon: <Waves size={16} />,
    position: { x: 100, y: 350 },
    data: { label: 'Waterfall', description: 'Frequency spectrum waterfall', waterfallOptions: true }
  },
  {
    id: 'spectogram-128',
    type: 'custom',
    label: 'Spectogram 128',
    description: '128x128 images for ML (128kHz x 128 frames)',
    icon: <Image size={16} />,
    position: { x: 250, y: 350 },
    data: { label: 'Spectogram 128', description: '128x128 images for ML (128kHz x 128 frames)', spectogramOptions: true }
  },
  {
    id: 'output',
    type: 'custom',
    label: 'Output',
    description: 'Processed signal results',
    icon: <Plus size={16} />,
    position: { x: 400, y: 350 },
    data: { label: 'Output', description: 'Processed signal results' }
  },
  {
    id: 'channel',
    type: 'custom',
    label: 'Channel',
    description: 'Select signals.yaml channels',
    icon: <Wifi size={16} />,
    position: { x: 150, y: 450 },
    data: { label: 'Channel', description: 'Select signals.yaml channels', channelOptions: true }
  },
  {
    id: 'span',
    type: 'custom',
    label: 'Span',
    description: 'Arbitrary frequency range',
    icon: <Settings size={16} />,
    position: { x: 350, y: 450 },
    data: { label: 'Span', description: 'Arbitrary frequency range', spanOptions: true }
  },
  {
    id: 'stimulus',
    type: 'custom',
    label: 'Stimulus (N-APT)',
    description: 'Record I/Q captures of N-APT channels using a baseline media content to detect where is what.',
    icon: <Volume2 size={16} />,
    position: { x: 150, y: 550 },
    data: { label: 'Stimulus', description: 'Record I/Q captures of N-APT channels using a baseline media content to detect where is what.', stimulusOptions: true }
  },
  {
    id: 'tempo-note-stimulus',
    type: 'custom',
    label: 'Tempo/Note Stimulus (N-APT)',
    description: 'Record I/Q captures of N-APT channels using rich sound to detect where is what.',
    icon: <Music size={16} />,
    position: { x: 350, y: 550 },
    data: { label: 'Tempo/Note Stimulus', description: 'Record I/Q captures of N-APT channels using rich sound to detect where is what.', tempoNoteOptions: true }
  },
  {
    id: 'radio',
    type: 'custom',
    label: 'Radio',
    description: 'Scan for/playback content representing audio content/input capture',
    icon: <RadioIcon size={16} />,
    position: { x: 150, y: 650 },
    data: { label: 'Radio', description: 'Scan for/playback content representing audio content/input capture', radioOptions: true }
  },
  {
    id: 'camera',
    type: 'custom',
    label: 'Camera',
    description: 'Scan for/playback content representing visual content/input capture',
    icon: <Camera size={16} />,
    position: { x: 350, y: 650 },
    data: { label: 'Camera', description: 'Scan for/playback content representing visual content/input capture', cameraOptions: true }
  },
  {
    id: 'stream',
    type: 'custom',
    label: 'Stream',
    description: 'Real-time data streaming',
    icon: <Play size={16} />,
    position: { x: 150, y: 750 },
    data: { label: 'Stream', description: 'Real-time data streaming', streamOptions: true }
  },
  {
    id: 'apt',
    type: 'custom',
    label: 'APT',
    description: 'Automatic Picture Transmission',
    icon: <Image size={16} />,
    position: { x: 350, y: 750 },
    data: { label: 'APT', description: 'Automatic Picture Transmission', aptOptions: true }
  },
  {
    id: 'fm',
    type: 'custom',
    label: 'FM',
    description: 'Frequency modulation demodulation',
    icon: <RadioIcon size={16} />,
    position: { x: 150, y: 850 },
    data: { label: 'FM', description: 'Frequency modulation demodulation', fmOptions: true }
  },
  {
    id: 'symbols',
    type: 'custom',
    label: 'Symbols (I/Q)',
    description: 'Converts baseband waveform into discrete modulation symbols. Each symbol represents one or more bits.',
    icon: <Signal size={16} />,
    position: { x: 350, y: 850 },
    data: { label: 'Symbols (I/Q)', description: 'Converts baseband waveform into discrete modulation symbols. Each symbol represents one or more bits.', symbolsOptions: true }
  },
  {
    id: 'bitstream',
    type: 'custom',
    label: 'Bitstream (0s/1s)',
    description: 'Maps symbols into raw bits after demodulation. Continuous 0s and 1s, no framing applied yet.',
    icon: <Binary size={16} />,
    position: { x: 150, y: 950 },
    data: { label: 'Bitstream (0s/1s)', description: 'Maps symbols into raw bits after demodulation. Continuous 0s and 1s, no framing applied yet.', bitstreamOptions: true }
  },
  {
    id: 'baseband',
    type: 'custom',
    label: 'Baseband (I/Q waveform)',
    description: 'The signal after removing the RF carrier, represented by in-phase (I) and quadrature (Q) samples. These are raw values (0–255 u8) from the ADC.',
    icon: <Waves size={16} />,
    position: { x: 350, y: 950 },
    data: { label: 'Baseband (I/Q waveform)', description: 'The signal after removing the RF carrier, represented by in-phase (I) and quadrature (Q) samples. These are raw values (0–255 u8) from the ADC.', basebandOptions: true }
  },
  {
    id: 'baseline-analysis',
    type: 'custom',
    label: 'Baseline Analysis',
    description: 'Neural baseline vector analysis',
    icon: <Brain size={16} />,
    position: { x: 250, y: 1050 },
    data: { label: 'Baseline Analysis', description: 'Neural baseline vector analysis', analysisOptions: true }
  }
];

export const DemodSidebarNodes: React.FC = () => {
  const handleDragStart = (event: React.DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(nodeType));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <NodeSection>
      <Collapsible
        title="Node Library (Advanced)"
        defaultOpen={true}
        icon={<ToyBrick size={14} />}
      >
        <NodePaletteContainer>
          {availableNodes.map((node) => (
            <NodeItem
              key={node.id}
              draggable
              onDragStart={(e) => handleDragStart(e, node)}
            >
              <NodeIcon>{node.icon}</NodeIcon>
              <NodeInfo>
                <NodeTitle>{node.label}</NodeTitle>
                <NodeDescription>{node.description}</NodeDescription>
              </NodeInfo>
            </NodeItem>
          ))}
        </NodePaletteContainer>
      </Collapsible>
    </NodeSection>
  );
};
