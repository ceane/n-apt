import React, { useMemo, useState, useEffect, useCallback, memo } from "react";
import styled from "styled-components";
import { FileSignal } from "lucide-react";
import { useNodes, useEdges, type NodeProps, type Node } from "@xyflow/react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import {
  sendCaptureCommand,
  sendCaptureStopCommand,
} from "@n-apt/redux/thunks/websocketThunks";
import { useGeolocation } from "@n-apt/hooks/useGeolocation";
import { FrequencyInput } from "@n-apt/components/ui/FrequencyInput";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { MIN_CAPTURE_BANDWIDTH_HZ } from "@n-apt/utils/frequency";
import type { CaptureFileType } from "@n-apt/consts/schemas/websocket";

// Redefining types as needed, or use the ones from @xyflow/react
interface IQCaptureNodeData {
  label: string;
  iqCaptureNode?: boolean;
  [key: string]: any;
}

const NodeContainer = styled.div<{ selected?: boolean }>`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid
    ${({ theme, selected }) =>
      selected ? theme.colors.primary : theme.colors.border};
  border-radius: 8px;
  padding: ${({ theme }) => theme.spacing.lg};
  width: 100%;
  min-width: 480px;
  max-width: 520px;
  transition: border-color 0.2s ease;
`;

const NodeTitle = styled.div`
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const NodeSubtitle = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const RangeInputRow = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid ${({ theme }) => theme.colors.border}44;
`;
const EMPTY_ARRAY: any[] = [];

