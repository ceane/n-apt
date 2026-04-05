import React from 'react';
import { Brain } from 'lucide-react';
import { formatFrequency } from '@n-apt/utils/frequency';
import { useSpectrumStore } from '@n-apt/hooks/useSpectrumStore';

interface AnalysisNodeProps {
  data: {
    analysisOptions: boolean;
    label: string;
    result: {
      snrDelta: string;
      summary: string;
    };
  };
}

export const AnalysisNode: React.FC<AnalysisNodeProps> = ({ data }) => {
  const { state: spectrumState, sampleRateMHz } = useSpectrumStore();
  const { activeSignalArea, frequencyRange, lastKnownRanges, vizZoom, vizPanOffset } = spectrumState;
  const areaKey = activeSignalArea || "A";

  // Calculate visible frequency range based on zoom and pan for labeling
  const calculateVisible = () => {
    const minFreq = 0;
    const maxFreq = 2000; // Cap
    const hardwareSpan = sampleRateMHz || 3.2;

    const safeZoom = (Number.isFinite(vizZoom) && vizZoom > 0) ? vizZoom : 1;

    if (!frequencyRange) {
      return lastKnownRanges[areaKey] || { min: minFreq, max: minFreq + hardwareSpan };
    }

    const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
    const visualSpan = hardwareSpan / safeZoom;
    const halfVisualSpan = visualSpan / 2;
    let visualCenter = hardwareCenter + vizPanOffset;

    visualCenter = Math.max(
      minFreq + halfVisualSpan,
      Math.min(maxFreq - halfVisualSpan, visualCenter),
    );

    return {
      min: visualCenter - halfVisualSpan,
      max: visualCenter + halfVisualSpan,
    };
  };

  const freqRange = calculateVisible();
  const result = data.result;
  if (!result) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '220px', textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <div style={{ padding: '6px', background: '#e100ff22', borderRadius: '4px' }}>
          <Brain size={16} color="#e100ff" />
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#e100ff' }}>BASELINE ANALYSIS</div>
          <div style={{ fontSize: '9px', opacity: 0.6, fontFamily: 'monospace' }}>Neural Vector Result</div>
        </div>
      </div>

      <div style={{
        background: '#00000044',
        border: '1px solid #ffffff11',
        borderRadius: '6px',
        padding: '10px',
        fontSize: '11px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ opacity: 0.6 }}>Frequency Span</div>
          <div style={{ color: '#00d4ff', fontWeight: 700 }}>{formatFrequency(freqRange.min)} - {formatFrequency(freqRange.max)}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ opacity: 0.6 }}>SNR Delta:</span>
          <span style={{ fontFamily: 'monospace' }}>{result.snrDelta}</span>
        </div>
        <div style={{ fontSize: '10px', lineHeight: 1.4, marginTop: '4px', borderTop: '1px solid #ffffff11', paddingTop: '8px' }}>
          {result.summary}
        </div>
      </div>
    </div>
  );
};
