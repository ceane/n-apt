import React, { useEffect, useMemo } from "react";
import styled from "styled-components";
import { useReactFlow } from "@xyflow/react";
import { Radio as RadioIcon, Volume2, VolumeX } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { setAlgorithm, setListening } from "@n-apt/redux/slices/demodSlice";
import { syncRadioDemodFromSource } from "@n-apt/redux/thunks/demodThunks";
import { formatFrequency } from "@n-apt/utils/frequency";
import { useDemod } from "@n-apt/contexts/DemodContext";

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  padding-bottom: 8px;
`;

const Title = styled.div`
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${({ theme }) => theme.colors.primary};
`;

const ControlGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ControlItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-size: 9px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textMuted};
`;

const StyledSelect = styled.select`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 4px 8px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  font-family: ${({ theme }) => theme.typography.sans};
  width: 100%;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const FrequencyDisplay = styled.div`
  font-size: 12px;
  font-family: ${({ theme }) => theme.typography.mono};
  color: ${({ theme }) => theme.colors.primary};
  background: ${({ theme }) => theme.colors.surface};
  padding: 8px;
  border-radius: 4px;
  text-align: center;
  border: 1px dashed ${({ theme }) => theme.colors.border};
`;

const SourceTag = styled.div`
  align-self: flex-start;
  margin-top: 4px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textMuted};
  background: transparent;
