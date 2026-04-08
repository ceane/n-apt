import React from 'react';

interface WaterfallNodeProps {
  data: {
    waterfallOptions: boolean;
    label: string;
  };
}

export const WaterfallNode: React.FC<WaterfallNodeProps> = ({ data }) => {
  return (
    <>
      <div className="node-title">{data.label}</div>
      <div className="node-description">
        <div style={{ fontSize: '10px', textAlign: 'center' }}>
          🌊 Waterfall
        </div>
      </div>
    </>
  );
};
