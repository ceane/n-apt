import React from 'react';
import styled from 'styled-components';
import { Brain } from 'lucide-react';
import { useAuthentication } from '@n-apt/hooks/useAuthentication';

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

const DownloadButton = styled.button`
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

const MetricRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
`;

const MetricLabel = styled.span`
  opacity: 0.55;
`;

const MetricValue = styled.span`
  color: ${({ theme }) => theme.colors.success};
  font-weight: 700;
  font-family: ${({ theme }) => theme.typography.mono};
`;

interface OutputNodeProps {
  data: {
    label?: string;
    vector?: string;
    naptFilePath?: string;
    result: {
      jobId: string;
      confidence: number;
      timestamp?: string | number;
      summary?: string;
      fileName?: string;
      naptFilePath?: string;
      fileSize?: number;
      matchRate?: number;
      snrDelta?: string;
    };
  };
}

export const OutputNode: React.FC<OutputNodeProps> = ({ data }) => {
  const { sessionToken } = useAuthentication();
  const { result, state } = data as any; // Using any for additional fields like state
  const naptFilePath = data.naptFilePath || result?.naptFilePath;
  const downloadHref = React.useMemo(() => {
    if (!naptFilePath) return undefined;
    let urlStr = naptFilePath;
    try {
      urlStr = new URL(naptFilePath, window.location.origin).toString();
    } catch {
      // Ignored
    }
    if (sessionToken) {
      if (urlStr.includes('?')) {
        urlStr += `&token=${encodeURIComponent(sessionToken)}`;
      } else {
        urlStr += `?token=${encodeURIComponent(sessionToken)}`;
      }
    }
    return urlStr;
  }, [naptFilePath, sessionToken]);

  if (!result) {
    const isProcessing = state && state !== 'idle' && state !== 'result';

    return (
      <NodeWrapper style={{ alignItems: 'center', minWidth: '180px' }}>
        <Header style={{ width: '100%', justifyContent: 'center' }}>
          <TitleRow>
            <Title>Output</Title>
          </TitleRow>
        </Header>
        <Metrics style={{ width: '100%', textAlign: 'center' }}>
          {isProcessing ? (
            <div style={{ fontSize: '10px', color: '#ffaa00', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
              <span>⚡ Processing... ({state})</span>
            </div>
          ) : (
            <div style={{ fontSize: '10px', opacity: 0.4 }}>Awaiting analysis results</div>
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

      <Metrics>
        <MetricRow>
          <MetricLabel>Confidence</MetricLabel>
          <MetricValue>{(result.confidence * 100).toFixed(1)}%</MetricValue>
        </MetricRow>
        {result.matchRate !== undefined && (
          <MetricRow>
            <MetricLabel>Match rate</MetricLabel>
            <MetricValue>{(result.matchRate * 100).toFixed(1)}%</MetricValue>
          </MetricRow>
        )}
        {result.snrDelta && (
          <MetricRow>
            <MetricLabel>SNR Δ</MetricLabel>
            <MetricValue>{result.snrDelta}</MetricValue>
          </MetricRow>
        )}
      </Metrics>

      {(result.timestamp || result.duration || result.fileSize !== undefined || result.summary) && (
        <MetadataList>
          {result.timestamp && (
            <MetadataRow>
              <MetadataLabel>Timestamp</MetadataLabel>
              <MetadataValue>
                {typeof result.timestamp === 'number'
                  ? new Date(result.timestamp).toLocaleString()
                  : result.timestamp}
              </MetadataValue>
            </MetadataRow>
          )}

          {result.duration && (
            <MetadataRow>
              <MetadataLabel>Duration</MetadataLabel>
              <MetadataValue>
                {typeof result.duration === 'number'
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

          {result.summary && (
            <MetadataRow>
              <MetadataLabel>Summary</MetadataLabel>
              <MetadataValue>{result.summary}</MetadataValue>
            </MetadataRow>
          )}
        </MetadataList>
      )}

      {downloadHref && (
        <DownloadButton
          className="nodrag nopan"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            window.open(downloadHref, '_blank', 'noopener,noreferrer');
          }}
        >
          Download .napt
        </DownloadButton>
      )}
    </NodeWrapper>
  );
};
