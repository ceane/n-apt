import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import styled from 'styled-components';
import { motion, useInView } from 'framer-motion';
import { Copy, Check } from 'lucide-react';
import {
  BYTES_PER_IQ_SAMPLE,
  getRawIfftModel,
} from '@n-apt/math/signalData';

const START_DATE = new Date('2018-09-30T00:00:00Z');
const ESCALATION_DATE = new Date('2023-01-01T00:00:00Z');

// Default fallback rate for the raw write-to-read minimum model.
const DEFAULT_RATE_MBS = 57.784;

const CHANNEL_SAMPLE_RATES_HZ = [4.372e6, 6.27e6, 18.25e6];
const MIN_TARGET_HZ = 24;
const MAX_TARGET_HZ = 60;

const Container = styled.div`
  --ds-bg-start: rgba(40, 55, 128, 0.4);
  --ds-bg-end: rgba(20, 28, 64, 0.6);
  --ds-border: rgba(158, 174, 255, 0.15);
  --ds-accent: rgba(158, 174, 255, 0.5);
  --ds-text-primary: #f3f6ff;
  --ds-text-secondary: rgba(172, 186, 255, 0.7);
  --ds-text-unit: rgba(172, 186, 255, 0.5);
  --ds-text-dim: rgba(172, 186, 255, 0.4);

  display: flex;
  flex-direction: column;
  gap: 3rem;
  overflow: hidden;
`;

const CopyRow = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
`;

const CopyButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem;
  border: none;
  background: transparent;
  color: var(--ds-accent);
  cursor: pointer;
  transition: color 0.2s ease;

  &:hover {
    color: rgba(158, 174, 255, 0.8);
  }

  &:focus-visible {
    outline: 2px solid var(--ds-accent);
    outline-offset: 2px;
  }

  &[data-copied='true'] {
    color: #7df6a6;
  }
`;

const TopRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
`;

const DataContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 2rem;
  position: relative;
`;

const _SectionLabel = styled.div`
  font-family: "KaTeX_Main", serif;
  font-size: 0.65rem;
  letter-spacing: 0.25em;
  color: var(--ds-text-dim);
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: -2rem;
  z-index: 1;
`;

const StatBox = styled(motion.div)`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const Label = styled.small`
  font-family: "KaTeX_Main", serif;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--ds-text-secondary);
  font-weight: 600;
`;

const Value = styled.div`
  font-family: "KaTeX_Main", serif;
  font-size: 2.3rem;
  font-weight: 400;
  color: var(--ds-text-primary);
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  line-height: 1;
  white-space: nowrap;

  span.unit {
    font-family: "KaTeX_Main", serif;
    font-size: 1.6rem;
    color: var(--ds-text-unit);
    font-style: italic;
  }
`;

const SubValue = styled.small`
  font-family: "KaTeX_Main", serif;
  font-size: 0.8rem;
  color: var(--ds-text-dim);
  margin-top: 0.15rem;
  display: block;
  font-style: italic;
  letter-spacing: 0.02em;
  line-height: 1.3;
`;

const SubLabel = styled.div`
  font-family: "KaTeX_Main", serif;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ds-text-secondary);
  font-weight: 500;
  margin-bottom: 0.25rem;
`;

const _FootnoteLabel = styled.div`
  font-family: "KaTeX_Main", serif;
  font-size: 0.7rem;
  color: var(--ds-text-dim);
  line-height: 1.4;
  margin-top: -1rem;
`;

const MinMaxGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-top: 0.25rem;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  ${Value} {
    font-size: 1.15rem;

    span.unit {
      font-size: 0.85rem;
    }
  }
`;

const DataMinMaxGrid = styled(MinMaxGrid)`
  ${Value} {
    font-size: 1.7rem;

    span.unit {
      font-size: 1.1rem;
    }
  }
`;

const CostContainer = styled(DataContainer)`
  margin-top: 0;

  /* Keep both Min/Max rows aligned when the left heading wraps. */
  > ${StatBox} > ${Label} {
    display: block;
    min-height: 2.6em;
    line-height: 1.3;
  }
`;

