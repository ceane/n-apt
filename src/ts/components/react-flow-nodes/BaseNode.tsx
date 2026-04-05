import React from 'react';

interface BaseNodeProps {
  data: {
    label: string;
  };
}

export const BaseNode: React.FC<BaseNodeProps> = ({ _data }) => {
  return (
    <div style={{ minWidth: '200px' }}>
      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#fff' }}>Base Node</div>
      <div style={{ fontSize: '10px', color: '#888' }}>Generic base component</div>
    </div>
  );
};