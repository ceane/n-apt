import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import type { PretextStatsBoxProps } from '@n-apt/components/pretext/PretextTypes';

export interface PretextStatsBoxRef {
  draw: (ctx: CanvasRenderingContext2D) => void;
  getBounds: () => { x: number; y: number; width: number; height: number };
}

export const PretextStatsBox = React.forwardRef<PretextStatsBoxRef, PretextStatsBoxProps>(
  (
    {
      x,
      y,
      width,
      height,
      title,
      stats,
      backgroundColor = 'rgba(0, 0, 0, 0.8)',
      borderColor = '#ffffff',
      borderWidth = 1,
      padding = 8,
      fontSize = 12,
    },
    ref
  ) => {
    const boundsRef = useRef({ x, y, width, height });

    // Calculate text positions using Pretext
    const textLayouts = useMemo(() => {
      const layouts = [];
      let currentY = y + padding;

      // Title layout
      if (title) {
        layouts.push({
          text: title,
          x: x + padding,
          y: currentY,
          fontSize: fontSize + 2,
          fontWeight: 'bold',
          color: '#ffffff',
        });
        currentY += fontSize + 8;
      }

      // Stats layout
      stats.forEach((_stat) => {
        const labelY = currentY;
        const valueY = currentY;

        layouts.push({
          text: `${_stat.label}:`,
          x: x + padding,
          y: labelY,
          fontSize,
          fontWeight: 'normal',
          color: _stat.color || '#cccccc',
        });

        layouts.push({
          text: String(_stat.value),
          x: x + width - padding,
          y: valueY,
          fontSize,
          fontWeight: 'normal',
          color: _stat.color || '#ffffff',
          anchorX: 'right' as const,
        } as any);

        currentY += fontSize + 4;
      });

      return layouts;
    }, [x, y, width, height, title, stats, padding, fontSize]);

    const draw = useCallback(
      (ctx: CanvasRenderingContext2D) => {
        // Draw background
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(x, y, width, height);

        // Draw border
        if (borderWidth > 0) {
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = borderWidth;
          ctx.strokeRect(x, y, width, height);
        }

        // Draw text elements
        textLayouts.forEach((layout) => {
          ctx.save();

          const fontString = `${layout.fontWeight || 'normal'} ${layout.fontSize}px "Inter", sans-serif`;
          ctx.font = fontString;
          ctx.fillStyle = layout.color;
          ctx.textAlign = (layout as any).anchorX || 'left';
          ctx.textBaseline = 'top';

          ctx.fillText(layout.text, layout.x, layout.y);
          ctx.restore();
        });

        boundsRef.current = { x, y, width, height };
      },
      [x, y, width, height, backgroundColor, borderColor, borderWidth, textLayouts]
    );

    const getBounds = useCallback(() => boundsRef.current, []);

    useEffect(() => {
      if (ref) {
        if (typeof ref === 'function') {
          ref({ draw, getBounds });
        } else {
          ref.current = { draw, getBounds };
        }
      }
    }, [ref, draw, getBounds]);

    return null;
  }
);

PretextStatsBox.displayName = 'PretextStatsBox';
