import React from 'react';

interface SpectogramNodeProps {
  data: {
    spectogramOptions: boolean;
    label: string;
  };
}

export const SpectogramNode: React.FC<SpectogramNodeProps> = ({ data }) => {
  return (
    <>
      <div className="node-title">{data.label}</div>
      <div className="node-description">
        <div style={{ fontSize: '9px', textAlign: 'center' }}>
          🖼️ 128x128 ML
        </div>
      </div>
    </>
  );
};
