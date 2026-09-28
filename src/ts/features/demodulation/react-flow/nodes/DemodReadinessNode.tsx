import React from "react";
import styled from "styled-components";
import { AlertTriangle, Check, RadioTower } from "lucide-react";
import { useAppSelector } from "@n-apt/redux";
import { Channels } from "@n-apt/spectrum";
import { formatFrequency } from "@n-apt/math/frequency";
import { useDemod } from "@n-apt/demodulation/context/DemodContext";
import { evaluateStimulusChannelAccess } from "@n-apt/demodulation/react-flow/nodes/stimulusChannelPolicy";

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
  align-items: center;
  gap: 7px;
  margin-bottom: 6px;
  font-weight: 700;
`;

const ReasonList = styled.ul`
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  color: ${({ theme }) => theme.colors.textSecondary};
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

const formatChannelRequirement = (labels: string[]) => {
  if (labels.length === 2 && labels[0] === "A" && labels[1] === "B") {
    return "Channel A or B";
  }
  if (labels.length === 1) return `Channel ${labels[0]}`;
  return labels.map((label) => `Channel ${label}`).join(" or ");
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
  const { analysisSession, demodQualityStatus, selectedBaseline } = useDemod();
  const demodSourceMode = useAppSelector(
    (state) => state.demod.sourceMode,
  );
  const centerFrequencyHz = useAppSelector((state) =>
    state.demod.bandwidthCenterFreqHz ?? state.demod.centerFreqHz,
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
          <ReadinessTitle>{data.label ?? "Demodulation Readiness"}</ReadinessTitle>
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
          </StatusHeading>
          {hasQualityWarning && (
            <ReasonList>
              {demodQualityStatus.reasons.map((reason, index) => (
                <li key={`${reason}-${index}`}>{reason}</li>
              ))}
            </ReasonList>
          )}
        </StatusPanel>
      ) : (
        <StatusPanel role="status" $warning={false}>
          Waiting for the signal configuration check.
        </StatusPanel>
      )}

      {selectedBaseline === "audio" && channelAccess.allowed && (
        <PairingGuide role="note">
          To save a paired ML example, enable “Pair stimulus tone with captured
          RF audio” in the Stimulus node before starting the reference capture.
        </PairingGuide>
      )}

      {hasChannelWarning && (
        <ChannelGuide data-testid="stimulus-channel-guide">
          <ChannelGuideTitle>
            {`${stimulusKindLabel(selectedBaseline)} ${
              selectedBaseline === "audio" ? "require" : "requires"
            } ${formatChannelRequirement(channelAccess.requiredChannelLabels)}.`}
          </ChannelGuideTitle>
          <ChannelGuideCopy>
            {tunedFrequencyHz === null
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
    </ReadinessCard>
  );
};
