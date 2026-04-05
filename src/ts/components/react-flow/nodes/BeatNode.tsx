import React from 'react';

interface BeatNodeProps {
  data: {
    beatOptions: boolean;
    label: string;
  };
}

export const BeatNode: React.FC<BeatNodeProps> = ({ data }) => {
  return (
    <>
      <div className="node-title">{data.label}</div>
      <div className="node-description">
        <div style={{ fontSize: '10px', textAlign: 'center' }}>
          🥁 Beat Detect
        </div>
      </div>
    </>
  );
};
