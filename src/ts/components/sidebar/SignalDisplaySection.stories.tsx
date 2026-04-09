import React from "react";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { ThemeProvider } from "styled-components";

const theme = {
  primary: "#00d4ff",
  primaryAlpha: "rgba(0, 212, 255, 0.1)",
  primaryAnchor: "rgba(0, 212, 255, 0.05)",
  fft: "#00d4ff",
  mode: "dark",
};

const statusPayload = {
  sdr_settings: {
    sample_rate: 3200000,
    fft: {
      default_size: 262144,
      default_frame_rate: 12,
      max_size: 262144,
      max_frame_rate: 60,
      size_to_frame_rate: {
        8192: 60,
        16384: 60,
        32768: 60,
        65536: 48,
        131072: 24,
        262144: 12,
      },
    },
  },
};

const Template = () => {
  const [fftSize, setFftSize] = React.useState(statusPayload.sdr_settings.fft.default_size);
  const [frameRate, setFrameRate] = React.useState(statusPayload.sdr_settings.fft.default_frame_rate);
  const [window, setWindow] = React.useState("Hamming");
  const [res, setRes] = React.useState<"low" | "medium" | "high">("medium");
  const [scale, setScale] = React.useState<"dB" | "dBm">("dB");

  return (
    <ThemeProvider theme={theme as any}>
      <div style={{ padding: "20px", background: "#0a0a0a", width: "350px" }}>
        <SignalDisplaySection
          sourceMode="live"
          maxSampleRate={statusPayload.sdr_settings.sample_rate}
          fileCapturedRange={null}
          fftFrameRate={frameRate}
          maxFrameRate={statusPayload.sdr_settings.fft.max_frame_rate}
          fftSize={fftSize}
          fftSizeOptions={Object.keys(statusPayload.sdr_settings.fft.size_to_frame_rate).map(Number)}
          fftWindow={window}
          temporalResolution={res}
          autoFftOptions={null}
          backend="mock_apt"
          powerScale={scale}
          onFftFrameRateChange={setFrameRate}
          onFftSizeChange={setFftSize}
          onFftWindowChange={setWindow}
          onTemporalResolutionChange={setRes}
          onPowerScaleChange={setScale}
          scheduleCoupledAdjustment={(trigger, size, rate) => {
            if (trigger === "fftSize") {
              const recommendedRate = (statusPayload.sdr_settings.fft.size_to_frame_rate as any)[size] || rate;
              setFrameRate(recommendedRate);
            }
          }}
        />
      </div>
    </ThemeProvider>
  );
};

export const Default = () => <Template />;

export default {
  title: "Sidebar/SignalDisplaySection",
};
