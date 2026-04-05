import React, { useState, useEffect } from 'react';
import { useSpectrumStore } from '@n-apt/hooks/useSpectrumStore';
import { useAppSelector } from '@n-apt/redux';
import { formatFrequency } from '@n-apt/utils/frequency';
import { Brain, Clock } from 'lucide-react';

interface SymbolAnalysisNodeProps {
  data: {
    symbolsOptions: boolean;
    label: string;
    frequencyRange?: { min: number; max: number };
  };
}

export const SymbolAnalysisNode: React.FC<SymbolAnalysisNodeProps> = ({ data }) => {
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

  const freqRange = data.frequencyRange || { min: 0, max: 3000 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '300px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <div style={{ padding: '6px', background: '#ff6b6b22', borderRadius: '4px' }}>
          <Brain size={16} color="#ff6b6b" />
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#ff6b6b' }}>SYMBOLS (I/Q)</div>
          <div style={{ fontSize: '9px', opacity: 0.6, fontFamily: 'monospace' }}>Modulation Symbols</div>
        </div>
      </div>

      <div style={{
        background: '#0a0a0a',
        border: '1px solid #1f1f1f',
        borderRadius: '8px',
        overflow: 'hidden',
        fontSize: '11px',
        fontFamily: 'var(--font-mono, monospace)',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          background: '#1f1f1f',
          borderBottom: '1px solid #333'
        }}>
          <div>
            <span style={{ color: '#ff6b6b', fontWeight: 600 }}>Symbol Analysis</span>
            <span style={{ marginLeft: '8px', fontSize: '9px', color: '#888' }}>
              {formatFrequency(freqRange.min)} - {formatFrequency(freqRange.max)}
            </span>
          </div>
          <button
            onClick={() => setIsLive(!isLive)}
            style={{
              background: isLive ? '#ff4444' : '#ff6b6b',
              border: 'none',
              color: 'white',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '9px',
              cursor: 'pointer'
            }}
          >
            {isLive ? 'STOP' : 'START'}
          </button>
        </div>

        <div style={{ maxHeight: '200px', overflow: 'auto' }}>
          {liveData.length === 0 ? (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              color: '#666',
              fontSize: '10px'
            }}>
              {isLive ? 'Waiting for data...' : 'Click START to begin capture'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1px', background: '#333' }}>
              <div style={{
                background: '#1f1f1f',
                padding: '8px',
                textAlign: 'center',
                fontWeight: 600,
                color: '#ff6b6b',
                fontSize: '10px'
              }}>
                SYMBOL
              </div>
              <div style={{
                background: '#1f1f1f',
                padding: '8px',
                textAlign: 'center',
                fontWeight: 600,
                color: '#ff6b6b',
                fontSize: '10px'
              }}>
                CONFIDENCE
              </div>
              <div style={{
                background: '#1f1f1f',
                padding: '8px',
                textAlign: 'center',
                fontWeight: 600,
                color: '#ff6b6b',
                fontSize: '10px'
              }}>
                TIME
              </div>

              {liveData.map((entry, index) => (
                <React.Fragment key={entry.timestamp}>
                  <div style={{
                    background: '#0a0a0a',
                    padding: '6px 8px',
                    textAlign: 'center',
                    color: entry.symbols === 'I' ? '#00ff88' : '#ff6b6b',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}>
                    {entry.symbols}
                  </div>
                  <div style={{
                    background: '#0a0a0a',
                    padding: '6px 8px',
                    textAlign: 'center',
                    color: '#fff',
                    fontSize: '9px'
                  }}>
                    {(entry.confidence * 100).toFixed(1)}%
                  </div>
                  <div style={{
                    background: '#0a0a0a',
                    padding: '6px 8px',
                    textAlign: 'center',
                    color: '#888',
                    fontSize: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2px'
                  }}>
                    <Clock size={8} />
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};