import React from "react";
import styled from "styled-components";
import { AlertTriangle, Check, Play, RadioTower } from "lucide-react";
import { useAppSelector } from "@n-apt/redux";
import { Channels } from "@n-apt/spectrum";
import { useSpectrumStore } from "@n-apt/spectrum/public/useSpectrumStore";
import { formatFrequency } from "@n-apt/math/frequency";
import { useDemod } from "@n-apt/demodulation/context/DemodContext";
import { useDemodAudio } from "@n-apt/demodulation/context/DemodAudioContext";
import { AudioDemodWorkflowFlow } from "@n-apt/demodulation/react-flow/nodes/AudioDemodWorkflowFlow";
import { VisionDemodWorkflowFlow } from "@n-apt/demodulation/react-flow/nodes/VisionDemodWorkflowFlow";
import { evaluateStimulusChannelAccess } from "@n-apt/demodulation/react-flow/nodes/stimulusChannelPolicy";
import { getVisionReceiverLabel } from "@n-apt/demodulation/vision/visionSourcePolicy";
import { registerActiveAcquisitionOperation } from "@n-apt/spectrum/activeAcquisitionOperations";

const ReadinessCard = styled.section`
  width: 100%;
  min-width: 320px;
  padding: 16px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  background: linear-gradient(
    145deg,
    ${({ theme }) => theme.colors.surface},
    ${({ theme }) => theme.colors.background}
  );
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
`;

const ReadinessHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
`;

const ReadinessIcon = styled.div<{ $warning: boolean }>`
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid
    ${({ $warning, theme }) =>
      $warning ? "rgba(245, 158, 11, 0.35)" : `${theme.colors.primary}55`};
  border-radius: 10px;
  color: ${({ $warning, theme }) =>
    $warning ? "#f59e0b" : theme.colors.primary};
  background: ${({ $warning }) =>
    $warning ? "rgba(245, 158, 11, 0.1)" : "rgba(0, 212, 255, 0.08)"};
`;

const ReadinessTitle = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  font-weight: 750;
  letter-spacing: 0.02em;
`;

const ReadinessSubtitle = styled.div`
  margin-top: 3px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  line-height: 1.4;
`;

const StatusPanel = styled.div<{ $warning: boolean }>`
  padding: 11px 12px;
  border: 1px solid
    ${({ $warning }) =>
      $warning ? "rgba(245, 158, 11, 0.28)" : "rgba(34, 197, 94, 0.24)"};
  border-radius: 10px;
  background: ${({ $warning }) =>
    $warning ? "rgba(245, 158, 11, 0.07)" : "rgba(34, 197, 94, 0.06)"};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  line-height: 1.5;
`;

const StatusHeading = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin-bottom: 6px;
  font-weight: 700;
`;

const StatusPrimaryReason = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  font-weight: 500;
`;

const ReasonList = styled.ul`
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ResumePrompt = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
  padding: 9px 10px;
  border: 1px solid rgba(245, 158, 11, 0.24);
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.06);
`;

const ResumeCopy = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  line-height: 1.45;
`;

const ResumeButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  padding: 5px 11px;
  border: 1px solid ${({ theme }) => theme.colors.primary}66;
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.primary}18;
  color: ${({ theme }) => theme.colors.primary};
  font: inherit;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.primary}2b;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ChannelGuide = styled.div`
  margin-top: 10px;
  padding: 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.surface};
`;

const ChannelGuideTitle = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  font-weight: 700;
`;

const ChannelGuideCopy = styled.div`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  line-height: 1.5;
`;

const PairingGuide = styled.div`
  margin-top: 10px;
  padding: 10px 12px;
  border-left: 2px solid ${({ theme }) => theme.colors.primary};
  border-radius: 0 8px 8px 0;
  background: rgba(0, 212, 255, 0.06);
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  line-height: 1.5;
`;

interface DemodReadinessNodeProps {
  data: { label?: string };
}

const formatChannelRequirement = (
  labels: string[],
  mode: "any" | "all" | null,
) => {
  if (labels.length === 0) return "configured channel metadata";
  if (labels.length === 1) return `Channel ${labels[0]}`;
  const joiner = mode === "all" ? "and" : "or";
  return `Channel ${labels.join(` ${joiner} `)}`;
};

const stimulusKindLabel = (type: string) => {
  if (type === "vision") return "Vision";
  if (type === "speech") return "Speech";
  if (type === "internal") return "Internal audio";
  if (type === "apt") return "APT";
  if (type === "audio") return "Audio and Speech";
  return "Audio";
};

