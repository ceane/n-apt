import React from "react";
import styled from "styled-components";
import { Unplug } from "lucide-react";
import { SidebarSectionTitle } from "@n-apt/components/ui/Collapsible";
import SourceInput from "@n-apt/components/sidebar/SourceInput";
import type { SourceMode } from "@n-apt/hooks/useSpectrumStore";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: 0;
  box-sizing: border-box;
`;


interface SourceSidebarProps {
  sourceMode?: SourceMode;
  onSourceModeChange?: (mode: SourceMode) => void;
  backend?: string | null;
  deviceName?: string | null;
}

export const SourceSidebar: React.FC<SourceSidebarProps> = ({
  sourceMode = "live",
  onSourceModeChange,
  backend,
  deviceName,
}) => {
  return (
    <Section>
      <SidebarSectionTitle icon={<Unplug size={14} />} title="Source" />
      <SourceInput
        sourceMode={sourceMode}
        backend={backend || null}
        deviceName={deviceName || null}
        onSourceModeChange={onSourceModeChange || (() => { })}
      />
    </Section>
  );
};

export default SourceSidebar;
