import React, { useMemo, forwardRef } from 'react';
import { PretextCanvasText, type PretextCanvasTextRef } from '@n-apt/components/pretext/PretextCanvasText';
import type { PretextVFOTextProps } from '@n-apt/components/pretext/PretextTypes';

const formatFrequency = (frequency: number, unit: string = 'Hz', precision: number = 2, showUnit: boolean = true): string => {
  let value = frequency;
  let displayUnit = unit;

  // Auto-scale to appropriate unit
  if (unit === 'Hz') {
    if (frequency >= 1e9) {
      value = frequency / 1e9;
      displayUnit = 'GHz';
    } else if (frequency >= 1e6) {
      value = frequency / 1e6;
      displayUnit = 'MHz';
    } else if (frequency >= 1e3) {
      value = frequency / 1e3;
      displayUnit = 'kHz';
    }
  }

  const formattedValue = value.toFixed(precision);
  return showUnit ? `${formattedValue} ${displayUnit}` : formattedValue;
};

export const PretextVFOText = React.forwardRef<
  { draw: (ctx: CanvasRenderingContext2D) => void; getBounds: () => { x: number; y: number; width: number; height: number } },
  PretextVFOTextProps
>(({
  frequency,
  unit = 'Hz',
  precision = 2,
  showUnit = true,
  font = '"JetBrains Mono", monospace',
  fontSize = 14,
  color = '#ffffff',
  x = 0,
  y = 0,
  anchorX = 'left',
  anchorY = 'top',
  opacity = 1,
}) => {
  const displayText = useMemo(() => {
    return formatFrequency(frequency, unit, precision, showUnit);
  }, [frequency, unit, precision, showUnit]);

  return (
    <PretextCanvasText
      text={displayText}
      font={font}
      fontSize={fontSize}
      color={color}
      x={x}
      y={y}
      anchorX={anchorX}
      anchorY={anchorY}
      opacity={opacity}
    />
  );
});
