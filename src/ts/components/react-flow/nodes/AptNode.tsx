import React from 'react';
import { SignalPreviewNode } from './SignalPreviewNode';
import { generateAPTIQData } from '@n-apt/utils/generateSignalData';

interface AptNodeProps {
  data: {
    label: string;
  };
}

export const AptNode: React.FC<AptNodeProps> = ({ data }) => {
  return (
    <SignalPreviewNode
      label={data.label || 'APT Analysis'}
      activeSignalArea="apt-preview"
      centerFrequencyMHz={137.92}
      frequencyRange={{ min: 137.82, max: 138.02 }}
      buildIqData={generateAPTIQData}
    />
  );
};
