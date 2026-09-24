import React, { useMemo, useState } from "react";
import styled from "styled-components";
import {
  Activity,
  Brain,
  Database,
  RefreshCw,
  Sparkles,
  Gauge,
  Pause,
  Play,
  Radio,
  Square,
} from "lucide-react";
import { useDemod } from "@n-apt/demodulation/context/DemodContext";
import {
  AUDIO_SURVEY_STORAGE_CAP_BYTES,
  AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES,
  type AudioSurveySourceMode,
} from "@n-apt/demodulation/survey/audioSurveyModel";

interface CoreMLNodeProps {
  data: {
    coremlOptions: boolean;
    label: string;
    description?: string;
  };
}

const NodeContainer = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  padding: ${({ theme }) => theme.spacing.lg};
  min-width: 320px;
  max-width: 420px;
`;

const NodeTitle = styled.div`
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const NodeSubtitle = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ButtonGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const ActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  padding: 10px 12px;
  background: ${({ theme }) => theme.colors.surfaceHover};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
    color: ${({ theme }) => theme.colors.primary};
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.65;
    transform: none;
  }
`;

const StatusPanel = styled.div`
  margin-top: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: rgba(0, 0, 0, 0.08);
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
`;

const SurveySection = styled.section`
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const SurveyHeading = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 6px;
`;

const SurveyInfo = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  line-height: 1.45;
  margin: 4px 0 10px;
`;

const SurveySelect = styled.select`
  width: 100%;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 7px 8px;
  margin-bottom: 8px;
  background: ${({ theme }) => theme.colors.surfaceHover};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
`;

const CandidateList = styled.div`
  display: grid;
  gap: 6px;
  max-height: 190px;
  overflow: auto;
  margin-top: 8px;
`;

const CandidateItem = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 7px 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
`;

const CandidateName = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 10px;
  margin-bottom: 2px;
`;

const CompactButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 7px;
  padding: 6px 8px;
  background: ${({ theme }) => theme.colors.surfaceHover};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;

  &:disabled { cursor: not-allowed; opacity: 0.55; }
