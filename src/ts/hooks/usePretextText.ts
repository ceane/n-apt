import { useMemo, useRef, useCallback } from 'react';
import { layout, prepareWithSegments, layoutWithLines, type PreparedTextWithSegments } from '@chenglou/pretext';
import type { PretextTextOptions, PretextLayoutResult, PretextMetrics } from '@n-apt/components/pretext/PretextTypes';

export interface UsePretextTextResult {
  layout: (maxWidth: number, lineHeight?: number) => PretextLayoutResult;
  layoutWithLines: (maxWidth: number, lineHeight?: number) => PretextLayoutResult & { lines: Array<{ text: string; width: number; startIndex: number; endIndex: number }> };
  metrics: PretextMetrics | null;
  isReady: boolean;
  getDPIScaledMetrics: (devicePixelRatio?: number) => PretextMetrics | null;
}

export const usePretextText = (options: PretextTextOptions): UsePretextTextResult => {
  const { text, font, fontSize = 16, whiteSpace = 'normal' } = options;
  
  const preparedRef = useRef<PreparedTextWithSegments | null>(null);
  const metricsRef = useRef<PretextMetrics | null>(null);

  // Prepare text (expensive operation, cached)
  const prepared = useMemo(() => {
    try {
      const fontString = fontSize ? `${fontSize}px ${font}` : font;
      return prepareWithSegments(text, fontString, { whiteSpace });
    } catch (error) {
      console.warn('Pretext preparation failed:', error);
      return null;
    }
  }, [text, font, fontSize, whiteSpace]);

  preparedRef.current = prepared;

  // Get text metrics using canvas
  const metrics = useMemo(() => {
    if (!prepared) return null;
    
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const fontString = fontSize ? `${fontSize}px ${font}` : font;
      ctx.font = fontString;
      
      const metrics = ctx.measureText(text);
      
      return {
        width: metrics.width,
        height: fontSize * 1.2, // Approximate height
        ascent: metrics.actualBoundingBoxAscent || fontSize * 0.8,
        descent: metrics.actualBoundingBoxDescent || fontSize * 0.2,
        lineHeight: fontSize * 1.2,
      };
    } catch (error) {
      console.warn('Failed to get text metrics:', error);
      return null;
    }
  }, [prepared, text, font, fontSize]);

  metricsRef.current = metrics;

  // Layout function (cheap operation)
  const layoutResult = useCallback((maxWidth: number, lineHeight?: number) => {
    if (!prepared) {
      return { width: 0, height: 0, lineCount: 0 };
    }

    try {
      const result = layout(prepared, maxWidth, lineHeight || fontSize * 1.2);
      return {
        width: maxWidth,
        height: result.height,
        lineCount: result.lineCount,
      };
    } catch (error) {
      console.warn('Pretext layout failed:', error);
      return { width: 0, height: 0, lineCount: 0 };
    }
  }, [prepared, fontSize]);

  // Layout with lines function
  const layoutWithLinesResult = useCallback((maxWidth: number, lineHeight?: number) => {
    if (!prepared) {
      return { width: 0, height: 0, lineCount: 0, lines: [] };
    }

    try {
      const result = layoutWithLines(prepared, maxWidth, lineHeight || fontSize * 1.2);
      return {
        width: maxWidth,
        height: result.height,
        lineCount: result.lines.length,
        lines: result.lines.map(line => ({
          text: line.text,
          width: line.width,
          startIndex: 0, // Not available in LayoutLine type
          endIndex: line.text.length,
        })),
      };
    } catch (error) {
      console.warn('Pretext layout with lines failed:', error);
      return { width: 0, height: 0, lineCount: 0, lines: [] };
    }
  }, [prepared, fontSize]);

  // Get DPI-scaled metrics for high-DPI displays
  const getDPIScaledMetrics = useCallback((devicePixelRatio: number = window.devicePixelRatio || 1) => {
    if (!metrics) return null;
    
    return {
      ...metrics,
      width: metrics.width * devicePixelRatio,
      height: metrics.height * devicePixelRatio,
      ascent: metrics.ascent * devicePixelRatio,
      descent: metrics.descent * devicePixelRatio,
      lineHeight: metrics.lineHeight * devicePixelRatio,
    };
  }, [metrics]);

  return {
    layout: layoutResult,
    layoutWithLines: layoutWithLinesResult,
    metrics: metricsRef.current,
    isReady: !!prepared,
    getDPIScaledMetrics,
  };
};
