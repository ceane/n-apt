import React from "react";
import styled from "styled-components";

const Eyebrow = styled.p`
  margin: 0 0 12px;
  color: ${(props) => props.theme.primary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const Heading = styled.h1`
  margin: 0 0 20px;
  font-size: clamp(28px, 5vw, 44px);
  line-height: 1.1;
  color: ${(props) => props.theme.textPrimary};
`;

const Intro = styled.p`
  margin: 0 0 32px;
  color: ${(props) => props.theme.textSecondary};
  font-size: 18px;
  line-height: 1.6;
`;

const Section = styled.section`
  padding: 28px 0;
  border-top: 1px solid ${(props) => props.theme.border};
`;

const SectionHeading = styled.h2`
  margin: 0 0 14px;
  font-size: 22px;
  color: ${(props) => props.theme.textPrimary};
`;

const Body = styled.p`
  margin: 0 0 12px;
  color: ${(props) => props.theme.textSecondary};
  font-size: 15px;
  line-height: 1.7;
`;

const EquationCard = styled.div`
  margin: 0 0 32px;
  padding: 18px 20px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  background: ${(props) => props.theme.surfaceHover};
  color: ${(props) => props.theme.textPrimary};

  .katex-display {
    margin: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }
`;

const RMSEquation: React.FC = () => (
  <svg
    role="img"
    aria-label="RMS equals the square root of one over N times the sum of squared samples"
    viewBox="0 0 620 100"
    width="100%"
    height="100"
  >
    <g fill="currentColor" fontFamily="Georgia, serif" textAnchor="middle">
      <text x="74" y="62" fontSize="34" fontStyle="italic">RMS(x) =</text>
      <text x="178" y="63" fontSize="58">√</text>
      <text x="228" y="38" fontSize="22">1</text>
      <line x1="207" y1="48" x2="248" y2="48" stroke="currentColor" strokeWidth="2" />
      <text x="228" y="77" fontSize="22" fontStyle="italic">N</text>
      <text x="296" y="65" fontSize="34">Σ</text>
      <text x="296" y="22" fontSize="15" fontStyle="italic">N</text>
      <text x="296" y="91" fontSize="15" fontStyle="italic">n=1</text>
      <text x="375" y="62" fontSize="34" fontStyle="italic">x</text>
      <text x="397" y="42" fontSize="18">2</text>
      <text x="510" y="62" fontSize="17" opacity="0.7">effective amplitude</text>
    </g>
  </svg>
);

const GraphicCard = styled.div`
  margin: 0 0 32px;
  padding: 16px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  background: ${(props) => props.theme.surface};
`;

const RMSGraphic: React.FC = () => (
  <svg
    role="img"
    aria-label="RMS calculation flow"
    viewBox="0 0 900 250"
    width="100%"
    height="auto"
  >
    <defs>
      <marker id="rms-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
      </marker>
    </defs>
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="20" y="65" width="185" height="120" rx="12" opacity="0.18" />
      <rect x="250" y="65" width="145" height="120" rx="12" opacity="0.18" />
      <rect x="440" y="65" width="170" height="120" rx="12" opacity="0.18" />
      <rect x="655" y="65" width="220" height="120" rx="12" opacity="0.18" />
      <path d="M205 125 H242" markerEnd="url(#rms-arrow)" />
      <path d="M395 125 H432" markerEnd="url(#rms-arrow)" />
      <path d="M610 125 H647" markerEnd="url(#rms-arrow)" />
    </g>
    <g fontFamily="monospace" textAnchor="middle">
      <text x="112" y="94" fill="currentColor" fontSize="15" fontWeight="700">samples</text>
      <path d="M42 145 C62 110 80 175 100 140 S140 105 160 145 S185 160 192 130" fill="none" stroke="#0284c7" strokeWidth="3" />
      <text x="322" y="105" fill="currentColor" fontSize="15" fontWeight="700">square</text>
      <text x="322" y="140" fill="currentColor" fontSize="22">x²</text>
      <text x="525" y="105" fill="currentColor" fontSize="15" fontWeight="700">average</text>
      <text x="525" y="142" fill="currentColor" fontSize="22">Σx² / N</text>
      <text x="765" y="105" fill="currentColor" fontSize="15" fontWeight="700">square root</text>
      <text x="765" y="145" fill="currentColor" fontSize="22">√(Σx² / N)</text>
      <text x="450" y="225" fill="currentColor" fontSize="13" opacity="0.7">effective signal amplitude</text>
    </g>
  </svg>
);

export const RMSContent: React.FC = () => (
  <div id="top">
    <Eyebrow>Signal amplitude &amp; power</Eyebrow>
    <Heading>RMS</Heading>
    <Intro>
      RMS means <strong>root mean square</strong>. It is a way to describe the
      effective amplitude of a changing signal with one useful number.
    </Intro>

    <EquationCard aria-label="RMS equation">
      <RMSEquation />
    </EquationCard>

    <GraphicCard>
      <RMSGraphic />
    </GraphicCard>

    <Section id="what-is-rms">
      <SectionHeading>What does RMS mean?</SectionHeading>
      <Body>
        To calculate RMS, square each sample, find the average, then take the
        square root: <strong>RMS = √(average of sample²)</strong>. Squaring
        prevents positive and negative parts of an alternating waveform from
        cancelling each other out.
      </Body>
      <Body>
        RMS is therefore closer to the signal&apos;s practical strength than a
        simple average. A larger RMS value means more signal energy in the
        samples being measured.
      </Body>
    </Section>

    <Section id="rms-and-iq">
      <SectionHeading>RMS and I/Q samples</SectionHeading>
      <Body>
        N-APT works with complex I/Q samples: I is the in-phase component and Q
        is the quadrature component. For complex samples, the effective
        amplitude is based on both components, using the magnitude squared (I² +
        Q²) before averaging and taking the square root.
      </Body>
      <Body>
        This lets the app compare signal power consistently after an FFT or
        IFFT, even when the signal changes shape over time.
      </Body>
    </Section>

    <Section id="how-n-apt-uses-rms">
      <SectionHeading>How N-APT uses RMS</SectionHeading>
      <Body>
        N-APT uses RMS to normalize generated I/Q waveforms before transmit
        power scaling and to compare signal levels across processing stages. You
        may also see RMS-related values in diagnostics when the app checks
        whether a waveform has the expected effective amplitude.
      </Body>
    </Section>
  </div>
);

export default RMSContent;
