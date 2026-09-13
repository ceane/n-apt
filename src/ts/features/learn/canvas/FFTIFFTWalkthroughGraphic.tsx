import React from "react";
import styled, { useTheme } from "styled-components";
import type { AppStyledTheme } from "@n-apt/ui/Theme";
import {
  FFT_LESSON_FFT_SIZE,
  calculateBinWidth,
  createLessonNaturalWaveformSamples,
  createLessonSpectrumTraceFromSamples,
  createLessonWaveformPoints,
  getBinCenters,
  twiddleFactor,
  butterfly,
  type Complex,
} from "@n-apt/learn/canvas/fftLessonMath";

const GraphicCard = styled.figure`
  margin: 0 0 40px;
  padding: 16px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  background: ${(props) => props.theme.surface};
  overflow-x: auto;
`;

const GraphicSvg = styled.svg`
  display: block;
  width: 100%;
  min-width: 680px;
  height: auto;
`;

const SAMPLE_RATE_HZ = 8_000;
const WAVEFORM_POINTS = createLessonWaveformPoints();
const NATURAL_WAVEFORM_SAMPLES = createLessonNaturalWaveformSamples();
const BIN_WIDTH_HZ = calculateBinWidth(SAMPLE_RATE_HZ, FFT_LESSON_FFT_SIZE);
const BIN_CENTERS_HZ = getBinCenters(SAMPLE_RATE_HZ, FFT_LESSON_FFT_SIZE);
const SPECTRUM_TRACE = createLessonSpectrumTraceFromSamples(
  NATURAL_WAVEFORM_SAMPLES,
  SAMPLE_RATE_HZ,
);

const cleanZero = (value: number): number =>
  Math.abs(value) < 0.005 ? 0 : value;

const formatComplex = ({ real, imaginary }: Complex): string => {
  const roundedReal = cleanZero(real).toFixed(1);
  const roundedImaginary = cleanZero(Math.abs(imaginary)).toFixed(1);
  const sign = imaginary < 0 ? "−" : "+";
  return `${roundedReal} ${sign} j${roundedImaginary}`;
};

