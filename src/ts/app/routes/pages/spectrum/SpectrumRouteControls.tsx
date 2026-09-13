import React, { useSyncExternalStore } from "react";
import styled from "styled-components";
import { Button } from "@n-apt/ui/Button";
import { Toggle } from "@n-apt/ui/Toggle";
import type {
  RecordingCountdownStore,
  SnapshotVideoFormat,
} from "@n-apt/capture/hooks/useSnapshot";

/** Route-level containers and controls kept local to the spectrum feature. */
export const SpectrumContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  user-select: none;
`;

export const SpectrumContent = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  position: relative;
`;

export const FFTBackButton = styled(Button)`
  min-width: 0;
  height: 24px;
  padding-inline: 12px;
  border-radius: 999px;
  box-shadow: none;
  font-size: 10px;
  line-height: 1;
  margin-left: auto;
`;

const FastSnapshotPill = styled.div<{ $disabled?: boolean }>`
  display: inline-flex;
  align-items: stretch;
  height: 24px;
  min-height: 24px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.border};
  background-color: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textSecondary};
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.02em;
  box-shadow: none;
  opacity: ${(props) => (props.$disabled ? 0.55 : 1)};
`;

const FastSnapshotLabel = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  color: ${(props) => props.theme.textMuted};
  white-space: nowrap;
  user-select: none;
`;

export const FastSnapshotDivider = styled.span`
  width: 1px;
  align-self: stretch;
  background-color: ${(props) => props.theme.border};
`;

const FastSnapshotModeButton = styled.button`
  border: 0;
  border-radius: 0;
  background: transparent;
  color: ${(props) => props.theme.textPrimary};
  font: inherit;
  letter-spacing: inherit;
  padding: 0 9px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
  &:disabled {
    cursor: not-allowed;
    color: ${(props) => props.theme.textMuted};
  }
  &:not(:disabled):hover {
    background-color: ${(props) => props.theme.primary}20;
    color: ${(props) => props.theme.primary};
  }
`;

const FastSnapshotStopButton = styled(FastSnapshotModeButton)`
  padding: 0 12px;
  color: ${(props) => props.theme.primary};
  font-weight: 700;
`;

const FastSnapshotToggleWrapper = styled.div`
  display: flex;
  align-items: center;
  padding: 0 8px;
  span {
    font-size: 10px;
    font-family: inherit;
    text-transform: none;
    letter-spacing: inherit;
  }
`;

export const NotesSnapshotPill = styled(FastSnapshotPill)`
  min-height: 24px;
`;
export const NotesSnapshotLabel = styled(FastSnapshotLabel)`
  padding-inline: 9px;
`;
export const NotesSnapshotButton = styled(FastSnapshotModeButton)`
  padding-inline: 10px;
`;
export const HeaderActionSpacer = styled.span`
  flex: 1 1 auto;
  min-width: 12px;
`;

export const TxOptionsShell = styled.div`
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%);
  z-index: 150;
  width: min(72vw, 460px);
  pointer-events: none;
`;

export const TxOptionsCard = styled.div`
  pointer-events: auto;
  border-radius: 18px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 10px 30px
    ${({ theme }) =>
      theme.mode === "light"
        ? "rgba(31, 37, 50, 0.12)"
        : "rgba(0, 0, 0, 0.32)"};
  padding: 12px;
`;

export const TxOptionsTitle = styled.div`
  margin-bottom: 10px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  font-family: ${({ theme }) => theme.typography.mono};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

export const TxOptionsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

export const TxPowerField = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  input {
    min-width: 0;
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 4px;
    background: ${({ theme }) => theme.colors.surface};
    color: ${({ theme }) => theme.colors.textPrimary};
    font: 11px ${({ theme }) => theme.typography.mono};
    padding: 5px 6px;
  }
