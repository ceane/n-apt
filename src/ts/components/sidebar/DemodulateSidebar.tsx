import React, { useCallback, useEffect, useMemo, useRef } from "react";
import styled from "styled-components";
import {
  useAppSelector,
  useAppDispatch,
  clearWaterfall,
  setFileMetadata,
  setSelectedFiles,
  setSourceMode,
  setStitchPaused,
  triggerStitch,
} from "@n-apt/redux";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { SourceSidebar } from "@n-apt/components/sidebar/SourceSidebar";
import {
  setSourceBindings,
  setSourceSelectionMode,
} from "@n-apt/redux/slices/sourceRoutingSlice";
import FileSelectionSidebar from "@n-apt/components/sidebar/FileSelectionSidebar";
import { ScanningProgress } from "@n-apt/components/sidebar/ScanningProgress";
import { DemodulationMathSidebar } from "@n-apt/components/sidebar/DemodulationMathSidebar";
import { DemodSidebarNodes } from "@n-apt/components/sidebar/DemodSidebarNodes";
import { DemodulationFlows } from "@n-apt/components/sidebar/DemodulationFlows";
import type { SourceMode } from "@n-apt/hooks/useSpectrumStore";
import { liveFrameRuntime } from "@n-apt/visualization/frameRuntime";
import { fileRegistry } from "@n-apt/utils/fileRegistry";
import {
  selectSelectedFiles,
  selectSourceMode,
} from "@n-apt/redux/selectors/performanceSelectors";

