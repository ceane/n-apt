import React from 'react';

interface CoreMLNodeProps {
  data: {
    coremlOptions: boolean;
    label: string;
  };
}

export const CoreMLNode: React.FC<CoreMLNodeProps> = ({ data }) => {
  return (
    <>
      <div className="node-title">{data.label}</div>
      <div className="node-description">
        <div style={{ fontSize: '10px', textAlign: 'center' }}>
          🧠 ML Inference
        </div>
      </div>
    </>
  );
};