export const IQCaptureNode = memo(
  ({ id, data, selected }: Partial<NodeProps<Node<IQCaptureNodeData>>>) => {
    const dispatch = useAppDispatch();
    const nodes = useNodes();
    const edges = useEdges();
    const { isConnected, deviceState, captureStatus } = useAppSelector(
      (state) => state.websocket,
    );
    const spectrumRange = useAppSelector(
      (state) => state.spectrum.frequencyRange,
    );
    const fftSize = useAppSelector((state) => state.spectrum.fftSize);
    const fftWindow = useAppSelector((state) => state.spectrum.fftWindow);
    const demodCenterFreqHz = useAppSelector(
      (state) => state.demod?.centerFreqHz ?? null,
    );
    const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);

    // Channel metadata is Redux-owned; raw frame payloads remain imperative.
    const effectiveFrames = useAppSelector((state) => state.websocket.channels);

    // Find if we are connected to a ChannelNode
    const isConnectedToChannelNode = useMemo(() => {
      return edges.some((edge) => {
        if (edge.target === id) {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          return sourceNode?.data?.channelNode === true;
        }
        return false;
      });
    }, [id, edges, nodes]);

    const availableCaptureAreasFromStore = useAppSelector(
      (state) => (state.spectrum as any).availableCaptureAreas ?? EMPTY_ARRAY,
    );
    const { getLocation } = useGeolocation();

    const [activeCaptureAreas, setActiveCaptureAreas] = useState<string[]>([]);
    const [captureDurationMode, setCaptureDurationMode] = useState<
      "timed" | "manual"
    >("timed");
    const [captureDurationS, setCaptureDurationS] = useState(10);
    const [captureFileType, setCaptureFileType] =
      useState<CaptureFileType>(".wav");
    const [acquisitionMode, setAcquisitionMode] = useState<
      "stepwise" | "interleaved" | "whole_sample"
    >("whole_sample");
    const [captureEncrypted, setCaptureEncrypted] = useState(true);
    const [capturePlayback, setCapturePlayback] = useState(false);
    const [captureGeolocation, setCaptureGeolocation] = useState(false);

    const [customRange, setCustomRange] = useState({
      startHz: 0,
      endHz: 3_200_000,
    });
    const [hasInitialized, setHasInitialized] = useState(false);

    const sampleRateHz =
      useAppSelector((state) => state.spectrum.sampleRateHz) ?? 3_200_000;
    const captureRange = useMemo(() => {
      const halfSampleSizeHz = sampleRateHz / 2;
      // The displayed spectrum range is the source of truth for "Onscreen".
      // demod.centerFreqHz can describe a separate analysis target and may be
      // stale when the active source (for example Mock APT) changes.
      const onscreenMin = Math.max(
        0,
        Math.round(spectrumRange?.min ?? demodCenterFreqHz ?? 0),
      );
      const onscreenMax = Math.round(
        spectrumRange?.max ??
          (demodCenterFreqHz !== null
            ? demodCenterFreqHz + halfSampleSizeHz
            : sampleRateHz),
      );

      const customMin = Math.max(0, Math.round(customRange.startHz));
      const customMax = Math.max(0, Math.round(customRange.endHz));

      const segments = [
        { label: "Onscreen", min: onscreenMin, max: onscreenMax },
        { label: "Custom Range", min: customMin, max: customMax },
      ];

      // If connected to a ChannelNode, add the channels from the store
      if (isConnectedToChannelNode && Array.isArray(effectiveFrames)) {
        effectiveFrames.forEach((frame: any) => {
          // Only add if it's a real channel (A or B usually) or has frequency data
          if (frame.min_hz !== undefined && frame.max_hz !== undefined) {
            // Avoid duplicates if labels match
            if (!segments.some((s) => s.label === frame.label)) {
              segments.push({
                label: frame.label,
                min: frame.min_hz,
                max: frame.max_hz,
              });
            }
          }
        });
      }

      return { min: onscreenMin, max: onscreenMax, segments };
    }, [
      customRange,
      demodCenterFreqHz,
      spectrumRange,
      sampleRateHz,
      isConnectedToChannelNode,
      effectiveFrames,
    ]);

    const { bandwidthHz, bandwidthCenterFrequencyHz } = useMemo(() => {
      if (activeCaptureAreas.includes("Custom Range")) {
        return {
          bandwidthHz: Math.abs(customRange.endHz - customRange.startHz),
          bandwidthCenterFrequencyHz: Math.round(
            (customRange.startHz + customRange.endHz) / 2,
          ),
        };
      }

      // For other areas (Onscreen or Channels), use the first one as primary for bandwidth metadata
      if (activeCaptureAreas.length > 0) {
        const area = captureRange.segments.find(
          (s) => s.label === activeCaptureAreas[0],
        );
        if (area) {
          return {
            bandwidthHz: area.max - area.min,
            bandwidthCenterFrequencyHz: Math.round((area.min + area.max) / 2),
          };
        }
      }

      return {
        bandwidthHz: sampleRateHz,
        bandwidthCenterFrequencyHz: demodCenterFreqHz ?? 0,
      };
    }, [
      activeCaptureAreas,
      customRange,
      captureRange.segments,
      sampleRateHz,
      demodCenterFreqHz,
    ]);

    useEffect(() => {
      if (sourceMode !== "live") {
        setCapturePlayback(false);
      }
    }, [sourceMode]);

    useEffect(() => {
      if (hasInitialized) return;
      const spanHz = Math.max(sampleRateHz, MIN_CAPTURE_BANDWIDTH_HZ);
      const start = Math.max(
        0,
        Math.round(spectrumRange?.min ?? (demodCenterFreqHz ?? 0) - spanHz / 2),
      );
      const end = spectrumRange?.max
        ? Math.round(spectrumRange.max)
        : start + spanHz;

      setCustomRange({ startHz: start, endHz: end });
      setHasInitialized(true);
    }, [demodCenterFreqHz, spectrumRange?.min, sampleRateHz, hasInitialized]);

    const handleStartHzChange = useCallback((hz: number) => {
      setCustomRange((prev) => {
        const nextStart = Math.max(0, Math.round(hz));
        const minEnd = nextStart + MIN_CAPTURE_BANDWIDTH_HZ;
        return {
          startHz: nextStart,
          endHz: prev.endHz < minEnd ? minEnd : prev.endHz,
        };
      });
      setActiveCaptureAreas((current) =>
        current.includes("Custom Range")
          ? current
          : [...current, "Custom Range"],
      );
    }, []);

    const handleEndHzChange = useCallback((hz: number) => {
      setCustomRange((prev) => {
        const nextEnd = Math.max(MIN_CAPTURE_BANDWIDTH_HZ, Math.round(hz));
        const maxStart = nextEnd - MIN_CAPTURE_BANDWIDTH_HZ;
        return {
          startHz:
            prev.startHz > maxStart ? Math.max(0, maxStart) : prev.startHz,
          endHz: nextEnd,
        };
      });
      setActiveCaptureAreas((current) =>
        current.includes("Custom Range")
          ? current
          : [...current, "Custom Range"],
      );
    }, []);

    const availableCaptureAreasWithExtra = useMemo(() => {
      const baseAreas =
        availableCaptureAreasFromStore.length > 0
          ? availableCaptureAreasFromStore
          : captureRange.segments;

      return baseAreas.map((area: any) => {
        if (area.label === "Custom Range" || (area as any).isCustom) {
          return {
            ...area,
            min: customRange.startHz,
            max: customRange.endHz,
            extra: (
              <RangeInputRow key="custom-range-inputs">
                <FrequencyInput
                  label="Start"
                  valueHz={customRange.startHz}
                  onChangeHz={handleStartHzChange}
                  minHz={0}
                  maxHz={30_000_000_000}
                  id="iq-capture-custom-range-start"
                />
                <FrequencyInput
                  label="End"
                  valueHz={customRange.endHz}
                  onChangeHz={handleEndHzChange}
                  minHz={0}
                  maxHz={30_000_000_000}
                  id="iq-capture-custom-range-end"
                />
              </RangeInputRow>
            ),
          };
        }
        return area;
      });
    }, [
      availableCaptureAreasFromStore,
      captureRange,
      customRange.startHz,
      customRange.endHz,
      handleStartHzChange,
      handleEndHzChange,
    ]);

    const handleCapture = async () => {
      const jobId = `demod_capture_${Date.now()}`;
      const geolocation = captureGeolocation ? await getLocation() : undefined;
      const fragments = activeCaptureAreas.reduce<
        { minFreq: number; maxFreq: number }[]
      >((acc, areaName) => {
        const area = captureRange.segments.find((s) => s.label === areaName);
        if (area) acc.push({ minFreq: area.min, maxFreq: area.max });
        return acc;
      }, []);

      if (fragments.length === 0) return;

      dispatch(
        sendCaptureCommand({
          jobId,
          fragments,
          bandwidth: bandwidthHz,
          bandwidthCenterFrequency: bandwidthCenterFrequencyHz || undefined,
          durationMode: captureDurationMode,
          durationS:
            captureDurationMode === "timed" ? captureDurationS : undefined,
          fileType: captureFileType,
          acquisitionMode,
          encrypted: captureEncrypted,
          fftSize,
          fftWindow,
          geolocation: geolocation ?? undefined,
          // Demod-route captures must be persisted so the completion status
          // includes a downloadable artifact, including Mock APT captures.
          liveMode: false,
        }),
      );
    };

    return (
      <NodeContainer selected={selected}>
        <NodeTitle>
          <FileSignal size={16} />
          {data?.label ?? "I/Q Capture"}
        </NodeTitle>
        <NodeSubtitle>Take an I/Q capture from the demod route</NodeSubtitle>
        <IQCaptureControlsSection
          variant="node"
          activeCaptureAreas={activeCaptureAreas}
          availableCaptureAreas={availableCaptureAreasWithExtra}
          captureDurationMode={captureDurationMode}
          captureDurationS={captureDurationS}
          captureFileType={captureFileType}
          acquisitionMode={acquisitionMode}
          captureEncrypted={captureEncrypted}
          capturePlayback={capturePlayback}
          captureGeolocation={captureGeolocation}
          captureRange={captureRange}
          maxSampleRate={sampleRateHz}
          captureStatus={captureStatus}
          isConnected={isConnected}
          deviceState={deviceState}
          onActiveCaptureAreasChange={setActiveCaptureAreas}
          onCaptureDurationModeChange={setCaptureDurationMode}
          onCaptureDurationSChange={setCaptureDurationS}
          onCaptureFileTypeChange={setCaptureFileType}
          onAcquisitionModeChange={setAcquisitionMode}
          onCaptureEncryptedChange={setCaptureEncrypted}
          onCapturePlaybackChange={setCapturePlayback}
          onCaptureGeolocationChange={setCaptureGeolocation}
          onCapture={handleCapture}
          onStopCapture={() =>
            dispatch(sendCaptureStopCommand(captureStatus?.jobId))
          }
          onClearStatus={() => undefined}
        />
      </NodeContainer>
    );
  },
);

export default IQCaptureNode;
