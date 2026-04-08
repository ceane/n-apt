import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Activity, Brain, Database, RefreshCw, Sparkles, Gauge } from 'lucide-react';

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

export const CoreMLNode: React.FC<CoreMLNodeProps> = ({ data }) => {
  const [status, setStatus] = useState<string>('Ready');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const endpointBase = useMemo(() => '/api/v1', []);

  const demoSample = useMemo(() => ({
    signalArea: 'A',
    label: 'target',
    data: [0.04, 0.12, 0.22, 0.31, 0.28, 0.18, 0.09, 0.02],
    frequencyMin: 0,
    frequencyMax: 1000,
    sampleRate: 3200000,
  }), []);

  const sendRequest = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${endpointBase}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
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
      const message = typeof payload === 'string' ? payload : payload?.reason || payload?.message || response.statusText;
      throw new Error(message || 'Request failed');
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
      setStatus(`${action} failed:\n${error?.message || 'Unknown error'}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleTrainSample = () => runAction('Capture Sample', () =>
    sendRequest('/training/sample', {
      method: 'POST',
      body: JSON.stringify(demoSample),
    }),
  );

  const handleTrainModel = () => runAction('Train Model', () =>
    sendRequest('/training/start', { method: 'POST' }),
  );

  const handleTrainingStatus = () => runAction('Training Status', () =>
    sendRequest('/training/status', { method: 'GET' }),
  );

  const handleClassify = () => runAction('Classify', () =>
    sendRequest('/classify', {
      method: 'POST',
      body: JSON.stringify({
        data: demoSample.data,
        signalArea: demoSample.signalArea,
        frequencyMin: demoSample.frequencyMin,
        frequencyMax: demoSample.frequencyMax,
      }),
    }),
  );

  return (
    <NodeContainer>
      <NodeTitle>
        <Brain size={16} />
        {data.label}
      </NodeTitle>
      <NodeSubtitle>{data.description ?? 'CoreML training and inference controls for the Swift service.'}</NodeSubtitle>

      <ButtonGrid>
        <ActionButton onClick={handleTrainSample} disabled={busyAction !== null}>
          <Database size={14} />
          Sample
        </ActionButton>
        <ActionButton onClick={handleTrainModel} disabled={busyAction !== null}>
          <Sparkles size={14} />
          Train
        </ActionButton>
        <ActionButton onClick={handleTrainingStatus} disabled={busyAction !== null}>
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
          {busyAction ? busyAction : 'Idle'}
        </Chip>
        <Chip>POST /api/v1/training/sample</Chip>
        <Chip>POST /api/v1/training/start</Chip>
        <Chip>GET /api/v1/training/status</Chip>
        <Chip>POST /api/v1/classify</Chip>
      </ChipRow>

      <StatusPanel>{status}</StatusPanel>
    </NodeContainer>
  );
};
