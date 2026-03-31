import React from 'react';
import { VFOGridDemo } from '@n-apt/components/pretext/VFOGridDemo';

export const VFOGridDemoRoute: React.FC = () => {
  return (
    <div style={{ width: '100%', height: '100vh', overflow: 'auto' }}>
      <VFOGridDemo />
    </div>
  );
};
