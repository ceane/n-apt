export interface PretextTextOptions {
  text: string;
  font: string;
  fontSize?: number;
  color?: string;
  maxWidth?: number;
  lineHeight?: number;
  whiteSpace?: 'normal' | 'pre-wrap';
}

export interface PretextLayoutResult {
  width: number;
  height: number;
  lineCount: number;
  lines?: Array<{
    text: string;
    width: number;
    startIndex: number;
    endIndex: number;
  }>;
}

export interface PretextMetrics {
  width: number;
  height: number;
  ascent: number;
  descent: number;
  lineHeight: number;
}

export interface PretextCanvasTextProps extends PretextTextOptions {
  x?: number;
  y?: number;
  anchorX?: 'left' | 'center' | 'right';
  anchorY?: 'top' | 'middle' | 'bottom';
  rotation?: number;
  opacity?: number;
}

export interface PretextVFOTextProps extends Omit<PretextCanvasTextProps, 'maxWidth'> {
  frequency: number;
  unit?: 'Hz' | 'kHz' | 'MHz' | 'GHz';
  precision?: number;
  showUnit?: boolean;
}

export interface PretextStatsBoxProps {
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  stats: Array<{
    label: string;
    value: string | number;
    color?: string;
  }>;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  padding?: number;
  fontSize?: number;
}