`;

const FastRecordingDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: ${(props) => props.theme.primary};
  animation: fast-recording-dot-blink 1s ease-in-out infinite;
  @keyframes fast-recording-dot-blink {
    0% {
      opacity: 0.25;
      transform: scale(0.85);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0.25;
      transform: scale(0.85);
    }
  }
`;

const FastRecordingMeta = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
`;

/** Stable dimensions used only when a canvas has not reported its size yet. */
export const FAST_SPECTRUM_FALLBACK_HEIGHT = 400;
export const FAST_WATERFALL_FALLBACK_HEIGHT = 300;

export interface FastSnapshotControlProps {
  disabled?: boolean;
  isRecording?: boolean;
  recordingCountdown?: RecordingCountdownStore | null;
  onImage: () => void;
  onVideo: () => void;
  onStop: () => void;
  videoFormat: SnapshotVideoFormat | null;
  showStats: boolean;
  onShowStatsChange: (show: boolean) => void;
  fastSnapshotMode?: 0 | 1 | 2;
  onFastSnapshotModeChange?: (mode?: 0 | 1 | 2) => void;
}

/**
 * Renders just the ticking countdown. Isolated so the once-a-second update
 * cannot re-render the spectrum route while it is recording.
 */
const RecordingCountdownLabel: React.FC<{ store: RecordingCountdownStore }> = ({
  store,
}) => {
  const seconds = useSyncExternalStore(
    store.subscribe,
    store.getSecondsRemaining,
    store.getSecondsRemaining,
  );
  return <>{typeof seconds === "number" ? ` (${seconds}s)` : ""}</>;
};

/** Compact spectrum/waterfall snapshot and recording control. */
export const FastSnapshotControl: React.FC<FastSnapshotControlProps> = ({
  disabled = false,
  isRecording = false,
  recordingCountdown = null,
  onImage,
  onVideo,
  onStop,
  videoFormat,
  showStats,
  onShowStatsChange,
  fastSnapshotMode,
  onFastSnapshotModeChange,
}) =>
  isRecording ? (
    <FastSnapshotPill>
      <FastSnapshotStopButton type="button" onClick={onStop}>
        <FastRecordingMeta>
          <FastRecordingDot />
          <span>
            Stop and Save Recording
            {recordingCountdown ? (
              <RecordingCountdownLabel store={recordingCountdown} />
            ) : null}
          </span>
        </FastRecordingMeta>
      </FastSnapshotStopButton>
    </FastSnapshotPill>
  ) : (
    <FastSnapshotPill $disabled={disabled}>
      <FastSnapshotLabel>Fast Snapshot</FastSnapshotLabel>
      <FastSnapshotDivider />
      <FastSnapshotModeButton
        type="button"
        disabled={disabled}
        onClick={onImage}
      >
        Image
      </FastSnapshotModeButton>
      <FastSnapshotDivider />
      <FastSnapshotModeButton
        type="button"
        disabled={disabled || !videoFormat}
        onClick={onVideo}
        title={videoFormat ? `Video (.${videoFormat})` : "Video"}
      >
        Video
      </FastSnapshotModeButton>
      <FastSnapshotDivider />
      <FastSnapshotToggleWrapper>
        <Toggle
          $active={fastSnapshotMode === undefined ? showStats : fastSnapshotMode > 0}
          state={fastSnapshotMode}
          variant={fastSnapshotMode === undefined ? "default" : "three-state"}
          onClick={(selectedMode) =>
            fastSnapshotMode !== undefined && onFastSnapshotModeChange
              ? onFastSnapshotModeChange(
                  selectedMode === undefined
                    ? undefined
                    : (selectedMode as 0 | 1 | 2),
                )
              : onShowStatsChange(!showStats)
          }
          title="Toggle including stats in snapshot/video"
          disabled={disabled}
          inactiveLabel="Stats"
          activeLabel="Stats"
          showInnerLabel={fastSnapshotMode === undefined}
          labelPosition="left"
        />
      </FastSnapshotToggleWrapper>
    </FastSnapshotPill>
  );
