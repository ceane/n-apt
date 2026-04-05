import React from 'react';

interface SpikeNodeProps {
  data: {
    spikeOptions: boolean;
    label: string;
  };
}

export const SpikeNode: React.FC<SpikeNodeProps> = ({ data }) => {
  return (
    <>
      <div className="node-title">{data.label}</div>
      <div className="node-description">
        <div style={{ fontSize: '10px', textAlign: 'center' }}>
          ⚡ Spike Detect
        </div>
      </div>
    </>
  );
};
