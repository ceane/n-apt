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
  gap: 8px;
  box-sizing: border-box;
`;

interface SourceSidebarProps {
  sourceMode?: SourceMode;
  onSourceModeChange?: (mode: SourceMode) => void;
  backend?: string | null;
  deviceName?: string | null;
  devices?: React.ComponentProps<typeof SourceInput>["devices"];
  selectedDeviceId?: string;
  onSelectedDeviceChange?: (id: string) => void;
  selectionMode?: "single" | "multi";
  maxSelectedDevices?: number;
  selectedDeviceIds?: string[];
  onSelectedDevicesChange?: (ids: string[]) => void;
  spaceBoundDeviceId?: string | null;
  onToggleDeviceRxPause?: (id: string) => void;
  onToggleDeviceTxMode?: (id: string) => void;
  deviceTxActionsEnabled?: boolean;
  compactActiveOnly?: boolean;
  selectedFilesCount?: number;
  onFileAction?: () => void;
  onFilesSelected?: (files: File[]) => void;
  fileActionLabel?: string;
  fileActionTitle?: string;
}

export const SourceSidebar: React.FC<SourceSidebarProps> = ({
  sourceMode = "live",
  onSourceModeChange,
  backend,
  deviceName,
  devices,
  selectedDeviceId,
  onSelectedDeviceChange,
  selectionMode = "single",
  maxSelectedDevices = 2,
  selectedDeviceIds,
  onSelectedDevicesChange,
  spaceBoundDeviceId,
  onToggleDeviceRxPause,
  onToggleDeviceTxMode,
  deviceTxActionsEnabled = true,
  compactActiveOnly,
  selectedFilesCount,
  onFileAction,
  onFilesSelected,
  fileActionLabel,
  fileActionTitle,
}) => {
  return (
    <Section>
      <SidebarSectionTitle icon={<Unplug size={14} />} title="Source" />
      <SourceInput
        sourceMode={sourceMode}
        backend={backend || null}
        deviceName={deviceName || null}
        onSourceModeChange={onSourceModeChange || (() => {})}
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectedDeviceChange={onSelectedDeviceChange}
        selectionMode={selectionMode}
        maxSelectedDevices={maxSelectedDevices}
        selectedDeviceIds={selectedDeviceIds}
        onSelectedDevicesChange={onSelectedDevicesChange}
        spaceBoundDeviceId={spaceBoundDeviceId}
        onToggleDeviceRxPause={onToggleDeviceRxPause}
        onToggleDeviceTxMode={onToggleDeviceTxMode}
        deviceTxActionsEnabled={deviceTxActionsEnabled}
        compactActiveOnly={compactActiveOnly}
        selectedFilesCount={selectedFilesCount}
        onFileAction={onFileAction}
        onFilesSelected={onFilesSelected}
        fileActionLabel={fileActionLabel}
        fileActionTitle={fileActionTitle}
      />
    </Section>
  );
};

export default SourceSidebar;
