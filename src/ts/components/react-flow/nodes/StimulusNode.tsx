import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useDemod } from '@n-apt/contexts/DemodContext';
import type { AnalysisType } from '@n-apt/consts/types';

interface StimulusNodeProps {
  data: {
    label: string;
    stimulusOptions?: boolean;
    subtext?: string;
  };
}

const baselineOptions: Array<{ value: AnalysisType; label: string }> = [
  { value: 'audio', label: 'Audio (Hearing)' },
  { value: 'internal', label: 'Audio (Internal)' },
  { value: 'speech', label: 'Speech' },
  { value: 'vision', label: 'Vision' },
  { value: 'apt', label: 'APT' },
];

const MainGrid = styled.div`
  display: flex;
  flex-direction: column;
`;

export const StimulusNode: React.FC<StimulusNodeProps> = ({ data }) => {
  const { analysisSession, selectedBaseline, setSelectedBaseline, liveMode, setLiveMode, startAnalysis, clearAnalysis } = useDemod();
  const [previewMode, setPreviewMode] = useState<AnalysisType>(selectedBaseline);

  const isBusy = analysisSession.state !== 'idle' && analysisSession.state !== 'result';
  const isCapturing = analysisSession.state === 'capturing';

  const previewLabel = useMemo(() => {
    switch (previewMode) {
      case 'audio':
        return '440Hz SINE';
      case 'internal':
        return 'SYSTEM SIGNAL';
      case 'speech':
        return 'VOICE CAPTURE';
      case 'vision':
        return 'REC';
      case 'apt':
        return 'APT FRAME';
      default:
        return 'BASELINE';
    }
  }, [previewMode]);

  const handleTrigger = () => {
    setSelectedBaseline(previewMode);
    startAnalysis(previewMode, liveMode);
  };

  return (
    <MainGrid>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '220px' }}>
        <div className="node-title" style={{ marginBottom: 0 }}>{data.label}</div>

        <div style={{
          border: '1px solid #203040',
          background: '#121212',
          borderRadius: '12px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          <div style={{
            minHeight: '170px',
            border: '1px solid #24344b',
            borderRadius: '10px',
            background: 'linear-gradient(180deg, #111 0%, #171717 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, rgba(0,212,255,0.08), transparent 55%)' }} />
            <div style={{ position: 'relative', textAlign: 'center', color: '#00d4ff', fontFamily: 'monospace' }}>
              <div style={{ fontSize: '11px', opacity: 0.55, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Stimulus Preview</div>
              <div style={{ fontSize: '24px', letterSpacing: '0.2em', fontWeight: 700 }}>{isCapturing ? 'RECORD' : previewLabel}</div>
              <div style={{ fontSize: '12px', marginTop: '10px', opacity: 0.75 }}>
                {isCapturing ? 'Capturing baseline media' : 'Baseline media record'}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'end' }}>
            <div>
              <div style={{ fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6, marginBottom: '6px' }}>
                Baseline Vector
              </div>
              <select
                value={previewMode}
                onChange={(e) => setPreviewMode(e.target.value as AnalysisType)}
                disabled={isBusy}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #2c3e50',
                  background: '#0f0f0f',
                  color: '#00d4ff',
                  fontFamily: 'monospace',
                }}
              >
                {baselineOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleTrigger}
              disabled={isBusy}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #00d4ff',
                background: isBusy ? '#202020' : '#0f2026',
                color: isBusy ? '#666' : '#00d4ff',
                fontWeight: 700,
                cursor: isBusy ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
              }}
            >
              TRIGGER
            </button>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: '#888', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={liveMode}
              onChange={(e) => setLiveMode(e.target.checked)}
              disabled={isBusy}
            />
            LIVE CAPTURE (EPHEMERAL)
          </label>

          <div style={{
            fontSize: '10px',
            lineHeight: 1.5,
            opacity: 0.75,
            textAlign: 'center',
            padding: '0 8px',
            fontStyle: 'italic',
            wordWrap: 'break-word',
          }}>
            {data.subtext || 'Capture N-APT signals with a known baseline for demod later. Media is played while recording in order to learn what is where.'}
          </div>

          {analysisSession.state === 'result' && (
            <button
              onClick={clearAnalysis}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #2a2a2a',
                background: '#111',
                color: '#ddd',
                fontFamily: 'monospace',
                cursor: 'pointer',
              }}
            >
              Reset Session
            </button>
          )}
        </div>
      </div>
    </MainGrid>
  );
};