const DigitContainer = styled.span`
  display: inline-block;
  position: relative;
  overflow: hidden;
  vertical-align: bottom;
  will-change: transform;
`;

const PlaceholderDigit = styled.span`
  visibility: hidden;
  display: inline-block;
  padding: 0.15em 0;
`;

const DigitList = styled(motion.span)`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  will-change: transform;
`;

const SingleDigit = styled.span`
  display: inline-block;
  padding: 0.15em 0;
  flex-shrink: 0;
  text-align: center;
`;

const CounterWrapper = styled.span`
  display: inline-flex;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
`;

const RollingCounter: React.FC<{ value: string | number; animateActive: boolean }> = ({ value, animateActive }) => {
  const str = String(value);

  return (
    <CounterWrapper>
      {str.split('').map((char, idx) => {
        if (char >= '0' && char <= '9') {
          const digit = parseInt(char, 10);
          return (
            <DigitContainer key={idx}>
              <PlaceholderDigit>{digit}</PlaceholderDigit>
              <DigitList
                initial={{ y: '0%' }}
                animate={{ y: animateActive ? `-${digit * 10}%` : '0%' }}
                transition={{
                  duration: 2,
                  delay: 0.1, // brief delay to start rolling after fade-in starts
                  ease: [0.1, 1.0, 0.1, 1.0], // cubic-bezier(0.1, 1, 0.1, 1)
                }}
              >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                  <SingleDigit key={d}>{d}</SingleDigit>
                ))}
              </DigitList>
            </DigitContainer>
          );
        }
        return <span key={idx}>{char}</span>;
      })}
    </CounterWrapper>
  );
};

const formatNumber = (num: number) => {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(num);
};

const formatCurrency = (val: number) => {
  if (val >= 1000000) {
    return `$${(val / 1000000).toFixed(2)}M`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val);
};

// ---------------------------------------------------------------------------
// Clipboard image rendering
// ---------------------------------------------------------------------------

// The copied image uses a fixed canvas so the pasted image reads as a
// self-contained card on any surface.
const IMAGE_WIDTH = 800;
const IMAGE_HEIGHT = 500;

const IMAGE_BG = '#283780';
const IMAGE_TEXT = '#f3f6ff';
const IMAGE_TEXT_DIM = 'rgba(172, 186, 255, 0.7)';
const IMAGE_TEXT_FAINT = 'rgba(172, 186, 255, 0.4)';
const IMAGE_UNIT = 'rgba(172, 186, 255, 0.5)';

const IMAGE_FONT_SERIF = '"KaTeX_Main", "Times New Roman", serif';

const IMAGE_COL_X = [24, 280, 538];
const IMAGE_TOP_LABEL_Y = 34;
const IMAGE_TOP_VALUE_Y = 100;
const IMAGE_TOP_VALUE_SIZE = 48;

const IMAGE_SECTION_LABEL_Y = 174;
const IMAGE_SECTION_MINMAX_Y = 245;
const IMAGE_SECTION_SUB_Y = 271;
const IMAGE_SECTION_X = [24, 408];
const IMAGE_MINMAX_X_OFFSET = 0;
const IMAGE_MAX_X_OFFSET = 188;
const IMAGE_TEXT_COLUMN_WIDTH = IMAGE_MAX_X_OFFSET - 16;

const IMAGE_COST_LABEL_Y = 356;
const IMAGE_COST_MINMAX_Y = 384;
const IMAGE_COST_VALUE_Y = 414;

const drawLabel = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baselineY: number,
  size = 10,
) => {
  ctx.save();
  ctx.font = `700 ${size}px ${IMAGE_FONT_SERIF}`;
  ctx.fillStyle = IMAGE_TEXT_DIM;
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '0.25em';
  ctx.fillText(text.toUpperCase(), x, baselineY);
  ctx.restore();
};

