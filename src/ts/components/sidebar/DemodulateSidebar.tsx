import React, { useCallback, useEffect, useMemo, useRef } from "react";
import styled from "styled-components";
import {
  useAppSelector,
  useAppDispatch,
  setFileMetadata,
  setSelectedFiles,
  setSourceMode,
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
import { fileRegistry } from "@n-apt/utils/fileRegistry";
import type { NaptMetadata } from "@n-apt/consts/types";
import {
  selectActiveSourceDerivedState,
  selectActiveSource,
} from "@n-apt/redux/selectors/performanceSelectors";

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

import { type FlowTemplate } from "@n-apt/components/react-flow/flows";

export const DemodulateSidebar: React.FC<DemodulateSidebarProps> = ({
  isScanning = false,
  scanProgress = 0,
  scanCurrentFreq,
  scanRange,
  detectedRegions = 0,
}) => {
  const dispatch = useAppDispatch();
  const { setFlow } = useDemod();
  const {
    toggleVisualizerPause,
    manualVisualizerPaused,
    wsConnection,
    state: liveState,
    dispatch: storeDispatch,
  } = useSpectrumStore();

  const handleFlowSelect = useCallback(
    (flow: FlowTemplate) => {
      setFlow(flow.id, flow.nodes as any, flow.edges as any);
    },
    [setFlow],
  );

  const { sourceMode, selectedFiles } = liveState;
  const selectedPrimaryFile = useMemo(() => {
    if (sourceMode !== "file" || selectedFiles.length !== 1) return null;
    const file = selectedFiles[0];
    const lower = file.name.toLowerCase();
    return lower.endsWith(".napt") || lower.endsWith(".wav") ? file : null;
  }, [selectedFiles, sourceMode]);
  const stitchStatus = useAppSelector((state) => state.waterfall.stitchStatus);
  const isStitchPaused = useAppSelector(
    (state) => state.waterfall.isStitchPaused,
  );

  // Get real device data from Redux store
  const isPaused = useAppSelector((s) => s.websocket.isPaused);
  const cryptoCorrupted = useAppSelector((s) => s.websocket.cryptoCorrupted);
  const activeSource = useAppSelector(selectActiveSource);
  const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);

  const liveIsPaused =
    manualVisualizerPaused ?? wsConnection.isPaused ?? isPaused;
  const wasLivePausedBeforeFileModeRef = useRef<boolean>(liveIsPaused);
  const previousSourceModeRef = useRef<SourceMode>(
    sourceMode === "file" ? "live" : sourceMode,
  );

  const handleSourceModeChange = (mode: SourceMode) => {
    dispatch(setSourceMode(mode));
    storeDispatch({ type: "SET_SOURCE_MODE", mode });
  };

  useEffect(() => {
    let cancelled = false;

    const parseMetadata = async () => {
      if (!selectedPrimaryFile) {
        dispatch(setFileMetadata(null));
        return;
      }

      const fileObj = fileRegistry.get(selectedPrimaryFile.id);
      if (!fileObj) {
        dispatch(setFileMetadata(null));
        return;
      }

      const lower = selectedPrimaryFile.name.toLowerCase();
      const isNapt = lower.endsWith(".napt");
      const isWav = lower.endsWith(".wav");

      try {
        const buffer = await fileObj.arrayBuffer();
        let metadata: NaptMetadata | null = null;

        if (isNapt) {
          const maxHeaderRead = Math.min(8192, buffer.byteLength);
          const headerBytes = new Uint8Array(buffer, 0, maxHeaderRead);
          const newlineIdx = headerBytes.indexOf(10);
          let jsonText: string;
          if (newlineIdx > 0) {
            jsonText = new TextDecoder().decode(
              headerBytes.slice(0, newlineIdx),
            );
          } else {
            const headerText = new TextDecoder().decode(headerBytes);
            let depth = 0;
            let inString = false;
            let escape = false;
            let end = -1;
            for (let i = 0; i < headerText.length; i++) {
              const char = headerText[i];
              if (escape) {
                escape = false;
                continue;
              }
              if (char === "\\") {
                escape = true;
                continue;
              }
              if (char === '"') {
                inString = !inString;
                continue;
              }
              if (inString) continue;
              if (char === "{") depth += 1;
              if (char === "}") {
                depth -= 1;
                if (depth === 0) {
                  end = i + 1;
                  break;
                }
              }
            }
            if (end <= 0) throw new Error("Invalid NAPT header");
            jsonText = headerText.slice(0, end);
          }
          const parsed = JSON.parse(jsonText);
          metadata = parsed.metadata || parsed;
        } else if (isWav) {
          const view = new DataView(buffer);
          const readText = (offset: number, length: number) =>
            String.fromCharCode(...new Uint8Array(buffer, offset, length));

          if (readText(0, 4) === "RIFF" && readText(8, 4) === "WAVE") {
            let offset = 12;
            while (offset + 8 <= buffer.byteLength) {
              const chunkId = readText(offset, 4);
              const chunkSize = view.getUint32(offset + 4, true);
              if (chunkId === "nAPT") {
                const metaBytes = new Uint8Array(buffer, offset + 8, chunkSize);
                const nullIdx = metaBytes.indexOf(0);
                const json = new TextDecoder().decode(
                  nullIdx >= 0 ? metaBytes.slice(0, nullIdx) : metaBytes,
                );
                metadata = JSON.parse(json);
                break;
              }
              offset += 8 + chunkSize + (chunkSize % 2);
            }
          }
        }

        if (!cancelled) {
          dispatch(setFileMetadata(metadata));
        }
      } catch {
        if (!cancelled) {
          dispatch(setFileMetadata(null));
        }
      }
    };

    void parseMetadata();
    return () => {
      cancelled = true;
    };
  }, [dispatch, selectedPrimaryFile]);

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
  }, [
    dispatch,
    liveIsPaused,
    manualVisualizerPaused,
    sourceMode,
    storeDispatch,
    toggleVisualizerPause,
  ]);

  return (
    <SidebarContent>
      <SourceSidebar
        sourceMode={sourceMode}
        onSourceModeChange={handleSourceModeChange}
        backend={activeSourceDerived.backend}
        deviceName={activeSourceDerived.deviceName}
      />

      {sourceMode === "file" && (
        <FileSelectionSidebar
          selectedFiles={selectedFiles}
          onSelectedFilesChange={(files: any) => {
            dispatch(setSelectedFiles(files));
            storeDispatch({ type: "SET_SELECTED_FILES", files });
          }}
          stitchStatus={stitchStatus}
          isStitchPaused={isStitchPaused}
          onClear={() => {
            dispatch(setSelectedFiles([]));
            storeDispatch({ type: "SET_SELECTED_FILES", files: [] });
          }}
          selectedPrimaryFile={selectedPrimaryFile}
          naptMetadata={null}
          naptMetadataError={null}
          showMetadata={false}
        />
      )}

      {sourceMode === "live" && (
        <ConnectionStatusSection
          isConnected={isConnected}
            deviceState={activeSourceDerived.deviceState}
            deviceLoadingReason={activeSource?.status === "loading" ? "connect" : null}
            backend={activeSourceDerived.backend}
          isPaused={liveIsPaused}
          cryptoCorrupted={cryptoCorrupted}
          onPauseToggle={toggleVisualizerPause}
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
          N-APT uses APT-style modulation (shape, encoding): the RF signal is
          FM-demodulated to recover an AM-modulated subcarrier, and envelope
          detection is then used to recover the transmitted content.
        </InfoText>
      </InfoBox>

      <DemodulationMathSidebar />
    </SidebarContent>
  );
};

export default DemodulateSidebar;
