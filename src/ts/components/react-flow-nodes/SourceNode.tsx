import React from 'react';
import { useSpectrumStore } from '@n-apt/hooks/useSpectrumStore';

interface SourceNodeProps {
  data: {
    sourceNode: boolean;
    label: string;
  };
}

export const SourceNode: React.FC<SourceNodeProps> = ({ data }) => {
  const { deviceName } = useSpectrumStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '180px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          padding: '8px',
          background: '#00d4ff1a',
          borderRadius: '8px',
          border: '1px solid #00d4ff33',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <span style={{ fontSize: '20px' }}>📡</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#00d4ff',
            opacity: 0.9
          }}>
            Source
          </div>
          <div style={{
            fontSize: '13px',
            fontWeight: 500,
            color: '#fff',
            fontFamily: 'var(--font-mono, monospace)',
            letterSpacing: '-0.02em'
          }}>
            {deviceName || data?.label || 'SDR Device'}
          </div>
        </div>
      </div>
    </div>
  );
};