// Shrink-to-fit: find the largest font size that lets `text` fit within
// `maxWidth` pixels. Mirrors the site's clamp()-based responsive values.
const fitTextSize = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize = 12,
) => {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `400 ${size}px ${IMAGE_FONT_SERIF}`;
    if (ctx.measureText(text).width <= maxWidth) {
      break;
    }
    size -= 1;
  }
  return Math.max(size, minSize);
};

const drawValue = (
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  baselineY: number,
  unit?: string,
  valueSize = 56,
) => {
  ctx.save();
  ctx.font = `400 ${valueSize}px ${IMAGE_FONT_SERIF}`;
  ctx.fillStyle = IMAGE_TEXT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, baselineY);
  if (unit) {
    const unitX = x + ctx.measureText(value).width + 12;
    ctx.font = `italic 400 ${valueSize - 20}px ${IMAGE_FONT_SERIF}`;
    ctx.fillStyle = IMAGE_UNIT;
    ctx.fillText(unit, unitX, baselineY);
  }
  ctx.restore();
};

const drawCostValue = (
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  baselineY: number,
  maxWidth: number,
  unit?: string,
) => {
  const valueSize = fitTextSize(ctx, value, maxWidth, 20, 12);
  ctx.save();
  ctx.font = `400 ${valueSize}px ${IMAGE_FONT_SERIF}`;
  ctx.fillStyle = IMAGE_TEXT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, baselineY);
  if (unit) {
    const unitX = x + ctx.measureText(value).width + 8;
    ctx.font = `italic 400 13px ${IMAGE_FONT_SERIF}`;
    ctx.fillStyle = IMAGE_TEXT_FAINT;
    ctx.fillText(unit, unitX, baselineY);
  }
  ctx.restore();
};

const wrapCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) => {
  const lines: string[] = [];
  let line = '';

  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) {
      lines.push(line);
    }
    line = '';

    // Match the DOM's overflow-wrap:anywhere behavior for an unusually long
    // token that cannot fit on one line by itself.
    for (const character of word) {
      const characterCandidate = line + character;
      if (ctx.measureText(characterCandidate).width > maxWidth && line) {
        lines.push(line);
        line = character;
      } else {
        line = characterCandidate;
      }
    }
  }

  if (line) {
    lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
};

const drawWrappedText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baselineY: number,
  maxWidth: number,
  lineHeight: number,
) => {
  const lines = wrapCanvasText(ctx, text, maxWidth);
  lines.forEach((line, index) => {
    ctx.fillText(line, x, baselineY + index * lineHeight);
  });
  return lines.length;
};

