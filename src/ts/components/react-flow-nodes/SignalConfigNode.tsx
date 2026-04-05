import React from 'react';

interface SignalConfigNodeProps {
  data: {
    signalOptions: boolean;
    label: string;
  };
}

export const SignalConfigNode: React.FC<SignalConfigNodeProps> = ({ _data }) => {
  return (
    <div style={{ minWidth: '200px' }}>
      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#fff' }}>Signal Config</div>
      <div style={{ fontSize: '10px', color: '#888' }}>Hardware sampling and FFT settings</div>
    </div>
  );
};