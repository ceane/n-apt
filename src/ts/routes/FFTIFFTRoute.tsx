import React from "react";
import styled from "styled-components";
import FaqLayout from "@n-apt/components/FaqLayout";
import FFTIFFTCanvasGraphic from "@n-apt/components/canvas/FFTIFFTCanvasGraphic";

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
  scroll-margin-top: 24px;
`;

const Body = styled.p`
  margin: 0 0 12px;
  color: ${(props) => props.theme.textSecondary};
  font-size: 15px;
  line-height: 1.7;
`;

const List = styled.ul`
  margin: 0;
  padding-left: 20px;
  color: ${(props) => props.theme.textSecondary};
  font-size: 15px;
  line-height: 1.7;

  li + li {
    margin-top: 8px;
  }
`;

const faqSections = [
  { href: "#top", label: "Top" },
  { href: "#what-is-fft", label: "What is FFT?" },
  { href: "#what-is-ifft", label: "What is IFFT?" },
  { href: "#how-n-apt-uses-fft-and-ifft", label: "How N-APT uses FFT & IFFT" },
  { href: "#key-parameters-and-properties", label: "Key parameters & properties" },
];

export const FFTIFFTRoute: React.FC = () => (
  <FaqLayout sections={faqSections}>
    <div id="top">
      <Eyebrow>Signal processing &amp; transform operations</Eyebrow>
      <Heading>
        FFT (Fast Fourier Transform) and IFFT (Inverse Fast Fourier Transform)
      </Heading>
      <Intro>
        The Fast Fourier Transform (FFT) converts time-domain radio signals into
        frequency spectrums, while the Inverse Fast Fourier Transform (IFFT)
        converts frequency-domain representations back into continuous
        time-domain signals.
      </Intro>

      <FFTIFFTCanvasGraphic />

      <Section id="what-is-fft">
        <SectionHeading>What is FFT?</SectionHeading>
        <Body>
          The Fast Fourier Transform (FFT) is an efficient algorithm to compute
          the Discrete Fourier Transform (DFT). It takes a block of raw time-domain
          in-phase and quadrature (I/Q) radio samples and calculates the amplitude and
          phase of each frequency component present within that signal slice.
        </Body>
        <Body>
          Instead of looking at how signal amplitude changes over time, FFT
          allows N-APT to show you what frequencies exist across your selected spectrum
          span, rendering real-time power levels in decibels (dB).
        </Body>
      </Section>

      <Section id="what-is-ifft">
        <SectionHeading>What is IFFT?</SectionHeading>
        <Body>
          The Inverse Fast Fourier Transform (IFFT) performs the reverse mathematical
          operation. It converts frequency-domain spectral amplitudes and phases back
          into time-domain I/Q sample buffers.
        </Body>
        <Body>
          IFFT is essential for signal synthesis, filtering, and modulation formats such
          as OFDM (Orthogonal Frequency Division Multiplexing), where data is mapped onto
          frequency subcarriers and converted into continuous time-domain waveforms for transmission.
        </Body>
      </Section>

      <Section id="how-n-apt-uses-fft-and-ifft">
        <SectionHeading>How N-APT uses FFT &amp; IFFT</SectionHeading>
        <List>
          <li>
            <strong>Real-time Visualization:</strong> N-APT executes high-speed FFTs using WebGPU
            compute shaders and WebAssembly (WASM SIMD) to render live 2D/3D spectrum graphs and
            waterfall displays at high frame rates.
          </li>
          <li>
            <strong>Signal Synthesis:</strong> When drawing or editing transmit signals in N-APT,
            IFFT converts your visual frequency mask into complex I/Q samples ready for transmission.
          </li>
          <li>
            <strong>Filtering &amp; Demodulation:</strong> Frequency-selective filters apply FFT to
            isolate target channels before running demodulators (AM, FM, SSB, NFM).
          </li>
        </List>
      </Section>

      <Section id="key-parameters-and-properties">
        <SectionHeading>Key parameters &amp; properties</SectionHeading>
        <List>
          <li>
            <strong>FFT Size (N):</strong> The number of points used per transform (e.g., 512, 1024, 2048, 4096).
            Larger FFT sizes increase frequency resolution (narrower bins) at the cost of higher latency.
          </li>
          <li>
            <strong>Sample Rate (f<sub>s</sub>):</strong> Determines the total visible radio bandwidth
            (&plusmn;f<sub>s</sub> / 2 around center frequency).
          </li>
          <li>
            <strong>Windowing Functions:</strong> Windowing (such as Hann, Blackman-Harris, or Hamming)
            tapers sample block edges to reduce spectral leakage across discrete FFT bin boundaries.
          </li>
        </List>
      </Section>
    </div>
  </FaqLayout>
);

export default FFTIFFTRoute;
