import React from "react";
import styled from "styled-components";
import { Brain } from "lucide-react";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { useAppSelector } from "@n-apt/redux";
import { formatFrequency } from "@n-apt/math/frequency";
import {
  buildSafeDownloadUrl,
  safeDownloadFilename,
} from "@n-apt/ui/downloadUrl";
import { INITIAL_SPECTRUM_FREQUENCY_RANGE } from "@n-apt/webusb/initialSpectrumFrequencyRange";

const NodeWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  min-width: 240px;
  text-align: left;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const IconWrap = styled.div`
  padding: 6px;
  background: ${({ theme }) => theme.colors.primary}22;
  border-radius: 6px;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Title = styled.span`
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const VectorBadge = styled.span`
  font-size: 9px;
  background: ${({ theme }) => theme.colors.primary}22;
  color: ${({ theme }) => theme.colors.primary};
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  font-weight: 700;
`;

const JobId = styled.div`
  font-size: 9px;
  opacity: 0.45;
  font-family: ${({ theme }) => theme.typography.mono};
  margin-top: 1px;
`;

const Metrics = styled.div`
  background: ${({ theme }) => theme.colors.surface}55;
  border: 1px solid ${({ theme }) => theme.colors.border}0e;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
`;

const DownloadButton = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.primary};
  text-decoration: none;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: transparent;
  cursor: pointer;
  font-family: inherit;

  &:hover {
    background: ${({ theme }) => theme.colors.primary}18;
  }
`;

const OutputActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.primary};
  text-decoration: none;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: transparent;
  cursor: pointer;
  font-family: inherit;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.primary}18;
  }

  &:disabled {
    cursor: wait;
    opacity: 0.6;
  }
`;

const MetadataList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 10px;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const MetadataRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 10px;
`;

const MetadataLabel = styled.span`
  opacity: 0.55;
`;

const MetadataValue = styled.span`
  text-align: right;
  word-break: break-word;
