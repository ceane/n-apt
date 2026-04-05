import React, { useState, useEffect } from 'react';
import { useSpectrumStore } from '@n-apt/hooks/useSpectrumStore';
import { useAppSelector } from '@n-apt/redux';
import { formatFrequency } from '@n-apt/utils/frequency';

interface SymbolsTableProps {
  frequencyRange: { min: number; max: number } | null;
}

export const SymbolsTable: React.FC<SymbolsTableProps> = ({ frequencyRange }) => {
  const { wsConnection } = useSpectrumStore();
  const [isLive, setIsLive] = useState(false);
  const [liveData, setLiveData] = useState(() => Array(4).fill(null).map(() => ({
    symbols: '',
    confidence: 0,
    timestamp: Date.now(),
    key: 'symbols'
  })));

  const deviceName = wsConnection.deviceName || useAppSelector((s) => s.websocket.deviceName) || "SDR Device";

  // Simplified WebSocket handling without API calls
  useEffect(() => {
    if (!wsConnection || !isLive) return;

    // Mock data for now - replace with actual WebSocket integration
    const mockInterval = setInterval(() => {
      setLiveData(prev => {
        const newData = [...prev.slice(1), {
          symbols: Math.random() > 0.5 ? 'I' : 'Q',
          confidence: Math.random() * 0.3 + 0.7,
          timestamp: Date.now(),
          key: 'symbols'
        }];
        return newData;
      });
    }, 1000);

    return () => clearInterval(mockInterval);
  }, [wsConnection, isLive]);

  return (
    <div style={{
      background: '#0a0a0a',
      border: '1px solid #1f1f1f',
      borderRadius: '8px',
      overflow: 'hidden',
      fontSize: '11px',
      fontFamily: 'var(--font-mono, monospace)',
      width: '100%',
      contain: 'layout paint'
    }}>
      <div style={{
        padding: '12px',
        background: '#1a1a1a',
        borderBottom: '1px solid #1f1f1f',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ fontWeight: 600, color: '#fff' }}>
          🧮 Symbol Analysis
        </div>
        <button
          onClick={() => setIsLive(!isLive)}
          style={{
            padding: '4px 8px',
            background: isLive ? '#00ff88' : '#666',
            border: 'none',
            borderRadius: '4px',
            color: '#000',
            fontSize: '10px',
            cursor: 'pointer'
          }}
        >
          {isLive ? 'LIVE' : 'PAUSED'}
        </button>
      </div>

      <div style={{ padding: '12px' }}>
        <div style={{ marginBottom: '12px', fontSize: '10px', opacity: 0.7 }}>
          {deviceName} • {frequencyRange ? `${formatFrequency(frequencyRange.min)}-${formatFrequency(frequencyRange.max)}` : 'No range'}
        </div>

        {liveData.map((row, index) => (
          <div key={index} style={{
            display: 'grid',
            gridTemplateColumns: '60px 1fr 80px',
            gap: '8px',
            padding: '6px 0',
            borderBottom: index < liveData.length - 1 ? '1px solid #1f1f1f' : 'none',
            opacity: 1 - (index * 0.2),
            transition: 'opacity 0.3s ease'
          }}>
            <div style={{ color: '#888', fontSize: '9px' }}>
              {new Date(row.timestamp).toLocaleTimeString()}
            </div>
            <div style={{
              color: row.confidence > 0.8 ? '#00ff88' : row.confidence > 0.5 ? '#ffaa00' : '#ff4444',
              fontSize: '13px',
              fontWeight: index === 0 ? 700 : 400,
              opacity: index === 0 ? 1 : 0.8,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis'
            }}>
              {row.key === 'iq' ? (
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                  <span>I</span>
                  <span>Q</span>
                </div>
              ) : row.symbols}
            </div>
            <div style={{
              color: row.confidence > 0.8 ? '#00ff88' : row.confidence > 0.5 ? '#ffaa00' : '#ff4444',
              fontSize: '9px',
              textAlign: 'right'
            }}>
              {(row.confidence * 100).toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
