import React, { useState, useEffect } from 'react';
import { useSpectrumStore } from '@n-apt/hooks/useSpectrumStore';
import { useAppSelector } from '@n-apt/redux';
import { Download, HardDrive, Clock } from 'lucide-react';

interface BitstreamAnalysisNodeProps {
  data: {
    bitstreamOptions: boolean;
    label: string;
    frequencyRange?: { min: number; max: number };
  };
}

export const BitstreamAnalysisNode: React.FC<BitstreamAnalysisNodeProps> = ({ data }) => {
  const { wsConnection } = useSpectrumStore();
  const reduxDeviceName = useAppSelector((s) => s.websocket.deviceName);
  const deviceName = wsConnection.deviceName || reduxDeviceName || "SDR Device";
  const [isLive, setIsLive] = useState(false);
  const [bitstreamData, setBitstreamData] = useState<Array<{
    timestamp: number;
    data: string;
    length: number;
  }>>([]);

  // Mock data for now - replace with actual WebSocket integration
  useEffect(() => {
    if (!wsConnection || !isLive) return;

    const mockInterval = setInterval(() => {
      setBitstreamData(prev => [
        ...prev.slice(-9), // Keep last 10 entries
        {
          timestamp: Date.now(),
          data: Math.random().toString(2).substring(2, 50), // Random binary string
          length: Math.floor(Math.random() * 100) + 50
        }
      ]);
    }, 2000);

    return () => clearInterval(mockInterval);
  }, [wsConnection, isLive]);

  const downloadBitstream = (entry: typeof bitstreamData[0]) => {
    const blob = new Blob([entry.data], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bitstream_${entry.timestamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '300px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <div style={{ padding: '6px', background: '#4ecdc422', borderRadius: '4px' }}>
          <HardDrive size={16} color="#4ecdc4" />
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#4ecdc4' }}>BITSTREAM ANALYSIS</div>
          <div style={{ fontSize: '9px', opacity: 0.6, fontFamily: 'monospace' }}>Raw Binary Data</div>
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
          <span style={{ color: '#4ecdc4', fontWeight: 600 }}>Bitstream Data</span>
          <button
            onClick={() => setIsLive(!isLive)}
            style={{
              background: isLive ? '#ff4444' : '#4ecdc4',
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
          {bitstreamData.length === 0 ? (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              color: '#666',
              fontSize: '10px'
            }}>
              {isLive ? 'Waiting for data...' : 'Click START to begin capture'}
            </div>
          ) : (
            bitstreamData.map((entry, index) => (
              <div
                key={entry.timestamp}
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid #333',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    color: '#4ecdc4',
                    fontSize: '9px',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    marginBottom: '2px'
                  }}>
                    {entry.data}
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '12px',
                    fontSize: '8px',
                    color: '#888'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={8} />
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <span>Length: {entry.length}</span>
                  </div>
                </div>
                <button
                  onClick={() => downloadBitstream(entry)}
                  style={{
                    background: 'transparent',
                    border: '1px solid #4ecdc4',
                    color: '#4ecdc4',
                    padding: '4px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Download size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};