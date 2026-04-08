import React from 'react';

interface FFTNodeProps {
  data: {
    fftOptions: boolean;
    label: string;
  };
}

export const FFTNode: React.FC<FFTNodeProps> = ({ data }) => {
  return (
    <>
      <div className="node-title">{data.label}</div>
      <div className="node-description">
        <div style={{ fontSize: '10px', textAlign: 'center' }}>
          📊 FFT Transform
        </div>
      </div>
    </>
  );
};