export const renderImage = (
  canvas: HTMLCanvasElement,
  stats: { totalHours: number; escalationHours: number; totalDays: number },
  costs: { totalMin: string; totalMax: string; dailyMin: string; dailyMax: string },
  dataMin: { val: string; unit: string },
  dataMax: { val: string; unit: string },
  dailyDataMin: { val: string; unit: string },
  dailyDataMax: { val: string; unit: string },
  totalComparisonTextMin: string,
  totalComparisonTextMax: string,
  dailyComparisonTextMin: string,
  dailyComparisonTextMax: string,
) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const devicePixelRatio = Math.max(
    1,
    Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 3),
  );
  canvas.width = Math.round(IMAGE_WIDTH * devicePixelRatio);
  canvas.height = Math.round(IMAGE_HEIGHT * devicePixelRatio);
  ctx.scale(devicePixelRatio, devicePixelRatio);

  // Solid article background.
  ctx.fillStyle = IMAGE_BG;
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  // Top row: hours total, since escalation, days total.
  const topValues = [
    formatNumber(stats.totalHours),
    formatNumber(stats.escalationHours),
    formatNumber(stats.totalDays),
  ];
  for (let i = 0; i < 3; i++) {
    const x = IMAGE_COL_X[i];
    drawLabel(ctx, ['Hours Total', 'Since Escalation', 'Days Total'][i], x, IMAGE_TOP_LABEL_Y);
    drawValue(
      ctx,
      topValues[i],
      x,
      IMAGE_TOP_VALUE_Y,
      ['hrs', 'hrs', 'days'][i],
      IMAGE_TOP_VALUE_SIZE,
    );
  }

  // Data sections: the DOM places the total and 24-hour sections side by side.
  const sections = [
    {
      x: IMAGE_SECTION_X[0],
      label: 'Data Intercepted Total',
      min: { value: dataMin.val, unit: dataMin.unit },
      max: { value: dataMax.val, unit: dataMax.unit },
      minSub: totalComparisonTextMin,
      maxSub: totalComparisonTextMax,
    },
    {
      x: IMAGE_SECTION_X[1],
      label: 'Data Intercepted in 24HRS',
      min: { value: dailyDataMin.val, unit: dailyDataMin.unit },
      max: { value: dailyDataMax.val, unit: dailyDataMax.unit },
      minSub: dailyComparisonTextMin,
      maxSub: dailyComparisonTextMax,
    },
  ];

  for (const section of sections) {
    drawLabel(ctx, section.label, section.x, IMAGE_SECTION_LABEL_Y);
    drawLabel(ctx, 'Min†', section.x + IMAGE_MINMAX_X_OFFSET, IMAGE_SECTION_MINMAX_Y - 44, 8);
    drawLabel(ctx, 'Max‡', section.x + IMAGE_MAX_X_OFFSET, IMAGE_SECTION_MINMAX_Y - 44, 8);
    drawValue(
      ctx,
      section.min.value,
      section.x + IMAGE_MINMAX_X_OFFSET,
      IMAGE_SECTION_MINMAX_Y,
      section.min.unit,
      40,
    );
    drawValue(
      ctx,
      section.max.value,
      section.x + IMAGE_MAX_X_OFFSET,
      IMAGE_SECTION_MINMAX_Y,
      section.max.unit,
      40,
    );

    ctx.save();
    ctx.font = `italic 400 13px ${IMAGE_FONT_SERIF}`;
    ctx.fillStyle = IMAGE_TEXT_FAINT;
    ctx.textBaseline = 'alphabetic';
    drawWrappedText(
      ctx,
      section.minSub,
      section.x + IMAGE_MINMAX_X_OFFSET,
      IMAGE_SECTION_SUB_Y,
      IMAGE_TEXT_COLUMN_WIDTH,
      17,
    );
    drawWrappedText(
      ctx,
      section.maxSub,
      section.x + IMAGE_MAX_X_OFFSET,
      IMAGE_SECTION_SUB_Y,
      IMAGE_TEXT_COLUMN_WIDTH,
      17,
    );
    ctx.restore();
  }

  // Cost sections mirror the DOM's two-column CostContainer. Each section has
  // its own Min/Max row, and the daily unit follows each value.
  const costSections = [
    {
      x: IMAGE_SECTION_X[0],
      label: 'Data total Cost (to present)*',
      min: costs.totalMin,
      max: costs.totalMax,
    },
    {
      x: IMAGE_SECTION_X[1],
      label: 'Data cost per Day*',
      min: costs.dailyMin,
      max: costs.dailyMax,
    },
  ];
  for (const section of costSections) {
    drawLabel(ctx, section.label, section.x, IMAGE_COST_LABEL_Y);
    drawLabel(ctx, 'Min†', section.x + IMAGE_MINMAX_X_OFFSET, IMAGE_COST_MINMAX_Y, 8);
    drawLabel(ctx, 'Max‡', section.x + IMAGE_MAX_X_OFFSET, IMAGE_COST_MINMAX_Y, 8);
    drawCostValue(
      ctx,
      section.min,
      section.x + IMAGE_MINMAX_X_OFFSET,
      IMAGE_COST_VALUE_Y,
      IMAGE_TEXT_COLUMN_WIDTH,
      section === costSections[1] ? '/day' : undefined,
    );
    drawCostValue(
      ctx,
      section.max,
      section.x + IMAGE_MAX_X_OFFSET,
      IMAGE_COST_VALUE_Y,
      IMAGE_TEXT_COLUMN_WIDTH,
      section === costSections[1] ? '/day' : undefined,
    );
  }
};