export const DemodReadinessNode: React.FC<DemodReadinessNodeProps> = ({
  data,
}) => {
  const {
    analysisSession,
    demodQualityStatus,
    selectedBaseline,
    visionPreset,
    audioSurveyJob,
    audioSurveyCandidates,
    audioSurveyTraining,
    audioSurveyNeuralModelReady,
    audioSurveyNeuralBackend,
    audioSurveyOnnxModelAvailable,
    audioSurveyOnnxLoading,
  } = useDemod();
  const { audioPlayback } = useDemodAudio();
  const {
    manualVisualizerPaused,
    selectedSourceId,
    setVisualizerPause,
    toggleVisualizerPause,
  } = useSpectrumStore();
  const demodSourceMode = useAppSelector((state) => state.demod.sourceMode);
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const sources = useAppSelector((state) => state.websocket.sources);
  const websocketPaused = useAppSelector((state) => state.websocket.isPaused);
  const activeSourceStatus = useAppSelector((state) =>
    activeSourceId
      ? (state.websocket.sourceStatuses?.[activeSourceId] ??
        sources?.find((source) => source.id === activeSourceId)?.status)
      : null,
  );
  const replayCaptureCount = useAppSelector(
    (state) => state.waterfall.selectedFiles.length,
  );
  const selectedAlgorithm = useAppSelector((state) => state.demod.algorithm);
  const bandwidthKhz = useAppSelector((state) => state.demod.bandwidthKhz);
  const isListening = useAppSelector((state) => state.demod.isListening);
  const centerFrequencyHz = useAppSelector(
    (state) => state.demod.bandwidthCenterFreqHz ?? state.demod.centerFreqHz,
  );
  const frequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const channels = useAppSelector((state) => state.websocket.channels ?? []);
  const tunedFrequencyHz =
    centerFrequencyHz ??
    (frequencyRange &&
    Number.isFinite(frequencyRange.min) &&
    Number.isFinite(frequencyRange.max)
      ? (frequencyRange.min + frequencyRange.max) / 2
      : null);
  const channelAccess = evaluateStimulusChannelAccess(
    selectedBaseline,
    tunedFrequencyHz,
    channels,
  );
  const audioFlowSelected =
    selectedBaseline === "audio" ||
    selectedBaseline === "internal" ||
    selectedBaseline === "speech";
  const sourceReady =
    sourceMode === "file" ? replayCaptureCount > 0 : Boolean(activeSourceId);
  const selectedVisionReceiver = getVisionReceiverLabel(
    sourceMode === "file"
      ? undefined
      : sources?.find((source) => source.id === activeSourceId),
  );
  const isSourcePaused = Boolean(
    sourceMode !== "file" &&
    activeSourceId &&
    (sources?.find((source) => source.id === activeSourceId)?.paused ||
      activeSourceStatus === "paused" ||
      (activeSourceId === selectedSourceId && manualVisualizerPaused) ||
      (activeSourceId === selectedSourceId && websocketPaused)),
  );
  const resumeTargetSourceId = activeSourceId ?? selectedSourceId;
  React.useEffect(() => {
    if (demodSourceMode !== "live" || !resumeTargetSourceId) return;
    return registerActiveAcquisitionOperation(
      "demod-readiness-node",
      resumeTargetSourceId,
    );
  }, [demodSourceMode, resumeTargetSourceId]);
  const resumeSource = React.useCallback(() => {
    if (!resumeTargetSourceId) return;
    if (setVisualizerPause) {
      setVisualizerPause(false, resumeTargetSourceId, "rx");
    } else {
      toggleVisualizerPause(resumeTargetSourceId);
    }
  }, [resumeTargetSourceId, setVisualizerPause, toggleVisualizerPause]);
  const visionChannelLabel = channelAccess.requiredChannelLabels[0] ?? null;
  const visionChannel = channels.find(
    (channel) => channel.label?.trim().toUpperCase() === visionChannelLabel,
  );
  const visionChannelRangeLabel =
    visionChannel &&
    Number.isFinite(visionChannel.min_hz) &&
    Number.isFinite(visionChannel.max_hz) &&
    visionChannel.max_hz > visionChannel.min_hz
      ? `${formatFrequency(visionChannel.min_hz, { precisionMHz: 2, trimTrailingZeros: true })}–${formatFrequency(visionChannel.max_hz, { precisionMHz: 2, trimTrailingZeros: true })}`
      : "range unavailable";
  const hasQualityWarning =
    !!demodQualityStatus && demodQualityStatus.fit !== "ready";
  const hasChannelWarning = !channelAccess.allowed;
  const hasWarning = hasQualityWarning || hasChannelWarning;
  const isBusy =
    analysisSession.state !== "idle" && analysisSession.state !== "result";

  return (
    <ReadinessCard aria-label={data.label ?? "Demodulation readiness"}>
      <ReadinessHeader>
        <ReadinessIcon $warning={hasWarning}>
          {hasWarning ? <AlertTriangle size={16} /> : <Check size={16} />}
        </ReadinessIcon>
        <div>
          <ReadinessTitle>
            {data.label ?? "Demodulation Readiness"}
          </ReadinessTitle>
          <ReadinessSubtitle>
            Capture checks and stimulus channel compatibility
          </ReadinessSubtitle>
        </div>
      </ReadinessHeader>

      {demodQualityStatus ? (
        <StatusPanel
          role={hasQualityWarning ? "alert" : "status"}
          data-testid="demod-quality-status"
          data-quality-fit={demodQualityStatus.fit}
          $warning={hasQualityWarning}
        >
          <StatusHeading>
            {hasQualityWarning ? (
              <AlertTriangle size={13} color="#f59e0b" />
            ) : (
              <Check size={13} color="#22c55e" />
            )}
            {hasQualityWarning
              ? "Capture setup needs attention"
              : "Capture quality requirements met"}
            {hasQualityWarning && demodQualityStatus.reasons[0] && (
              <StatusPrimaryReason data-testid="capture-setup-primary-reason">
                · {demodQualityStatus.reasons[0]}
              </StatusPrimaryReason>
            )}
          </StatusHeading>
          {hasQualityWarning && (
            <>
              {isSourcePaused && (
                <ResumePrompt role="note">
                  <ResumeCopy>
                    Acquisition is paused. Press Resume to receive fresh frames.
                  </ResumeCopy>
                  <ResumeButton
                    type="button"
                    onClick={resumeSource}
                    disabled={!resumeTargetSourceId}
                    aria-label="Resume signal acquisition"
                  >
                    <Play size={12} fill="currentColor" />
                    Resume
                  </ResumeButton>
                </ResumePrompt>
              )}
              <ReasonList>
                {demodQualityStatus.reasons.map((reason, index) => (
                  <li key={`${reason}-${index}`}>{reason}</li>
                ))}
              </ReasonList>
            </>
          )}
        </StatusPanel>
      ) : (
        <StatusPanel role="status" $warning={false}>
          Waiting for the signal configuration check.
        </StatusPanel>
      )}

      {selectedBaseline === "audio" && channelAccess.allowed && (
        <PairingGuide role="note">
          Trigger waits for a fresh tuned Channel A/B frame, then plays the 440
          Hz tone and reports whether the aligned I/Q and PCM pair was saved in
          the Stimulus node.
        </PairingGuide>
      )}

      {hasChannelWarning && (
        <ChannelGuide data-testid="stimulus-channel-guide">
          <ChannelGuideTitle>
            {`${stimulusKindLabel(selectedBaseline)} ${
              selectedBaseline === "audio" ? "require" : "requires"
            } ${formatChannelRequirement(channelAccess.requiredChannelLabels, channelAccess.mode)}.`}
          </ChannelGuideTitle>
          <ChannelGuideCopy>
            {!channelAccess.available
              ? "No valid channel prerequisite metadata is configured for this flow."
              : tunedFrequencyHz === null
                ? "No tuned RF frequency is available yet."
                : `The current tune at ${formatFrequency(tunedFrequencyHz)} is outside the required channel range.`}{" "}
            {demodSourceMode === "live"
              ? "Choose a channel below to tune the receiver."
              : "Switch to a live source to tune the receiver."}
          </ChannelGuideCopy>
          {demodSourceMode === "live" && (
            <Channels
              variant="demod"
              hideTitle
              channelLabels={channelAccess.requiredChannelLabels}
              channelPickerOnly
              channelPickerDisabled={isBusy}
            />
          )}
        </ChannelGuide>
      )}

      {selectedBaseline === "vision" && (
        <VisionDemodWorkflowFlow
          sourceReady={selectedVisionReceiver !== null}
          sourceLabel={selectedVisionReceiver}
          channelAllowed={channelAccess.allowed}
          sourceMode={sourceMode === "file" ? "replay" : "live"}
          channelRange={visionChannelRangeLabel}
          preset={visionPreset}
          captureStatus="No aligned spatial references"
        />
      )}

      {audioFlowSelected && (
        <AudioDemodWorkflowFlow
          sourceMode={sourceMode === "file" ? "replay" : "live"}
          sourceReady={sourceReady}
          replayCaptureCount={replayCaptureCount}
          tunedFrequencyHz={tunedFrequencyHz}
          channelAllowed={channelAccess.allowed}
          channelRequirement={formatChannelRequirement(
            channelAccess.requiredChannelLabels,
            channelAccess.mode,
          )}
          bandwidthKhz={bandwidthKhz}
          candidateCount={audioSurveyCandidates.length}
          surveyStatus={audioSurveyJob?.status ?? null}
          analysisState={analysisSession.state}
          referenceTarget={stimulusKindLabel(selectedBaseline)}
          selectedAlgorithm={selectedAlgorithm}
          isListening={isListening}
          audioPlaying={audioPlayback.isPlaying}
          training={audioSurveyTraining}
          neuralModelReady={audioSurveyNeuralModelReady}
          neuralBackend={audioSurveyNeuralBackend}
          onnxAvailable={audioSurveyOnnxModelAvailable}
          onnxLoading={audioSurveyOnnxLoading}
        />
      )}
    </ReadinessCard>
  );
};
