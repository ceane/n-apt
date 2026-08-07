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

export const RMSContent: React.FC = () => (
  <div id="top">
    <Eyebrow>Signal amplitude &amp; power</Eyebrow>
    <Heading>RMS</Heading>
    <Intro>
      RMS means <strong>root mean square</strong>. It is a way to describe the
      effective amplitude of a changing signal with one useful number.
    </Intro>

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
