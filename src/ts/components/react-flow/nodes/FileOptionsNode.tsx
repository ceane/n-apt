import React from 'react';
import styled from 'styled-components';

const NodeWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  min-width: 220px;
  text-align: left;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
`;

const IconWrap = styled.div`
  padding: 6px;
  background: ${({ theme }) => theme.colors.success}22;
  border-radius: 4px;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Title = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.success};
`;

const Badge = styled.div`
  font-size: 8px;
  background: ${({ theme }) => theme.colors.success}22;
  color: ${({ theme }) => theme.colors.success};
  padding: 2px 4px;
  border-radius: 3px;
  text-transform: uppercase;
  font-weight: 700;
`;

const JobId = styled.div`
  font-size: 9px;
  opacity: 0.6;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const SummaryBox = styled.div`
  background: ${({ theme }) => theme.colors.surface}44;
  border: 1px solid ${({ theme }) => theme.colors.border}11;
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SummaryLine = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const Label = styled.div`
  opacity: 0.6;
`;

const Value = styled.div`
  color: ${({ theme }) => theme.colors.success};
  font-weight: 700;
`;

interface FileOptionsNodeProps {
  data: {
    label: string;
    vector?: string;
    result: {
      jobId: string;
      timestamp?: string;
      summary?: string;
      fileName?: string;
    };
  };
}

export const FileOptionsNode: React.FC<FileOptionsNodeProps> = ({ data }) => {
  const { result } = data;

  return (
    <NodeWrapper>
      <Header>
        <IconWrap />
        <div>
          <TitleRow>
            <Title>REFERENCE CAPTURE</Title>
            <Badge>{data.vector || 'RAW'}</Badge>
          </TitleRow>
          <JobId>{result.jobId}</JobId>
        </div>
      </Header>

      <SummaryBox>
        <SummaryLine>
          <Label>File</Label>
          <Value>{result.fileName || 'Unknown'}</Value>
        </SummaryLine>
        <SummaryLine>
          <Label>Timestamp</Label>
          <Value>{result.timestamp || '—'}</Value>
        </SummaryLine>
        <SummaryLine>
          <Label>Summary</Label>
          <Value>{result.summary || 'Captured reference'}</Value>
        </SummaryLine>
      </SummaryBox>
    </NodeWrapper>
  );
};
