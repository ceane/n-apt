import React, { useCallback, useEffect, useRef } from "react";
import styled from "styled-components";
import {
  useAppSelector,
  useAppDispatch,
  setStitchPaused,
  triggerStitch,
} from "@n-apt/redux";
import { sendRestartDevice } from "@n-apt/redux/thunks/websocketThunks";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { SourceSidebar } from "@n-apt/components/sidebar/SourceSidebar";
import FileSelectionSidebar from "@n-apt/components/sidebar/FileSelectionSidebar";
import { ConnectionStatusSection } from "@n-apt/components/sidebar/ConnectionStatusSection";
import { ScanningProgress } from "@n-apt/components/sidebar/ScanningProgress";
import { DemodulationMathSidebar } from "@n-apt/components/sidebar/DemodulationMathSidebar";
import { DemodSidebarNodes } from "@n-apt/components/sidebar/DemodSidebarNodes";
import { DemodulationFlows } from "@n-apt/components/sidebar/DemodulationFlows";
import type { SourceMode } from "@n-apt/hooks/useSpectrumStore";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";

const SidebarContent = styled.div`
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  align-content: start;
  gap: 16px;
  padding: 0 24px 24px 24px;
  box-sizing: border-box;
  max-width: 100%;
`;

const InfoBox = styled.div`
  background: ${(props) => props.theme.primaryAnchor};
  border: 1px solid ${(props) => props.theme.primaryAlpha};
  border-radius: 8px;
  padding: 16px;
  margin-top: 24px;
  grid-column: 1 / -1;
`;

const InfoTitle = styled.div`
  color: ${(props) => props.theme.primary};
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  font-family: ${(props) => props.theme.typography.mono};
`;

const InfoText = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 11px;
  line-height: 1.5;
`;

interface DemodulateSidebarProps {
  sourceMode?: SourceMode;
  onSourceModeChange?: (mode: SourceMode) => void;
  windowSizeHz?: number;
  stepSizeHz?: number;
  audioThreshold?: number;
  onWindowSizeChange?: (size: number) => void;
  onStepSizeChange?: (size: number) => void;
  onAudioThresholdChange?: (threshold: number) => void;
  // Scanner props
  isScanning?: boolean;
  scanProgress?: number;
  scanCurrentFreq?: number;
  scanRange?: { min: number; max: number };
  detectedRegions?: number;
  onScanStart?: () => void;
  onScanStop?: () => void;
}

import { useDemod } from "@n-apt/contexts/DemodContext";

export const DemodulateSidebar: React.FC<DemodulateSidebarProps> = ({
  isScanning = false,
  scanProgress = 0,
  scanCurrentFreq,
  scanRange,
  detectedRegions = 0,
}) => {
  const dispatch = useAppDispatch();
  const { setFlow } = useDemod();
  const { toggleVisualizerPause, manualVisualizerPaused, wsConnection, state: liveState, dispatch: storeDispatch } = useSpectrumStore();

  const handleFlowSelect = useCallback((flow: any) => {
    setFlow(flow.id, flow.nodes, flow.edges);
  }, [setFlow]);

  const { sourceMode, selectedFiles } = liveState;
  const stitchStatus = useAppSelector((state) => state.waterfall.stitchStatus);
  const isStitchPaused = useAppSelector((state) => state.waterfall.isStitchPaused);

  // Get real device data from Redux store
  const isConnected = useAppSelector((s) => s.websocket.isConnected);
  const deviceState = useAppSelector((s) => s.websocket.deviceState);
  const deviceLoadingReason = useAppSelector((s) => s.websocket.deviceLoadingReason);
  const isPaused = useAppSelector((s) => s.websocket.isPaused);
  const deviceName = useAppSelector((s) => s.websocket.deviceName);
  const backend = useAppSelector((s) => s.websocket.backend);
  const cryptoCorrupted = useAppSelector((s) => s.websocket.cryptoCorrupted);

  const liveIsPaused = manualVisualizerPaused ?? wsConnection.isPaused ?? isPaused;
  const wasLivePausedBeforeFileModeRef = useRef<boolean>(liveIsPaused);
  const previousSourceModeRef = useRef<SourceMode>(
    sourceMode === "file" ? "live" : sourceMode,
  );

  const togglePause = useCallback(() => {
    toggleVisualizerPause();
  }, [toggleVisualizerPause]);

  const handleSourceModeChange = (mode: SourceMode) => {
    storeDispatch({ type: "SET_SOURCE_MODE", mode });
  };

  useEffect(() => {
    const previousSourceMode = previousSourceModeRef.current;
    previousSourceModeRef.current = sourceMode;

    if (previousSourceMode === sourceMode) return;

    if (sourceMode === "file") {
      wasLivePausedBeforeFileModeRef.current = liveIsPaused;
      dispatch(setStitchPaused(true));
      storeDispatch({ type: "SET_STITCH_PAUSED", paused: true });
      liveDataRef.current = null;
      if (!manualVisualizerPaused) {
        toggleVisualizerPause();
      }
      return;
    }

    liveDataRef.current = null;
    if (wasLivePausedBeforeFileModeRef.current !== manualVisualizerPaused) {
      toggleVisualizerPause();
    }
  }, [dispatch, liveIsPaused, manualVisualizerPaused, sourceMode, storeDispatch, toggleVisualizerPause]);

  return (
    <SidebarContent>
      <SourceSidebar
        sourceMode={sourceMode}
        onSourceModeChange={handleSourceModeChange}
        backend={backend}
        deviceName={deviceName}
      />

      {sourceMode === "file" && (
        <FileSelectionSidebar
          selectedFiles={selectedFiles}
          onSelectedFilesChange={(files: any) => {
            storeDispatch({ type: "SET_SELECTED_FILES", files });
          }}
          stitchStatus={stitchStatus}
          isStitchPaused={isStitchPaused}
          onStitch={() => {
            dispatch(triggerStitch());
            storeDispatch({ type: "TRIGGER_STITCH" });
          }}
          onClear={() => storeDispatch({ type: "SET_SELECTED_FILES", files: [] })}
          onStitchPauseToggle={() => {
            const nextPaused = !isStitchPaused;
            dispatch(setStitchPaused(nextPaused));
            storeDispatch({ type: "SET_STITCH_PAUSED", paused: nextPaused });
          }}
          selectedPrimaryFile={null}
          naptMetadata={null}
          naptMetadataError={null}
          showMetadata={false}
        />
      )}

      {sourceMode === "live" && (
        <ConnectionStatusSection
          isConnected={isConnected}
          deviceState={deviceState}
          deviceLoadingReason={deviceLoadingReason}
          isPaused={liveIsPaused}
          cryptoCorrupted={cryptoCorrupted}
          onPauseToggle={togglePause}
          onRestartDevice={() => dispatch(sendRestartDevice())}
        />
      )}

      <ScanningProgress
        isScanning={isScanning}
        scanProgress={scanProgress}
        currentFrequency={scanCurrentFreq}
        scanRange={scanRange}
        detectedRegions={detectedRegions}
      />

      <DemodulationFlows onFlowSelect={handleFlowSelect} />

      <DemodSidebarNodes />

      <InfoBox>
        <InfoTitle>Demodulation</InfoTitle>
        <InfoText>
          N-APT uses APT-style modulation (shape, encoding): the RF signal is FM-demodulated to recover an AM-modulated subcarrier, and envelope detection is then used to recover the transmitted content.
        </InfoText>
      </InfoBox>

      <DemodulationMathSidebar />
    </SidebarContent>
  );
};

export default DemodulateSidebar;