const copyCanvasToClipboard = (canvas: HTMLCanvasElement) => {
  return new Promise<void>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('Could not encode canvas image'));
        return;
      }

      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': blob,
          }),
        ]);
        resolve();
      } catch (err) {
        // Safari does not support ClipboardItem with images. Fall back to a
        // legacy copy: select a hidden image element so the PNG lands on the
        // clipboard as a normal copy.
        try {
          const img = document.createElement('img');
          img.src = canvas.toDataURL('image/png');
          img.style.position = 'fixed';
          img.style.left = '-9999px';
          img.style.width = '2px';
          img.style.height = '2px';
          document.body.appendChild(img);

          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(img);
          selection?.removeAllRanges();
          selection?.addRange(range);

          const ok = document.execCommand('copy');
          selection?.removeAllRanges();
          img.remove();

          if (!ok) {
            reject(err);
            return;
          }
          resolve();
        } catch (fallbackErr) {
          reject(fallbackErr);
        }
      }
    }, 'image/png');
  });
};

export const DaysSince: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, amount: 0.1 });

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!isInView) return;
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, [isInView]);

  const minModels = CHANNEL_SAMPLE_RATES_HZ.map((sampleRateHz) =>
    getRawIfftModel(sampleRateHz, MIN_TARGET_HZ, BYTES_PER_IQ_SAMPLE.u8),
  );
  const maxModels = CHANNEL_SAMPLE_RATES_HZ.map((sampleRateHz) =>
    getRawIfftModel(sampleRateHz, MAX_TARGET_HZ, BYTES_PER_IQ_SAMPLE.u16),
  );
  const calculatedMinRateMbs = minModels.reduce(
    (total, model) => total + model.rateBytesPerSecond,
    0,
  ) / 1_000_000;
  const maxRateMbs = maxModels.reduce(
    (total, model) => total + model.rateBytesPerSecond,
    0,
  ) / 1_000_000;
  const minRateMbs = calculatedMinRateMbs || DEFAULT_RATE_MBS;


  const stats = useMemo(() => {
    const totalMs = now.getTime() - START_DATE.getTime();
    const escalationMs = now.getTime() - ESCALATION_DATE.getTime();

    const totalSeconds = totalMs / 1000;
    const totalHours = totalSeconds / 3600;
    const totalDays = totalSeconds / 86400;

    const escalationHours = escalationMs / 3600000;

    return {
      totalHours,
      escalationHours,
      totalDays,
    };
  }, [now]);

  const formatGbVal = (gb: number) => {
    if (gb >= 1_000_000_000) {
      return { val: (gb / 1_000_000_000).toFixed(3), unit: 'EB' };
    }
    if (gb >= 1_000_000) {
      return { val: (gb / 1_000_000).toFixed(3), unit: 'PB' };
    }
    if (gb >= 1000) {
      return { val: (gb / 1000).toFixed(2), unit: 'TB' };
    }
    if (gb < 1) {
      const mb = gb * 1000;
      return { val: mb.toFixed(mb < 10 ? 1 : 0), unit: 'MB' };
    }
    return { val: gb.toFixed(1), unit: 'GB' };
  };

  const dataMin = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalGB = (totalSeconds * minRateMbs) / 1000;
    return formatGbVal(totalGB);
  }, [now, minRateMbs]);

  const dataMax = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalGB = (totalSeconds * maxRateMbs) / 1000;
    return formatGbVal(totalGB);
  }, [now, maxRateMbs]);

  const comparisonTypes = useMemo(() => {
    const options = [
      { label: '4K movies', sizeMB: 25 * 1000 },
      { label: 'HD movies', sizeMB: 5 * 1000 },
      { label: 'TikTok videos', sizeMB: 15 },
      { label: 'Spotify songs', sizeMB: 5 },
      { label: 'iPhone-shot photos', sizeMB: 3 },
      { label: 'tweets', sizeMB: 0.003 },
      { label: 'emails', sizeMB: 0.075 },
      { label: 'Wikipedia pages', sizeMB: 0.15 },
    ];

    const shuffled = [...options].sort(() => Math.random() - 0.5);
    return {
      total: shuffled[0],
      daily: shuffled[1],
    };
  }, []);

  const formatComparisonCount = (count: number) => {
    if (count >= 1e15) return `${(count / 1e15).toFixed(1)} quadrillion`;
    if (count >= 1e12) return `${(count / 1e12).toFixed(1)} trillion`;
    if (count >= 1e9) return `${(count / 1e9).toFixed(1)} billion`;
    if (count >= 1e6) return `${(count / 1e6).toFixed(1)} million`;
    if (count >= 1000) return new Intl.NumberFormat().format(Math.round(count));
    return count.toFixed(0);
  };

  const totalComparisonTextMin = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalMB = totalSeconds * minRateMbs;
    const count = totalMB / comparisonTypes.total.sizeMB;
    return `or ${formatComparisonCount(count)} ${comparisonTypes.total.label}`;
  }, [now, minRateMbs, comparisonTypes.total]);

  const totalComparisonTextMax = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalMB = totalSeconds * maxRateMbs;
    const count = totalMB / comparisonTypes.total.sizeMB;
    return `or ${formatComparisonCount(count)} ${comparisonTypes.total.label}`;
  }, [now, maxRateMbs, comparisonTypes.total]);

  const dailyComparisonTextMin = useMemo(() => {
    const dailyMB = minRateMbs * 86400;
    const count = dailyMB / comparisonTypes.daily.sizeMB;
    return `or ${formatComparisonCount(count)} ${comparisonTypes.daily.label}`;
  }, [minRateMbs, comparisonTypes.daily]);

  const dailyComparisonTextMax = useMemo(() => {
    const dailyMB = maxRateMbs * 86400;
    const count = dailyMB / comparisonTypes.daily.sizeMB;
    return `or ${formatComparisonCount(count)} ${comparisonTypes.daily.label}`;
  }, [maxRateMbs, comparisonTypes.daily]);

  const dailyDataMin = useMemo(() => {
    const dailyGB = (minRateMbs * 86400) / 1000;
    return formatGbVal(dailyGB);
  }, [minRateMbs]);

  const dailyDataMax = useMemo(() => {
    const dailyGB = (maxRateMbs * 86400) / 1000;
    return formatGbVal(dailyGB);
  }, [maxRateMbs]);

  const costs = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalGBMin = (totalSeconds * minRateMbs) / 1000;
    const totalGBMax = (totalSeconds * maxRateMbs) / 1000;
    const dailyGBMin = (minRateMbs * 86400) / 1000;
    const dailyGBMax = (maxRateMbs * 86400) / 1000;

    return {
      totalMin: `${formatCurrency(totalGBMin * 0.07)} – ${formatCurrency(totalGBMin * 0.12)}`,
      totalMax: `${formatCurrency(totalGBMax * 0.07)} – ${formatCurrency(totalGBMax * 0.12)}`,
      dailyMin: `${formatCurrency(dailyGBMin * 0.07)} – ${formatCurrency(dailyGBMin * 0.12)}`,
      dailyMax: `${formatCurrency(dailyGBMax * 0.07)} – ${formatCurrency(dailyGBMax * 0.12)}`,
    };
  }, [now, minRateMbs, maxRateMbs]);

  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  const handleCopyImage = useCallback(async () => {
    const canvas = document.createElement('canvas');
    renderImage(
      canvas,
      stats,
      costs,
      dataMin,
      dataMax,
      dailyDataMin,
      dailyDataMax,
      totalComparisonTextMin,
      totalComparisonTextMax,
      dailyComparisonTextMin,
      dailyComparisonTextMax,
    );

    try {
      await copyCanvasToClipboard(canvas);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      // Clipboard unavailable (e.g. non-secure context) — leave state unchanged.
    }
  }, [
    stats,
    costs,
    dataMin,
    dataMax,
    dailyDataMin,
    dailyDataMax,
    totalComparisonTextMin,
    totalComparisonTextMax,
    dailyComparisonTextMin,
    dailyComparisonTextMax,
  ]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  return (
    <Container ref={containerRef}>
      <CopyRow>
        <CopyButton
          type="button"
          onClick={() => void handleCopyImage()}
          data-copied={copied}
          aria-label={copied ? 'Copied' : 'Copy stats as image'}
          title={copied ? 'Copied!' : 'Copy stats as image'}
        >
          {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={2} />}
        </CopyButton>
      </CopyRow>
      <TopRow>
        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5 }}
        >
          <Label>Hours Total</Label>
          <Value>
            <RollingCounter value={formatNumber(stats.totalHours)} animateActive={isInView} />
            <span className="unit">hrs</span>
          </Value>
        </StatBox>

        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Label>Since Escalation</Label>
          <Value>
            <RollingCounter value={formatNumber(stats.escalationHours)} animateActive={isInView} />
            <span className="unit">hrs</span>
          </Value>
        </StatBox>

        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Label>Days Total</Label>
          <Value>
            <RollingCounter value={formatNumber(stats.totalDays)} animateActive={isInView} />
            <span className="unit">days</span>
          </Value>
        </StatBox>
      </TopRow>

      <DataContainer>
        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Label>Data Intercepted Total</Label>
          <DataMinMaxGrid>
            <div>
              <SubLabel>Min<sup>†</sup></SubLabel>
              <Value>
                <RollingCounter value={dataMin.val} animateActive={isInView} />
                <span className="unit">{dataMin.unit}</span>
              </Value>
              <SubValue>{totalComparisonTextMin}</SubValue>
            </div>
            <div>
              <SubLabel>Max<sup>‡</sup></SubLabel>
              <Value>
                <RollingCounter value={dataMax.val} animateActive={isInView} />
                <span className="unit">{dataMax.unit}</span>
              </Value>
              <SubValue>{totalComparisonTextMax}</SubValue>
            </div>
          </DataMinMaxGrid>
        </StatBox>

        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <Label>Data Intercepted in 24HRS</Label>
          <DataMinMaxGrid>
            <div>
              <SubLabel>Min<sup>†</sup></SubLabel>
              <Value>
                <RollingCounter value={dailyDataMin.val} animateActive={isInView} />
                <span className="unit">{dailyDataMin.unit}</span>
              </Value>
              <SubValue>{dailyComparisonTextMin}</SubValue>
            </div>
            <div>
              <SubLabel>Max<sup>‡</sup></SubLabel>
              <Value>
                <RollingCounter value={dailyDataMax.val} animateActive={isInView} />
                <span className="unit">{dailyDataMax.unit}</span>
              </Value>
              <SubValue>{dailyComparisonTextMax}</SubValue>
            </div>
          </DataMinMaxGrid>
        </StatBox>
      </DataContainer>

      <CostContainer>
        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <Label>Data total Cost (to present)*</Label>
          <MinMaxGrid>
            <div>
              <SubLabel>Min<sup>†</sup></SubLabel>
              <Value>
                <RollingCounter value={costs.totalMin} animateActive={isInView} />
              </Value>
            </div>
            <div>
              <SubLabel>Max<sup>‡</sup></SubLabel>
              <Value>
                <RollingCounter value={costs.totalMax} animateActive={isInView} />
              </Value>
            </div>
          </MinMaxGrid>
        </StatBox>

        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <Label>Data cost per Day*</Label>
          <MinMaxGrid>
            <div>
              <SubLabel>Min<sup>†</sup></SubLabel>
              <Value>
                <RollingCounter value={costs.dailyMin} animateActive={isInView} />
                <span className="unit">/day</span>
              </Value>
            </div>
            <div>
              <SubLabel>Max<sup>‡</sup></SubLabel>
              <Value>
                <RollingCounter value={costs.dailyMax} animateActive={isInView} />
                <span className="unit">/day</span>
              </Value>
            </div>
          </MinMaxGrid>
        </StatBox>
      </CostContainer>
    </Container>
  );
};
