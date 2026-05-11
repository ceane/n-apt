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

import {
  flowTemplates,
  type FlowTemplate,
} from "@n-apt/components/react-flow/flows";

interface DemodulationFlowsProps {
  className?: string;
  onFlowSelect?: (flow: FlowTemplate) => void;
}

export const DemodulationFlows: React.FC<DemodulationFlowsProps> = ({
  className,
  onFlowSelect,
}) => {
  const handleFlowClick = (flow: FlowTemplate) => {
    if (onFlowSelect) {
      onFlowSelect(flow);
    }
  };

  return (
    <FlowPaletteContainer className={className}>
      <Collapsible
        title="Demodulation Flows"
        icon={<Workflow size={16} />}
        defaultOpen
      >
        <FlowSection>
          {flowTemplates.map((flow) => (
            <FlowItem key={flow.id} onClick={() => handleFlowClick(flow)}>
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
