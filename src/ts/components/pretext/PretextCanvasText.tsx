import React, { useRef, useEffect, useCallback } from 'react';
import { usePretextText } from '@n-apt/hooks/usePretextText';
import type { PretextCanvasTextProps } from '@n-apt/components/pretext/PretextTypes';

export interface PretextCanvasTextRef {
  draw: (ctx: CanvasRenderingContext2D) => void;
  getBounds: () => { x: number; y: number; width: number; height: number };
}

export const PretextCanvasText = React.forwardRef<PretextCanvasTextRef, PretextCanvasTextProps>(
  (
    {
      text,
      font = 'Inter, sans-serif',
      fontSize = 16,
      color = '#000000',
      maxWidth,
      lineHeight,
      whiteSpace = 'normal',
      x = 0,
      y = 0,
      anchorX = 'left',
      anchorY = 'top',
      rotation = 0,
      opacity = 1,
    },
    ref
  ) => {
    const { layout, layoutWithLines, metrics, isReady } = usePretextText({
      text,
      font,
      fontSize,
      color,
      maxWidth,
      lineHeight,
      whiteSpace,
    });

    const boundsRef = useRef({ x, y, width: 0, height: 0 });

    const draw = useCallback(
      (ctx: CanvasRenderingContext2D) => {
        if (!isReady || !metrics) return;

        ctx.save();

        // Apply transformations
        ctx.translate(x, y);
        if (rotation !== 0) {
          ctx.rotate((rotation * Math.PI) / 180);
        }
        ctx.globalAlpha = opacity;

        // Set font and color
        const fontString = `${fontSize}px ${font}`;
        ctx.font = fontString;
        ctx.fillStyle = color;
        ctx.textAlign = anchorX;
        ctx.textBaseline = anchorY === 'middle' ? 'middle' : anchorY === 'bottom' ? 'bottom' : 'top';

        // Calculate text position based on anchors
        let drawX = 0;
        let drawY = 0;

        if (anchorX === 'center') {
          drawX = 0;
        } else if (anchorX === 'right') {
          drawX = 0;
        }

        if (anchorY === 'middle') {
          drawY = 0;
        } else if (anchorY === 'bottom') {
          drawY = 0;
        }

        // Use layout if maxWidth is specified, otherwise simple text
        if (maxWidth) {
          const layoutResult = layout(maxWidth, lineHeight || fontSize * 1.2);
          const linesResult = layoutWithLines(maxWidth, lineHeight || fontSize * 1.2);

          linesResult.lines.forEach((line: { text: string; width: number }, index: number) => {
            const lineY = drawY + index * (lineHeight || fontSize * 1.2);
            ctx.fillText(line.text, drawX, lineY);
          });

          boundsRef.current = {
            x,
            y,
            width: layoutResult.width,
            height: layoutResult.height,
          };
        } else {
          ctx.fillText(text, drawX, drawY);
          boundsRef.current = {
            x,
            y,
            width: metrics.width,
            height: metrics.height,
          };
        }

        ctx.restore();
      },
      [text, font, fontSize, color, maxWidth, lineHeight, whiteSpace, x, y, anchorX, anchorY, rotation, opacity, layout, metrics, isReady]
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

    // This component doesn't render anything directly
    // It's meant to be used with a canvas context
    return null;
  }
);

PretextCanvasText.displayName = 'PretextCanvasText';
