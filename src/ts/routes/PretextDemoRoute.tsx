import React from 'react';
import { SimplePretextDemo } from '@n-apt/components/pretext/SimplePretextDemo';

export const PretextDemoRoute: React.FC = () => {
  return (
    <div style={{ width: '100%', height: '100vh', overflow: 'auto' }}>
      <SimplePretextDemo />
    </div>
  );
};