`;

const ListenButton = styled.button<{ $active: boolean }>`
  width: 100%;
  margin-top: 12px;
  background: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.primary + "22"};
  border: 1px solid ${({ theme }) => theme.colors.primary}44;
  color: ${({ theme, $active }) =>
    $active ? theme.colors.background : theme.colors.primary};
  padding: 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &:hover {
    background: ${({ theme, $active }) =>
      $active ? theme.colors.primary : theme.colors.primary + "44"};
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

interface RadioNodeProps {
  data: {
    label: string;
  };
}

const MIN_BANDWIDTH_HZ = 1_000;

export const RadioNode: React.FC<RadioNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const algorithm = useAppSelector((state) => state.demod.algorithm);
  const bandwidthKhz = useAppSelector((state) => state.demod.bandwidthKhz);
  const isListening = useAppSelector((state) => state.demod.isListening);
  const centerFreq = useAppSelector((state) => state.demod.centerFreqHz);
  const isPaused = useAppSelector(
    (state) => state.websocket?.isPaused ?? false,
  );
  const previewRange = useAppSelector((state) => state.spectrum.previewRange);

  const { audioPlayback } = useDemod();
  const { getNodes, getEdges } = useReactFlow();

  const upstreamSource = useMemo<"fm" | "connected" | "manual">(() => {
    const nodes = getNodes();
    const edges = getEdges();
    const radioNode = nodes.find(
      (n) => n.data?.label === data.label && n.type === "custom",
    );

    if (!radioNode) return "manual";

    const upstreamNodeIds = edges.reduce<string[]>((acc, e) => {
      if (e.target === radioNode.id) acc.push(e.source);
      return acc;
    }, []);

    const upstreamNodes = upstreamNodeIds.reduce<typeof nodes>((acc, id) => {
      const node = nodes.find((n) => n.id === id);
      if (node) acc.push(node);
      return acc;
    }, []);

    if (upstreamNodes.some((node) => node?.data?.fmOptions)) return "fm";
    if (upstreamNodes.length > 0) return "connected";
    return "manual";
  }, [getNodes, getEdges, data]);
  const hasFmNodeUpstream = upstreamSource === "fm";
  const hasUpstreamConnection = upstreamSource !== "manual";

  // Auto-select APT algorithm if an APT node is present in the flow
  useEffect(() => {
    const nodes = getNodes();
    const hasAptNode = nodes.some((n) => n.data && n.data.aptOptions);

    if (hasAptNode && algorithm === "fm") {
      dispatch(setAlgorithm("aptImage"));
    }
  }, [getNodes, algorithm, dispatch]);

  useEffect(() => {
    if (isPaused && isListening) {
      audioPlayback.stopAudio();
    }
  }, [audioPlayback, isListening, isPaused]);

  const handleListenToggle = () => {
    const nextState = !isListening;
    dispatch(setListening(nextState));

    if (nextState) {
      audioPlayback.resumeAudioContext();
    } else {
      audioPlayback.stopAudio();
    }
  };

  const centerHzFromPreview =
    previewRange &&
    Number.isFinite(previewRange.min) &&
    Number.isFinite(previewRange.max)
      ? (previewRange.min + previewRange.max) / 2
      : null;
  const bandwidthHzFromPreview =
    previewRange &&
    Number.isFinite(previewRange.min) &&
    Number.isFinite(previewRange.max)
      ? previewRange.max - previewRange.min
      : null;

  const sourceBadge = hasUpstreamConnection ? "From Node" : "Manual";
  const centerDisplayHz = hasFmNodeUpstream
    ? centerFreq
    : hasUpstreamConnection
      ? centerHzFromPreview
      : centerFreq;
  const bandwidthDisplayHz = hasFmNodeUpstream
    ? (bandwidthKhz || 200) * 1000
    : hasUpstreamConnection
      ? bandwidthHzFromPreview
      : (bandwidthKhz || 200) * 1000;
  const formatRadioFrequency = (valueHz: number) =>
    formatFrequency(valueHz, {
      precisionMHz: 3,
      precisionKHz: 0,
      precisionGHz: 6,
      trimTrailingZeros: true,
    });

  useEffect(() => {
    if (hasFmNodeUpstream) {
      dispatch(
        syncRadioDemodFromSource({
          source: "fm",
          centerFreqHz: centerFreq,
          bandwidthKhz: bandwidthKhz,
        }),
      );
      return;
    }

    if (
      hasUpstreamConnection &&
      centerHzFromPreview != null &&
      bandwidthHzFromPreview != null
    ) {
      dispatch(
        syncRadioDemodFromSource({
          source: "span",
          centerFreqHz: centerHzFromPreview,
          bandwidthHz: bandwidthHzFromPreview,
        }),
      );
    }
  }, [
    dispatch,
    hasFmNodeUpstream,
    hasUpstreamConnection,
    centerFreq,
    bandwidthKhz,
    centerHzFromPreview,
    bandwidthHzFromPreview,
  ]);

  return (
    <>
      <Header>
        <RadioIcon size={14} color="#00d4ff" />
        <Title>{data.label || "Radio"}</Title>
      </Header>

      <ControlGroup>
        <ControlItem>
          <Label>Center Frequency</Label>
          <FrequencyDisplay>
            {centerDisplayHz != null
              ? formatRadioFrequency(centerDisplayHz)
              : sourceBadge}
          </FrequencyDisplay>
          <SourceTag>{sourceBadge}</SourceTag>
        </ControlItem>

        <ControlItem>
          <Label>Bandwidth</Label>
          <FrequencyDisplay>
            {bandwidthDisplayHz != null &&
            Number.isFinite(bandwidthDisplayHz) &&
            bandwidthDisplayHz >= MIN_BANDWIDTH_HZ
              ? formatRadioFrequency(bandwidthDisplayHz)
              : sourceBadge}
          </FrequencyDisplay>
          <SourceTag>{sourceBadge}</SourceTag>
        </ControlItem>

        <ControlItem>
          <Label>Demod Algorithm</Label>
          <StyledSelect
            value={hasFmNodeUpstream ? "fm" : algorithm}
            onChange={(e) =>
      dispatch(
        setAlgorithm(e.target.value as "fm" | "aptAudio" | "aptImage"),
      )
            }
            disabled={hasFmNodeUpstream}
          >
            <option value="fm">FM (Wideband/Narrow)</option>
            <option value="aptAudio">APTAudio (NOAA Satellite audio)</option>
            <option value="aptImage">APTImage (NOAA Satellite image)</option>
          </StyledSelect>
        </ControlItem>
      </ControlGroup>

      <ListenButton $active={isListening} onClick={handleListenToggle}>
        {isListening ? <Volume2 size={12} /> : <VolumeX size={12} />}
        {isListening ? "Stop Listening" : "Listen Real-time"}
      </ListenButton>
    </>
  );
};
