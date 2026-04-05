import React from 'react';

interface OutputNodeProps {
  data: {
    label: string;
  };
}

export const OutputNode: React.FC<OutputNodeProps> = ({ _data }) => {
  return (
    <div style={{ minWidth: '200px' }}>
      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#fff' }}>Output</div>
      <div style={{ fontSize: '10px', color: '#888' }}>Processed signal results</div>
    </div>
  );
};