export const getDemodFileSelectionActions = (
  files: { id: string; name: string }[],
) => [
  { type: "SET_SOURCE_MODE" as const, mode: "file" as const },
  { type: "SET_SELECTED_FILES" as const, files },
  { type: "TRIGGER_STITCH" as const },
];
import type { NaptMetadata } from "@n-apt/consts/types";
import { selectActiveSourceDerivedState } from "@n-apt/redux/selectors/performanceSelectors";

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
  const { setFlow, nodes } = useDemod();
  const {
    toggleVisualizerPause,
    manualVisualizerPaused,
    selectedSourceId,
    setSelectedSourceId,
    sources,
    wsConnection,
  } = useSpectrumStore();
  const tx = useAppSelector((state) => state.spectrum);
  const sourceMode = useAppSelector(selectSourceMode);
  const selectedFiles = useAppSelector(selectSelectedFiles);

  const handleToggleTransmit = useCallback(
    (id: string) => {
      const source = sources.find((entry) => entry.id === id);
      if (!source) return;
      const transmitting = source.status === "transmitting";
      wsConnection.sendTransmitMode?.(!transmitting, source.name ?? id, {
        serialNumber: source.serial_number?.trim() || id,
        centerFrequencyHz: tx.txCenterFrequencyHz,
        bandwidthHz: tx.txSampleRateHz,
        ifftSize: tx.txIfftSize,
        powerDbm: tx.txPowerDbm,
        vgaGainDb: tx.txVgaGain,
        ampEnabled: tx.hackrfAmpEnabled,
        txSafetyEnabled: tx.txSafetyEnabled,
        txSafetyLimit: tx.txSafetyLimit,
        txSignal: tx.txSignal,
        txHopEnabled: tx.txHopEnabled,
        txHopType: tx.txHopType,
        txHopStartFrequencyHz: tx.txHopStartFrequencyHz,
        txHopEndFrequencyHz: tx.txHopEndFrequencyHz,
        txHopChannels: tx.txHopChannels,
        txHopRateHz: tx.txHopRateHz,
      });
    },
    [sources, tx, wsConnection.sendTransmitMode],
  );

  const handleFlowSelect = useCallback(
    (flow: FlowTemplate) => {
      setFlow(flow.id, flow.nodes as any, flow.edges as any);
    },
    [setFlow],
  );

  const isTxSuiteFlow = nodes.some(
    (node) => node.data?.sourceBindingGroup === "tx-suite",
  );
  const routedSourceIds = useAppSelector((state) =>
    [
      state.sourceRouting.bindings["tx-suite:rx"],
      state.sourceRouting.bindings["tx-suite:tx"],
    ].filter((id): id is string => Boolean(id)),
  );

  useEffect(() => {
    dispatch(
      setSourceSelectionMode({
        group: "tx-suite",
        mode: isTxSuiteFlow ? "multi" : "single",
      }),
    );
  }, [dispatch, isTxSuiteFlow]);

  useEffect(() => {
    if (!isTxSuiteFlow || routedSourceIds.length > 0) return;
    const available = sources.map((source) => ({
      id: source.id,
      capability: source.capability?.toLowerCase?.() ?? "",
    }));
    const rx =
      available.find(
        (source) => source.capability === "rx" || source.capability === "tx_rx",
      ) ?? available[0];
    const tx =
      available.find(
        (source) =>
          source.id !== rx?.id &&
          (source.capability === "tx" || source.capability === "tx_rx"),
      ) ?? available[1];
    const fileIds = selectedFiles.map((file) => `file:${file.name}`);
    const fallbackIds =
      available.length > 0
        ? available
        : fileIds.map((id) => ({ id, capability: "rx" }));
    const fallbackRx = rx ?? fallbackIds[0];
    const fallbackTx = tx ?? fallbackIds[1] ?? fallbackIds[0];
    if (!fallbackRx) return;
    dispatch(
      setSourceBindings({
        group: "tx-suite",
        bindings: {
          rx: fallbackRx.id,
          tx: fallbackTx?.id ?? null,
        },
      }),
    );
  }, [dispatch, isTxSuiteFlow, routedSourceIds.length, selectedFiles, sources]);

  const handleMultiSourceChange = useCallback(
    (ids: string[]) => {
      const selected = ids
        .map((id) => sources.find((source) => source.id === id))
        .filter(Boolean)
        .map((source) => ({
          id: source!.id,
          capability: source!.capability?.toLowerCase?.() ?? "",
        }));
      const rx =
        selected.find(
          (source) =>
            source.capability === "rx" || source.capability === "tx_rx",
        ) ?? selected[0];
      const tx =
        selected.find(
          (source) =>
            source.id !== rx?.id &&
            (source.capability === "tx" || source.capability === "tx_rx"),
        ) ?? selected.find((source) => source.id !== rx?.id);
      dispatch(
        setSourceBindings({
          group: "tx-suite",
          bindings: { rx: rx?.id ?? null, tx: tx?.id ?? null },
        }),
      );
    },
    [dispatch, sources],
  );
  const selectedPrimaryFile = useMemo(() => {
    if (sourceMode !== "file" || selectedFiles.length !== 1) return null;
    const file = selectedFiles[0];
    const lower = file.name.toLowerCase();
    return lower.endsWith(".napt") || lower.endsWith(".wav") ? file : null;
  }, [selectedFiles, sourceMode]);
  const stitchStatus = useAppSelector((state) => state.waterfall.stitchStatus);
  const loadedFileMetadata = useAppSelector(
    (state) => state.waterfall.loadedFileMetadata,
  );
  const isStitchPaused = useAppSelector(
    (state) => state.waterfall.isStitchPaused,
  );
  const liveIsPaused = useAppSelector((s) => s.websocket.isPaused);

  const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);
  const sourceDevices = useMemo(
    () =>
      sources.map((source) => {
        const isStreaming = source.status === "streaming";
        const isMockSource = source.capability === "mock";
        const isTxSource =
          source.capability?.toLowerCase().includes("tx") ||
          source.id === "mock-tx" ||
          source.name === "Mock Tx SDR";
        const isPaused = source.paused ?? false;
        const isLiveConnected =
          source.status === "connected" || isStreaming || isMockSource;
        const actionLabel = isLiveConnected
          ? isPaused
            ? "Resume"
            : "Pause"
          : undefined;
        const actionTitle = isLiveConnected
          ? isPaused
            ? "Resume playback"
            : "Pause playback"
          : undefined;

        return {
          id: source.id,
          name: source.name,
          backend: source.kind,
          capability: source.capability,
          summary: source.serial_number
            ? `SN ${source.serial_number}`
            : source.manufacturer
              ? source.manufacturer
              : undefined,
          status: {
            color:
              isMockSource && isStreaming
                ? "#ffb000"
                : isStreaming
                  ? "#19d97d"
                  : undefined,
            label: source.status ?? undefined,
            loading: source.status === "loading",
            loadingLabel:
              source.status === "loading"
                ? `Loading ${source.name}`
                : undefined,
            actionLabel,
            actionTitle,
            onAction: isTxSource
              ? () => handleToggleTransmit(source.id)
              : isLiveConnected
                ? () => toggleVisualizerPause(source.id)
                : undefined,
          },
        };
      }),
    [handleToggleTransmit, sources, toggleVisualizerPause],
  );

  const wasLivePausedBeforeFileModeRef = useRef<boolean>(false);
  const previousSourceModeRef = useRef<SourceMode>(
    sourceMode === "file" ? "live" : sourceMode,
  );

  const handleSourceModeChange = (mode: SourceMode) => {
    dispatch(setSourceMode(mode));
  };

  const handleSelectedDeviceChange = useCallback(
    (id: string) => {
      setSelectedSourceId(id);
      if (sourceMode === "file") {
        handleSourceModeChange("live");
      }
    },
    [handleSourceModeChange, setSelectedSourceId, sourceMode],
  );

  const fileActionLabel = useMemo(() => {
    if (sourceMode !== "file") return "File";
    const status = stitchStatus?.toLowerCase?.() ?? "";
    if (!selectedFiles.length) return "Browse";
    if (status.includes("processing") || status.includes("loading")) {
      return "Process [auto]";
    }
    return isStitchPaused ? "Play" : "Pause";
  }, [isStitchPaused, selectedFiles.length, sourceMode, stitchStatus]);

  const fileActionTitle = useMemo(() => {
    if (sourceMode !== "file") return "Switch to File Selection";
    const status = stitchStatus?.toLowerCase?.() ?? "";
    if (!selectedFiles.length) return "Browse files";
    if (status.includes("processing") || status.includes("loading")) {
      return "Process selected file automatically";
    }
    return isStitchPaused ? "Resume playback" : "Pause playback";
  }, [isStitchPaused, selectedFiles.length, sourceMode, stitchStatus]);

  const handleFileAction = useCallback(() => {
    if (sourceMode !== "file") return;
    if (!selectedFiles.length) return;
    const status = stitchStatus?.toLowerCase?.() ?? "";
    if (status.includes("processing") || status.includes("loading")) {
      dispatch(triggerStitch());
      return;
    }
    dispatch(setStitchPaused(!isStitchPaused));
  }, [
    dispatch,
    isStitchPaused,
    selectedFiles.length,
    sourceMode,
    stitchStatus,
  ]);

  const handleSourceFilesSelected = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const registeredFiles = files.map((file) => ({
        id: fileRegistry.register(file),
        name: file.name,
      }));

      dispatch(setSourceMode("file"));
      dispatch(setSelectedFiles(registeredFiles));
      dispatch(triggerStitch());
    },
    [dispatch],
  );

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
      liveFrameRuntime.clear();
      if (!manualVisualizerPaused) {
        toggleVisualizerPause();
      }
      return;
    }

    liveFrameRuntime.clear();
    if (wasLivePausedBeforeFileModeRef.current) {
      toggleVisualizerPause();
    }
  }, [dispatch, manualVisualizerPaused, sourceMode, toggleVisualizerPause]);

  return (
    <SidebarContent>
      <SourceSidebar
        sourceMode={sourceMode}
        onSourceModeChange={handleSourceModeChange}
        backend={activeSourceDerived.backend}
        deviceName={activeSourceDerived.deviceName}
        devices={sourceDevices as any}
        selectedDeviceId={selectedSourceId}
        onSelectedDeviceChange={handleSelectedDeviceChange}
        selectionMode={isTxSuiteFlow ? "multi" : "single"}
        maxSelectedDevices={2}
        selectedDeviceIds={isTxSuiteFlow ? routedSourceIds : undefined}
        onSelectedDevicesChange={
          isTxSuiteFlow ? handleMultiSourceChange : undefined
        }
        spaceBoundDeviceId={selectedSourceId || null}
        onToggleDeviceRxPause={(id) => toggleVisualizerPause(id)}
        onToggleDeviceTxMode={handleToggleTransmit}
        selectedFilesCount={selectedFiles.length}
        onFileAction={handleFileAction}
        onFilesSelected={handleSourceFilesSelected}
        fileActionLabel={fileActionLabel}
        fileActionTitle={fileActionTitle}
      />

      {sourceMode === "file" && (
        <FileSelectionSidebar
          selectedFiles={selectedFiles}
          onSelectedFilesChange={(files: any) => {
            dispatch(setSelectedFiles(files));
          }}
          stitchStatus={stitchStatus}
          isStitchPaused={isStitchPaused}
          onClear={() => {
            dispatch(setSelectedFiles([]));
          }}
          selectedPrimaryFile={selectedPrimaryFile}
          naptMetadata={loadedFileMetadata ?? null}
          naptMetadataError={null}
          showMetadata={false}
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