`;

const formatHz = (frequencyHz: number) =>
  frequencyHz >= 1_000_000
    ? `${(frequencyHz / 1_000_000).toFixed(3)} MHz`
    : `${(frequencyHz / 1_000).toFixed(1)} kHz`;

const formatBytes = (bytes: number) =>
  bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(2)} GB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;

const formatHours = (milliseconds: number) =>
  `${(milliseconds / 3_600_000).toFixed(1)} h`;

export const CoreMLNode: React.FC<CoreMLNodeProps> = ({ data }) => {
  const [status, setStatus] = useState<string>("Ready");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [surveySourceMode, setSurveySourceMode] =
    useState<AudioSurveySourceMode>("combined");
  const [surveyStorageCapBytes, setSurveyStorageCapBytes] =
    useState(AUDIO_SURVEY_STORAGE_CAP_BYTES);
  const [surveyBusy, setSurveyBusy] = useState(false);
  const {
    audioSurveyJob,
    audioSurveyCandidates,
    audioSurveyStorageUsage,
    audioSurveyTraining,
    audioSurveyError,
    startAudioSurvey,
    resumeAudioSurvey,
    pauseAudioSurvey,
    stopAudioSurvey,
    trainAudioSurveyModel,
    pauseAudioSurveyTraining,
    playAudioSurveyCandidate,
  } = useDemod();

  const endpointBase = useMemo(() => "/api/v1", []);

  const demoSample = useMemo(
    () => ({
      signalArea: "A",
      label: "target",
      data: [0.04, 0.12, 0.22, 0.31, 0.28, 0.18, 0.09, 0.02],
      frequencyMin: 0,
      frequencyMax: 1000,
      sampleRate: 3_200_000,
    }),
    [],
  );

  const sendRequest = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${endpointBase}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      ...init,
    });

    const text = await response.text();
    let payload: any = text;

    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      // keep plain text
    }

    if (!response.ok) {
      const message =
        typeof payload === "string"
          ? payload
          : payload?.reason || payload?.message || response.statusText;
      throw new Error(message || "Request failed");
    }

    return payload;
  };

  const runAction = async (action: string, request: () => Promise<any>) => {
    setBusyAction(action);
    setStatus(`Running ${action}...`);

    try {
      const result = await request();
      setStatus(`${action} complete:\n${JSON.stringify(result, null, 2)}`);
    } catch (error: any) {
      setStatus(`${action} failed:\n${error?.message || "Unknown error"}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleTrainSample = () =>
    runAction("Capture Sample", () =>
      sendRequest("/training/sample", {
        method: "POST",
        body: JSON.stringify(demoSample),
      }),
    );

  const handleTrainModel = () =>
    runAction("Train Model", () =>
      sendRequest("/training/start", { method: "POST" }),
    );

  const handleTrainingStatus = () =>
    runAction("Training Status", () =>
      sendRequest("/training/status", { method: "GET" }),
    );

  const handleClassify = () =>
    runAction("Classify", () =>
      sendRequest("/classify", {
        method: "POST",
        body: JSON.stringify({
          data: demoSample.data,
          signalArea: demoSample.signalArea,
          frequencyMin: demoSample.frequencyMin,
          frequencyMax: demoSample.frequencyMax,
        }),
      }),
    );

  const runSurveyAction = async (action: () => Promise<void>) => {
    setSurveyBusy(true);
    try {
      await action();
    } finally {
      setSurveyBusy(false);
    }
  };

  const surveyRunning = audioSurveyJob?.status === "running";
  const surveyPaused = audioSurveyJob?.status === "paused";
  const trainingRunning = audioSurveyTraining?.status === "running";

  return (
    <NodeContainer>
      <NodeTitle>
        <Brain size={16} />
        {data.label}
      </NodeTitle>
      <NodeSubtitle>
        {data.description ??
          "Local A/B RF survey and resumable machine-learning demodulation. CoreML export can be added as an optional deployment backend."}
      </NodeSubtitle>

      <ButtonGrid>
        <ActionButton
          onClick={handleTrainSample}
          disabled={busyAction !== null}
        >
          <Database size={14} />
          Sample
        </ActionButton>
        <ActionButton onClick={handleTrainModel} disabled={busyAction !== null}>
          <Sparkles size={14} />
          Train
        </ActionButton>
        <ActionButton
          onClick={handleTrainingStatus}
          disabled={busyAction !== null}
        >
          <Gauge size={14} />
          Status
        </ActionButton>
        <ActionButton onClick={handleClassify} disabled={busyAction !== null}>
          <Activity size={14} />
          Classify
        </ActionButton>
      </ButtonGrid>

      <ChipRow>
        <Chip>
          <RefreshCw size={10} />
          {busyAction ? busyAction : "Idle"}
        </Chip>
        <Chip>POST /api/v1/training/sample</Chip>
        <Chip>POST /api/v1/training/start</Chip>
        <Chip>GET /api/v1/training/status</Chip>
        <Chip>POST /api/v1/classify</Chip>
      </ChipRow>

      <StatusPanel>{status}</StatusPanel>
      <SurveySection aria-label="Local ML audio demodulation survey">
        <SurveyHeading>
          <Radio size={14} />
          Local ML audio demodulation
        </SurveyHeading>
        <SurveyInfo>
          Survey Channels A and B in independent 3.2 MS/s views. Replay runs first when captures are selected, then live RF. Narrowband clips stay local; full-band I/Q is discarded.
        </SurveyInfo>
        <SurveySelect
          aria-label="Audio survey source"
          value={surveySourceMode}
          onChange={(event) =>
            setSurveySourceMode(event.target.value as AudioSurveySourceMode)
          }
          disabled={surveyRunning || surveyBusy}
        >
          <option value="combined">Replay, then live</option>
          <option value="replay">Selected replay captures</option>
          <option value="live">Live RTL-SDR</option>
        </SurveySelect>
        <SurveySelect
          aria-label="Audio survey storage cap"
          value={surveyStorageCapBytes}
          onChange={(event) => setSurveyStorageCapBytes(Number(event.target.value))}
          disabled={surveyRunning || surveyBusy}
        >
          <option value={128_000_000}>128 MB local storage cap</option>
          <option value={AUDIO_SURVEY_STORAGE_CAP_BYTES}>256 MB local storage cap</option>
          <option value={512_000_000}>512 MB local storage cap</option>
          <option value={AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES}>1 GB local storage cap</option>
        </SurveySelect>
        <ButtonGrid>
          {!surveyRunning && !surveyPaused ? (
            <ActionButton
              onClick={() =>
                void runSurveyAction(() =>
                  startAudioSurvey(surveySourceMode, surveyStorageCapBytes),
                )
              }
              disabled={surveyBusy}
            >
              <Play size={13} /> Start survey
            </ActionButton>
          ) : surveyRunning ? (
            <ActionButton onClick={pauseAudioSurvey} disabled={surveyBusy}>
              <Pause size={13} /> Pause at view boundary
            </ActionButton>
          ) : (
            <ActionButton
              onClick={() => void runSurveyAction(resumeAudioSurvey)}
              disabled={surveyBusy}
            >
              <Play size={13} /> Resume survey
            </ActionButton>
          )}
          <ActionButton
            onClick={stopAudioSurvey}
            disabled={(!surveyRunning && !surveyPaused) || surveyBusy}
          >
            <Square size={13} /> Stop
          </ActionButton>
          {!trainingRunning ? (
            <ActionButton
              onClick={() => void runSurveyAction(trainAudioSurveyModel)}
              disabled={surveyBusy || !audioSurveyJob}
              title="Trains only from timestamp-aligned stimulus pairs"
            >
              <Brain size={13} /> Train / resume ML
            </ActionButton>
          ) : (
            <ActionButton onClick={pauseAudioSurveyTraining} disabled={surveyBusy}>
              <Pause size={13} /> Pause training
            </ActionButton>
          )}
        </ButtonGrid>
        <SurveyInfo>
          Survey: {audioSurveyJob?.status ?? "ready"} · pass {audioSurveyJob?.checkpoint.passIndex ?? 0} · view {(audioSurveyJob?.checkpoint.viewIndex ?? 0) + 1}/4
          <br />
          Today: {formatHours(audioSurveyJob?.checkpoint.elapsedMsToday ?? 0)} / {formatHours(audioSurveyJob?.config.dailyBudgetMs ?? 8 * 60 * 60 * 1000)}
          <br />
          Storage: {formatBytes(audioSurveyStorageUsage.usedBytes)} / {formatBytes(audioSurveyStorageUsage.capBytes)} · {audioSurveyStorageUsage.artifactCount} artifacts
          {audioSurveyTraining && (
            <>
              <br />
              Training: {audioSurveyTraining.status}, epoch {audioSurveyTraining.epoch}/{audioSurveyTraining.totalEpochs}
              {audioSurveyTraining.modelPreferred === true && " · beats DSP baseline"}
              {audioSurveyTraining.modelPreferred === false && audioSurveyTraining.status === "completed" && " · DSP remains preferred"}
            </>
          )}
          {audioSurveyError && <><br />{audioSurveyError}</>}
        </SurveyInfo>
        <CandidateList aria-label="Audio candidates">
          {audioSurveyCandidates.slice(0, 8).map((candidate) => (
            <CandidateItem key={candidate.id}>
              <div>
                <CandidateName>
                  {candidate.channelId.toUpperCase()} · {formatHz(candidate.centerHz)}
                </CandidateName>
                {candidate.modulation.toUpperCase()} · {formatHz(candidate.bandwidthHz)} wide · score {candidate.score.toFixed(2)}
                {candidate.demodulationModelPreferred && " · ML preferred"}
              </div>
              <CompactButton
                onClick={() => {
                  void playAudioSurveyCandidate(candidate.id);
                }}
                disabled={candidate.clipArtifactIds.length === 0}
                aria-label={`Play ${formatHz(candidate.centerHz)} candidate`}
              >
                <Play size={11} /> Listen
              </CompactButton>
            </CandidateItem>
          ))}
        </CandidateList>
        {audioSurveyCandidates.length === 0 && (
          <SurveyInfo>No candidates recorded yet. Start a survey to build the map.</SurveyInfo>
        )}
      </SurveySection>
    </NodeContainer>
  );
};
