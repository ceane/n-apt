import React from "react";
import styled from "styled-components";
import { Collapsible } from "@n-apt/components/ui";
import { Zap, Activity, BarChart3, Waves, Music, Workflow } from "lucide-react";

const FlowPaletteContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  grid-column: 1 / -1;
`;

const FlowSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  grid-column: 1 / -1;
`;

const FlowItem = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background-color: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: "JetBrains Mono", monospace;
  min-width: 0;
  grid-column: 1 / -1;

  &:hover {
    background-color: ${(props) => props.theme.surfaceHover};
    border-color: ${(props) => props.theme.primary};
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  &:active {
    transform: translateY(0);
  }
`;

const FlowIcon = styled.div`
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

const FlowInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const FlowTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => props.theme.textPrimary};
  line-height: 1.2;
`;

const FlowDescription = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.2;
`;

interface FlowTemplate {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    position: { x: number; y: number };
    data: any;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    animated?: boolean;
    style?: any;
  }>;
}

const flowTemplates: FlowTemplate[] = [
  {
    id: 'default',
    label: 'Default Flow',
    description: 'Complete demodulation pipeline with symbol analysis',
    icon: <Zap size={16} />,
    nodes: [
      {
        id: 'source',
        type: 'custom',
        label: 'Source',
        position: { x: 250, y: 50 },
        data: { label: 'Source', description: 'Signal source', sourceNode: true }
      },
      {
        id: 'channel',
        type: 'custom',
        label: 'Channel',
        position: { x: 250, y: 150 },
        data: { label: 'Channel', description: 'Channel configuration', channelNode: true }
      },
      {
        id: 'signal-config',
        type: 'custom',
        label: 'Signal Configuration',
        position: { x: 250, y: 250 },
        data: { label: 'Signal Configuration', description: 'Configure sampling and FFT', signalOptions: true }
      },
      {
        id: 'symbols',
        type: 'custom',
        label: 'Symbols (I/Q)',
        position: { x: 150, y: 350 },
        data: { label: 'Symbols (I/Q)', description: 'I/Q symbol analysis', symbolsOptions: true }
      },
      {
        id: 'bitstream',
        type: 'custom',
        label: 'Bitstream (0s/1s)',
        position: { x: 350, y: 350 },
        data: { label: 'Bitstream (0s/1s)', description: 'Binary data analysis', bitstreamOptions: true }
      },
      {
        id: 'stimulus',
        type: 'custom',
        label: 'Stimulus',
        position: { x: 250, y: 450 },
        data: { label: 'Stimulus', description: 'Stimulus selection', stimulusOptions: true }
      },
      {
        id: 'output',
        type: 'custom',
        label: 'Output',
        position: { x: 250, y: 550 },
        data: { label: 'Output', description: 'Analysis results', outputNode: true }
      }
    ],
    edges: [
      { id: 'e1', source: 'source', target: 'channel', animated: true, style: { stroke: '#666' } },
      { id: 'e2', source: 'channel', target: 'signal-config', animated: true, style: { stroke: '#666' } },
      { id: 'e3', source: 'signal-config', target: 'symbols', animated: true, style: { stroke: '#666' } },
      { id: 'e4', source: 'signal-config', target: 'bitstream', animated: true, style: { stroke: '#666' } },
      { id: 'e5', source: 'symbols', target: 'stimulus', animated: true, style: { stroke: '#666' } },
      { id: 'e6', source: 'bitstream', target: 'stimulus', animated: true, style: { stroke: '#666' } },
      { id: 'e7', source: 'stimulus', target: 'output', animated: true, style: { stroke: '#666' } }
    ]
  },
  {
    id: 'apt-audio',
    label: 'Try N-APT Audio',
    description: 'Audio demodulation with APT processing',
    icon: <Music size={16} />,
    nodes: [
      {
        id: 'source',
        type: 'custom',
        label: 'Source',
        position: { x: 250, y: 50 },
        data: { label: 'Source', description: 'Signal source', sourceNode: true }
      },
      {
        id: 'apt',
        type: 'custom',
        label: 'APT',
        position: { x: 250, y: 150 },
        data: { label: 'APT', description: 'APT processing', aptOptions: true }
      },
      {
        id: 'radio',
        type: 'custom',
        label: 'Radio',
        position: { x: 250, y: 250 },
        data: { label: 'Radio', description: 'Radio demodulation', radioOptions: true }
      }
    ],
    edges: [
      { id: 'e1', source: 'source', target: 'apt', animated: true, style: { stroke: '#666' } },
      { id: 'e2', source: 'apt', target: 'radio', animated: true, style: { stroke: '#666' } }
    ]
  },
  {
    id: 'visualize',
    label: 'Visualize',
    description: 'Signal visualization with FFT and waterfall',
    icon: <Waves size={16} />,
    nodes: [
      {
        id: 'source',
        type: 'custom',
        label: 'Source',
        position: { x: 250, y: 50 },
        data: { label: 'Source', description: 'Signal source', sourceNode: true }
      },
      {
        id: 'channel',
        type: 'custom',
        label: 'Channel',
        position: { x: 250, y: 150 },
        data: { label: 'Channel', description: 'Channel configuration', channelNode: true }
      },
      {
        id: 'signal-config',
        type: 'custom',
        label: 'Signal Configuration',
        position: { x: 250, y: 250 },
        data: { label: 'Signal Configuration', description: 'Configure sampling and FFT', signalOptions: true }
      },
      {
        id: 'fft',
        type: 'custom',
        label: 'FFT',
        position: { x: 150, y: 350 },
        data: { label: 'FFT', description: 'Fast Fourier Transform', fftOptions: true }
      },
      {
        id: 'waterfall',
        type: 'custom',
        label: 'Waterfall',
        position: { x: 350, y: 350 },
        data: { label: 'Waterfall', description: 'Waterfall visualization', waterfallOptions: true }
      }
    ],
    edges: [
      { id: 'e1', source: 'source', target: 'channel', animated: true, style: { stroke: '#666' } },
      { id: 'e2', source: 'channel', target: 'signal-config', animated: true, style: { stroke: '#666' } },
      { id: 'e3', source: 'signal-config', target: 'fft', animated: true, style: { stroke: '#666' } },
      { id: 'e4', source: 'signal-config', target: 'waterfall', animated: true, style: { stroke: '#666' } }
    ]
  },
  {
    id: 'find-spikes',
    label: 'Find Spikes',
    description: 'Detect signal spikes in frequency domain',
    icon: <Activity size={16} />,
    nodes: [
      {
        id: 'source',
        type: 'custom',
        label: 'Source',
        position: { x: 250, y: 50 },
        data: { label: 'Source', description: 'Signal source', sourceNode: true }
      },
      {
        id: 'channel',
        type: 'custom',
        label: 'Channel',
        position: { x: 250, y: 150 },
        data: { label: 'Channel', description: 'Channel configuration', channelNode: true }
      },
      {
        id: 'fft',
        type: 'custom',
        label: 'FFT',
        position: { x: 250, y: 250 },
        data: { label: 'FFT', description: 'Fast Fourier Transform', fftOptions: true }
      }
    ],
    edges: [
      { id: 'e1', source: 'source', target: 'channel', animated: true, style: { stroke: '#666' } },
      { id: 'e2', source: 'channel', target: 'fft', animated: true, style: { stroke: '#666' } }
    ]
  },
  {
    id: 'find-beats',
    label: 'Find Beats',
    description: 'Detect beat frequencies and heterodyning',
    icon: <BarChart3 size={16} />,
    nodes: [
      {
        id: 'source',
        type: 'custom',
        label: 'Source',
        position: { x: 250, y: 50 },
        data: { label: 'Source', description: 'Signal source', sourceNode: true }
      },
      {
        id: 'channel',
        type: 'custom',
        label: 'Channel',
        position: { x: 250, y: 150 },
        data: { label: 'Channel', description: 'Channel configuration', channelNode: true }
      },
      {
        id: 'fft',
        type: 'custom',
        label: 'FFT',
        position: { x: 250, y: 250 },
        data: { label: 'FFT', description: 'Fast Fourier Transform', fftOptions: true }
      }
    ],
    edges: [
      { id: 'e1', source: 'source', target: 'channel', animated: true, style: { stroke: '#666' } },
      { id: 'e2', source: 'channel', target: 'fft', animated: true, style: { stroke: '#666' } }
    ]
  }
];

interface DemodulationFlowsProps {
  className?: string;
  onFlowSelect?: (flow: FlowTemplate) => void;
}

export const DemodulationFlows: React.FC<DemodulationFlowsProps> = ({
  className,
  onFlowSelect
}) => {
  const handleFlowClick = (flow: FlowTemplate) => {
    if (onFlowSelect) {
      onFlowSelect(flow);
    }
  };

  return (
    <FlowPaletteContainer className={className}>
      <Collapsible title="Demodulation Flows" icon={<Workflow size={16} />} defaultOpen>
        <FlowSection>
          {flowTemplates.map((flow) => (
            <FlowItem
              key={flow.id}
              onClick={() => handleFlowClick(flow)}
            >
              <FlowIcon>{flow.icon}</FlowIcon>
              <FlowInfo>
                <FlowTitle>{flow.label}</FlowTitle>
                <FlowDescription>{flow.description}</FlowDescription>
              </FlowInfo>
            </FlowItem>
          ))}
        </FlowSection>
      </Collapsible>
    </FlowPaletteContainer>
  );
};

export default DemodulationFlows;
