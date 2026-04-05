import React from 'react';
import { Zap } from 'lucide-react';

interface ChannelNodeProps {
  data: {
    channelNode: boolean;
    label: string;
  };
}

export const ChannelNode: React.FC<ChannelNodeProps> = ({ _data }) => {
  return (
    <div style={{ minWidth: '260px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <div style={{ padding: '6px', background: '#a855f722', borderRadius: '6px' }}>
          <Zap size={14} color="#a855f7" />
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Channel</div>
          <div style={{ fontSize: '9px', opacity: 0.45, fontFamily: 'monospace' }}>Signal Area</div>
        </div>
      </div>
      <div className="nodrag nopan" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', width: '100%' }}>
        <div style={{ padding: '8px', background: '#1f1f1f', borderRadius: '4px', textAlign: 'center', color: '#888' }}>
          Channel Configuration
        </div>
      </div>
    </div>
  );
};