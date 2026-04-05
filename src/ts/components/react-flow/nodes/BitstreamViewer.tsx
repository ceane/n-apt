import React, { useState, useEffect } from 'react';
import { useSpectrumStore } from '@n-apt/hooks/useSpectrumStore';
import { useAppSelector } from '@n-apt/redux';
import { formatFrequency } from '@n-apt/utils/frequency';
import { File as FileIcon, Download, Clock } from 'lucide-react';

interface BitstreamViewerProps {
  frequencyRange: { min: number; max: number } | null;
}

export const BitstreamViewer: React.FC<BitstreamViewerProps> = ({ frequencyRange }) => {
  const { wsConnection } = useSpectrumStore();
  const reduxDeviceName = useAppSelector((s) => s.websocket.deviceName);
  const deviceName = wsConnection.deviceName || reduxDeviceName || "SDR Device";
  const [isLive, setIsLive] = useState(false);
  const [bitstreamData, setBitstreamData] = useState<Array<{
    timestamp: number;
    data: string;
    length: number;
  }>>([]);

  useEffect(() => {
    if (!wsConnection || !isLive) return;

    // Mock data for now - replace with actual WebSocket integration
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
    <div style={{
      background: '#0a0a0a',
      border: '1px solid #1f1f1f',
      borderRadius: '8px',
      overflow: 'hidden',
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
        <div style={{ fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileIcon size={16} />
          Bitstream Analysis
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

        {bitstreamData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', opacity: 0.5 }}>
            <Clock size={32} style={{ marginBottom: '8px' }} />
            <div>Waiting for bitstream data...</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {bitstreamData.map((entry, index) => (
              <div key={entry.timestamp} style={{
                background: '#1a1a1a',
                border: '1px solid #1f1f1f',
                borderRadius: '6px',
                padding: '8px',
                opacity: 1 - (index * 0.1),
                transition: 'opacity 0.3s ease'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px'
                }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </div>
                  <div style={{
                    fontSize: '9px',
                    color: '#00ff88',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {entry.length} bytes
                    {/* Use button + window.location.href instead of target=_blank to avoid popup blocking in React Flow */}
                    <button
                      onClick={() => {
                        const blob = new Blob([entry.data], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        window.location.href = url;
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#00ff88',
                        cursor: 'pointer',
                        padding: '2px'
                      }}
                    >
                      <Download size={12} />
                    </button>
                  </div>
                </div>
                <div style={{
                  fontSize: '9px',
                  color: '#ccc',
                  wordBreak: 'break-all',
                  maxHeight: '60px',
                  overflow: 'auto',
                  background: '#0a0a0a',
                  padding: '6px',
                  borderRadius: '4px',
                  border: '1px solid #1f1f1f'
                }}>
                  {entry.data}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