const buildPath = (
  values: number[],
  xStart: number,
  xEnd: number,
  baseline: number,
  scale: number,
): string =>
  values
    .map((value, index) => {
      const x =
        xStart + (index / Math.max(values.length - 1, 1)) * (xEnd - xStart);
      const y = baseline - value * scale;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

const textLines = (
  lines: string[],
  x: number,
  y: number,
  props: { fill: string; fontSize?: number; fontWeight?: number },
) => (
  <text x={x} y={y} {...props}>
    {lines.map((line, index) => (
      <tspan key={line} x={x} dy={index === 0 ? 0 : 20}>
        {line}
      </tspan>
    ))}
  </text>
);

const StageCard: React.FC<{
  y: number;
  height: number;
  theme: AppStyledTheme["colors"];
}> = ({ y, height, theme }) => (
  <rect
    x="36"
    y={y}
    width="928"
    height={height}
    rx="16"
    fill={theme.background}
    stroke={theme.border}
    strokeWidth="2"
  />
);

const StageTitle: React.FC<{
  x: number;
  y: number;
  children: React.ReactNode;
  theme: AppStyledTheme["colors"];
}> = ({ x, y, children, theme }) => (
  <text
    x={x}
    y={y}
    fill={theme.primary}
    fontFamily="monospace"
    fontSize="20"
    fontWeight="700"
  >
    {children}
  </text>
);

const StageCopy: React.FC<{
  x: number;
  y: number;
  children: React.ReactNode;
  theme: AppStyledTheme["colors"];
}> = ({ x, y, children, theme }) => (
  <text
    x={x}
    y={y}
    fill={theme.textSecondary}
    fontFamily="sans-serif"
    fontSize="15"
  >
    {children}
  </text>
);

const FREQUENCY_TICKS = [
  { x: 130, label: "0 kHz" },
  { x: 322.5, label: "2 kHz" },
  { x: 515, label: "4 kHz" },
  { x: 707.5, label: "6 kHz" },
  { x: 900, label: "8 kHz" },
];

const FrequencyAxis: React.FC<{
  y: number;
  theme: AppStyledTheme["colors"];
}> = ({ y, theme }) => (
  <g data-testid="fft-frequency-axis">
    <line x1="130" y1={y} x2="900" y2={y} stroke={theme.borderHover} />
    {FREQUENCY_TICKS.map(({ x, label }) => (
      <g key={label}>
        <line x1={x} y1={y} x2={x} y2={y + 7} stroke={theme.borderHover} />
        <text
          x={x}
          y={y + 23}
          textAnchor={x === 130 ? "start" : x === 900 ? "end" : "middle"}
          fill={theme.textMuted}
          fontFamily="monospace"
          fontSize="12"
        >
          {label}
        </text>
      </g>
    ))}
  </g>
);

const DownArrow: React.FC<{ y: number; theme: AppStyledTheme["colors"] }> = ({
  y,
  theme,
}) => (
  <text
    x="500"
    y={y + 28}
    textAnchor="middle"
    fill={theme.primary}
    fontFamily="sans-serif"
    fontSize="28"
    fontWeight="700"
    aria-hidden="true"
  >
    ↓
  </text>
);

export const FFTIFFTWalkthroughGraphic: React.FC = () => {
  const theme = useTheme() as AppStyledTheme;
  const colors = theme.colors;
  const inputValues = WAVEFORM_POINTS.map((point) => point.value);
  const sampleXStart = 130;
  const sampleXEnd = 900;
  const sampleBaseline = 510;
  const stageOnePath = buildPath(inputValues, 130, 900, 210, 90);
  const naturalWaveformPath = buildPath(
    NATURAL_WAVEFORM_SAMPLES,
    sampleXStart,
    sampleXEnd,
    sampleBaseline,
    0.6,
  );
  const twiddle = twiddleFactor(2, FFT_LESSON_FFT_SIZE);
  const butterflyResult = butterfly(
    { real: 1, imaginary: 2 },
    { real: 3, imaginary: 4 },
    twiddle,
  );

  return (
    <GraphicCard>
      <GraphicSvg
        viewBox="0 0 1000 2180"
        role="img"
        aria-labelledby="fft-walkthrough-title fft-walkthrough-description"
      >
        <title id="fft-walkthrough-title">
          How an FFT turns sampled points into a magnitude spectrum
        </title>
        <desc id="fft-walkthrough-description">
          Six connected stages show one sine-wave cycle, 2,048 natural waveform
          sample points, frequency bins, a twiddle factor, a radix-two
          butterfly, and a two-sided magnitude waveform.
        </desc>
        <defs>
          <marker
            id="fft-walkthrough-arrow"
            markerWidth="12"
            markerHeight="12"
            refX="10"
            refY="6"
            orient="auto"
          >
            <path d="M0,0 L12,6 L0,12 Z" fill={colors.primary} />
          </marker>
          <linearGradient
            id="fft-walkthrough-spectrum"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0" stopColor={colors.primary} stopOpacity="0.8" />
            <stop offset="1" stopColor={colors.primary} stopOpacity="0.15" />
          </linearGradient>
        </defs>

        <StageCard y={30} height={250} theme={colors} />
        <StageTitle x={70} y={72} theme={colors}>
          1. One sine-wave cycle
        </StageTitle>
        <StageCopy x={70} y={102} theme={colors}>
          A smooth curve is the idealized signal we want to understand.
        </StageCopy>
        <line
          x1="130"
          y1="210"
          x2="900"
          y2="210"
          stroke={colors.borderHover}
          strokeDasharray="5 5"
        />
        <path
          d={stageOnePath}
          fill="none"
          stroke={colors.primary}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <text
          x="130"
          y="248"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="13"
        >
          time →
        </text>
        <text
          x="902"
          y="205"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="13"
        >
          amplitude
        </text>

        <DownArrow y={285} theme={colors} />

        <StageCard y={330} height={325} theme={colors} />
        <StageTitle x={70} y={372} theme={colors}>
          2. Two-sided / Natural waveform
        </StageTitle>
        {textLines(
          [
            "The radio stores 2,048 discrete amplitudes. This natural waveform is centered on 0:",
            "positive peaks rise above it and negative troughs fall below it.",
          ],
          70,
          402,
          { fill: colors.textSecondary, fontSize: 15 },
        )}
        <line
          x1={sampleXStart}
          y1={sampleBaseline}
          x2={sampleXEnd}
          y2={sampleBaseline}
          stroke={colors.borderHover}
          strokeDasharray="5 5"
        />
        <path
          d={naturalWaveformPath}
          fill="none"
          stroke={colors.primary}
          strokeWidth="1"
          strokeLinejoin="round"
          opacity="0.85"
        />
        {NATURAL_WAVEFORM_SAMPLES.map((value, index) => {
          const x =
            sampleXStart +
            (index / (NATURAL_WAVEFORM_SAMPLES.length - 1)) *
              (sampleXEnd - sampleXStart);
          return (
            <circle
              key={index}
              data-testid="fft-natural-sample-point"
              cx={x}
              cy={sampleBaseline - value * 0.55}
              r="0.85"
              fill={colors.primary}
              opacity="0.8"
            />
          );
        })}
        <text
          x="92"
          y="430"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="12"
        >
          +127
        </text>
        <text
          x="92"
          y={sampleBaseline + 5}
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="12"
        >
          0
        </text>
        <text
          x="92"
          y="590"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="12"
        >
          −128
        </text>
        <FrequencyAxis y={598} theme={colors} />
        <text
          x="130"
          y="643"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="13"
        >
          frequency →
        </text>
        <text
          x="900"
          y="643"
          textAnchor="end"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="13"
        >
          2,048 points / FFT size
        </text>

        <DownArrow y={650} theme={colors} />

        <StageCard y={680} height={300} theme={colors} />
        <StageTitle x={70} y={722} theme={colors}>
          3. Frequency bins
        </StageTitle>
        {textLines(
          [
            "The sample rate sets the captured span. FFT size divides that span into N frequency slots.",
            "The FFT does not measure every individual Hz; each bar represents one bin.",
          ],
          70,
          752,
          { fill: colors.textSecondary, fontSize: 15 },
        )}
        <text
          x="70"
          y="822"
          fill={colors.textPrimary}
          fontFamily="monospace"
          fontSize="18"
          fontWeight="700"
        >
          bin width = sample rate ÷ FFT size = 8 kHz ÷ 8 = 1 kHz/bin
        </text>
        {BIN_CENTERS_HZ.map((center, index) => {
          const x = 130 + index * 95;
          const highlighted = index === 5;
          return (
            <g key={center}>
              <rect
                x={x}
                y="850"
                width="94"
                height="54"
                fill={highlighted ? colors.primary : colors.surfaceHover}
                fillOpacity={highlighted ? 0.3 : 1}
                stroke={highlighted ? colors.primary : colors.borderHover}
              />
              <text
                x={x + 47}
                y="882"
                textAnchor="middle"
                fill={colors.textPrimary}
                fontFamily="monospace"
                fontSize="13"
              >
                k={center / BIN_WIDTH_HZ}
              </text>
            </g>
          );
        })}
        <text
          x="130"
          y="934"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="13"
        >
          −fₛ/2
        </text>
        <text
          x="510"
          y="934"
          textAnchor="middle"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="13"
        >
          0 Hz
        </text>
        <text
          x="900"
          y="934"
          textAnchor="end"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="13"
        >
          +fₛ/2
        </text>

        <DownArrow y={985} theme={colors} />

        <StageCard y={1030} height={300} theme={colors} />
        <StageTitle x={70} y={1072} theme={colors}>
          4. Twiddle factor
        </StageTitle>
        <StageCopy x={70} y={1102} theme={colors}>
          A twiddle is a rotating complex reference used to compare each sample
          with a frequency.
        </StageCopy>
        <text
          x="70"
          y="1142"
          fill={colors.textPrimary}
          fontFamily="monospace"
          fontSize="18"
          fontWeight="700"
        >
          Wₙᵏ = e⁻ʲ²πᵏ⁄ⁿ
        </text>
        <circle
          cx="290"
          cy="1220"
          r="82"
          fill="none"
          stroke={colors.borderHover}
          strokeWidth="2"
        />
        <line
          x1="190"
          y1="1220"
          x2="390"
          y2="1220"
          stroke={colors.borderHover}
        />
        <line
          x1="290"
          y1="1120"
          x2="290"
          y2="1320"
          stroke={colors.borderHover}
        />
        <line
          x1="290"
          y1="1220"
          x2="290"
          y2="1302"
          stroke={colors.secondary}
          strokeWidth="5"
          markerEnd="url(#fft-walkthrough-arrow)"
        />
        <circle cx="290" cy="1302" r="6" fill={colors.secondary} />
        <text
          x="305"
          y="1280"
          fill={colors.secondary}
          fontFamily="monospace"
          fontSize="14"
        >
          k=2, N=8
        </text>
        <text
          x="510"
          y="1190"
          fill={colors.textSecondary}
          fontFamily="monospace"
          fontSize="16"
        >
          W₈² = e⁻ʲ²π(2)⁄8 = −j
        </text>
        <text
          x="510"
          y="1230"
          fill={colors.textMuted}
          fontFamily="sans-serif"
          fontSize="15"
        >
          Multiplying by a twiddle rotates
        </text>
        <text
          x="510"
          y="1252"
          fill={colors.textMuted}
          fontFamily="sans-serif"
          fontSize="15"
        >
          a complex value without changing
        </text>
        <text
          x="510"
          y="1274"
          fill={colors.textMuted}
          fontFamily="sans-serif"
          fontSize="15"
        >
          the basic idea of the sample.
        </text>

        <DownArrow y={1335} theme={colors} />

        <StageCard y={1380} height={330} theme={colors} />
        <StageTitle x={70} y={1422} theme={colors}>
          5. Butterfly
        </StageTitle>
        <StageCopy x={70} y={1452} theme={colors}>
          Each butterfly combines two values with one twiddle, then emits a sum
          and a difference.
        </StageCopy>
        <text
          x="70"
          y="1492"
          fill={colors.textPrimary}
          fontFamily="monospace"
          fontSize="16"
        >
          outputs = a + Wb and a − Wb
        </text>
        <g
          fill="none"
          stroke={colors.borderHover}
          strokeWidth="2"
          markerEnd="url(#fft-walkthrough-arrow)"
        >
          <path d="M180 1560 C300 1560 330 1515 420 1515" />
          <path d="M180 1620 C300 1620 330 1585 420 1585" />
          <path d="M520 1515 C620 1515 660 1550 760 1550" />
          <path d="M520 1585 C620 1585 660 1630 760 1630" />
        </g>
        <text
          x="150"
          y="1555"
          fill={colors.primary}
          fontFamily="monospace"
          fontSize="18"
        >
          a
        </text>
        <text
          x="150"
          y="1625"
          fill={colors.secondary}
          fontFamily="monospace"
          fontSize="18"
        >
          b
        </text>
        <text
          x="430"
          y="1508"
          fill={colors.textPrimary}
          fontFamily="monospace"
          fontSize="16"
        >
          a
        </text>
        <text
          x="430"
          y="1580"
          fill={colors.textPrimary}
          fontFamily="monospace"
          fontSize="16"
        >
          Wb
        </text>
        <text
          x="765"
          y="1545"
          fill={colors.primary}
          fontFamily="monospace"
          fontSize="16"
        >
          a + Wb
        </text>
        <text
          x="765"
          y="1625"
          fill={colors.secondary}
          fontFamily="monospace"
          fontSize="16"
        >
          a − Wb
        </text>
        <text
          x="150"
          y="1680"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="13"
        >
          {formatComplex({ real: 1, imaginary: 2 })}
        </text>
        <text
          x="310"
          y="1680"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="13"
        >
          Wb = {formatComplex(butterflyResult.twiddledB)}
        </text>
        <text
          x="610"
          y="1680"
          fill={colors.textMuted}
          fontFamily="monospace"
          fontSize="13"
        >
          {formatComplex(butterflyResult.sum)} /{" "}
          {formatComplex(butterflyResult.difference)}
        </text>

        <DownArrow y={1735} theme={colors} />

        <StageCard y={1780} height={380} theme={colors} />
        <StageTitle x={70} y={1822} theme={colors}>
          6. Magnitude based waveform
        </StageTitle>
        <StageCopy x={70} y={1852} theme={colors}>
          The same 2,048-point block becomes a magnitude based waveform:
          frequency runs left to right and measured energy runs upward.
        </StageCopy>
        {[0, 30, 60, 90, 120].map((db) => {
          const y = 1890 + (db / 120) * 180;
          return (
            <g key={db}>
              <line
                x1="130"
                y1={y}
                x2="900"
                y2={y}
                stroke={colors.borderHover}
                strokeOpacity="0.7"
              />
              <text
                x="118"
                y={y + 5}
                textAnchor="end"
                fill={colors.textMuted}
                fontFamily="monospace"
                fontSize="12"
              >
                {db === 0 ? "0 dB" : `−${db}`}
              </text>
            </g>
          );
        })}
        <path
          data-testid="fft-magnitude-fill"
          d={`${buildPath(
            SPECTRUM_TRACE.map((point) => point.magnitude),
            130,
            900,
            2070,
            180,
          )} L900,2070 L130,2070 Z`}
          fill={colors.fftShadow}
          stroke="none"
        />
        <path
          data-testid="fft-magnitude-trace"
          d={buildPath(
            SPECTRUM_TRACE.map((point) => point.magnitude),
            130,
            900,
            2070,
            180,
          )}
          fill="none"
          stroke={colors.primary}
          strokeWidth="1"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.85"
        />
        <FrequencyAxis y={2080} theme={colors} />
      </GraphicSvg>
    </GraphicCard>
  );
};

export default FFTIFFTWalkthroughGraphic;