`;

interface OutputNodeProps {
  data: {
    label?: string;
    vector?: string;
    outputDestination?: "local" | "huggingface";
    naptFilePath?: string;
    result: {
      jobId: string;
      confidence: number;
      timestamp?: string | number;
      summary?: string;
      fileName?: string;
      isEphemeral?: boolean;
      naptFilePath?: string;
      fileSize?: number;
      sampleRateHz?: number;
      centerFrequencyHz?: number;
      matchRate?: number;
      snrDelta?: string;
    };
  };
}

export const OutputNode: React.FC<OutputNodeProps> = ({ data }) => {
  const { sessionToken } = useAuthentication();
  const [saveStatus, setSaveStatus] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const storeSampleRateHz = useAppSelector(
    (state) => state.spectrum.sampleRateHz,
  );
  const storeFrequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const { result, state } = data as any; // Using any for additional fields like state
  const hasLiveSampleRate =
    typeof storeSampleRateHz === "number" &&
    Number.isFinite(storeSampleRateHz) &&
    storeSampleRateHz > 0 &&
    storeSampleRateHz !== 3_200_000;
  const hasLiveFrequencyRange =
    storeFrequencyRange &&
    Number.isFinite(storeFrequencyRange.min) &&
    Number.isFinite(storeFrequencyRange.max) &&
    (storeFrequencyRange.min !== INITIAL_SPECTRUM_FREQUENCY_RANGE.min ||
      storeFrequencyRange.max !== INITIAL_SPECTRUM_FREQUENCY_RANGE.max);
  const sampleRateHz = hasLiveSampleRate
    ? storeSampleRateHz
    : result?.sampleRateHz;
  const centerFrequencyHz =
    hasLiveFrequencyRange && storeFrequencyRange.max > storeFrequencyRange.min
      ? (storeFrequencyRange.min + storeFrequencyRange.max) / 2
      : result?.centerFrequencyHz;
  const naptFilePath = data.naptFilePath || result?.naptFilePath;
  const outputDestination = data.outputDestination ?? "local";
  const downloadHref = React.useMemo(() => {
    return buildSafeDownloadUrl(naptFilePath, sessionToken);
  }, [naptFilePath, sessionToken]);

  const isProcessing = state && state !== "idle" && state !== "result";
  const isAwaiting = state === "idle";

  const saveToHuggingFace = async () => {
    if (!sessionToken || result?.isEphemeral) return;
    setIsSaving(true);
    setSaveStatus("");
    try {
      const query = new URLSearchParams({
        token: sessionToken,
        jobId: result.jobId,
        section: "demod",
      });
      const response = await fetch(
        `/api/capture/save/huggingface?${query.toString()}`,
        { method: "POST" },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        files?: string[];
      };
      if (!response.ok) {
        throw new Error(
          body.error || `Hugging Face save failed: HTTP ${response.status}`,
        );
      }
      setSaveStatus(
        `Saved encrypted ${body.files?.join(", ") || result.fileName || "capture"} to Hugging Face.`,
      );
    } catch (error) {
      setSaveStatus(
        error instanceof Error ? error.message : "Could not save capture.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!result || isProcessing || isAwaiting) {
    return (
      <NodeWrapper style={{ alignItems: "center", minWidth: "180px" }}>
        <Header style={{ width: "100%", justifyContent: "center" }}>
          <TitleRow>
            <Title>Output</Title>
          </TitleRow>
        </Header>
        <Metrics style={{ width: "100%", textAlign: "center" }}>
          {isProcessing ? (
            <div
              style={{
                fontSize: "10px",
                color: "#ffaa00",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                justifyContent: "center",
              }}
            >
              <span>⚡ Processing… ({state})</span>
            </div>
          ) : (
            <div style={{ fontSize: "10px", opacity: 0.4 }}>
              Awaiting analysis results
            </div>
          )}
        </Metrics>
      </NodeWrapper>
    );
  }

  return (
    <NodeWrapper>
      <Header>
        <IconWrap>
          <Brain size={16} color="currentColor" />
        </IconWrap>
        <div style={{ flex: 1 }}>
          <TitleRow>
            <Title>Output</Title>
            {data.vector && <VectorBadge>{data.vector}</VectorBadge>}
          </TitleRow>
          <JobId>{result.jobId}</JobId>
        </div>
      </Header>

      {(result.timestamp ||
        result.duration ||
        result.fileSize !== undefined ||
        sampleRateHz !== undefined ||
        centerFrequencyHz !== undefined ||
        result.fileName ||
        result.summary) && (
        <MetadataList>
          <MetadataRow>
            <MetadataLabel>Destination</MetadataLabel>
            <MetadataValue>
              {result.isEphemeral
                ? "Ephemeral (discarded)"
                : outputDestination === "huggingface"
                  ? "Hugging Face dataset"
                  : "Local Downloads"}
            </MetadataValue>
          </MetadataRow>

          {result.fileName && (
            <MetadataRow>
              <MetadataLabel>File</MetadataLabel>
              <MetadataValue>{result.fileName}</MetadataValue>
            </MetadataRow>
          )}

          {result.timestamp && (
            <MetadataRow>
              <MetadataLabel>Timestamp</MetadataLabel>
              <MetadataValue>
                {typeof result.timestamp === "number"
                  ? new Date(result.timestamp).toLocaleString()
                  : result.timestamp}
              </MetadataValue>
            </MetadataRow>
          )}

          {result.duration && (
            <MetadataRow>
              <MetadataLabel>Duration</MetadataLabel>
              <MetadataValue>
                {typeof result.duration === "number"
                  ? `${(result.duration / 1000).toFixed(1)}s`
                  : result.duration}
              </MetadataValue>
            </MetadataRow>
          )}

          {result.fileSize !== undefined && (
            <MetadataRow>
              <MetadataLabel>File size</MetadataLabel>
              <MetadataValue>
                {result.fileSize < 1024 * 100
                  ? `${(result.fileSize / 1024).toFixed(1)} KB`
                  : `${(result.fileSize / (1024 * 1024)).toFixed(2)} MB`}
              </MetadataValue>
            </MetadataRow>
          )}

          {sampleRateHz !== undefined && (
            <MetadataRow>
              <MetadataLabel>Sample Rate</MetadataLabel>
              <MetadataValue>{formatFrequency(sampleRateHz)}</MetadataValue>
            </MetadataRow>
          )}

          {centerFrequencyHz !== undefined && (
            <MetadataRow>
              <MetadataLabel>Center Frequency</MetadataLabel>
              <MetadataValue>
                {formatFrequency(centerFrequencyHz)}
              </MetadataValue>
            </MetadataRow>
          )}

          {result.summary && (
            <MetadataRow>
              <MetadataLabel>Summary</MetadataLabel>
              <MetadataValue>{result.summary}</MetadataValue>
            </MetadataRow>
          )}
        </MetadataList>
      )}

      {outputDestination === "huggingface" && !result.isEphemeral ? (
        <>
          <OutputActionButton
            type="button"
            className="nodrag nopan"
            disabled={isSaving || !sessionToken}
            onClick={(event) => {
              event.stopPropagation();
              void saveToHuggingFace();
            }}
          >
            {isSaving ? "Saving…" : "Save encrypted to Hugging Face"}
          </OutputActionButton>
          {saveStatus && (
            <div role="status" style={{ fontSize: 10 }}>
              {saveStatus}
            </div>
          )}
        </>
      ) : outputDestination === "local" && downloadHref ? (
        <DownloadButton
          href={downloadHref}
          download={safeDownloadFilename(result.fileName)}
          className="nodrag nopan"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          Download .napt
        </DownloadButton>
      ) : (
        <div style={{ fontSize: 10, opacity: 0.65 }}>
          {result.isEphemeral
            ? "Ephemeral capture was discarded and cannot be exported."
            : "No downloadable capture artifact is available."}
        </div>
      )}
    </NodeWrapper>
  );
};
