import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { TestWrapper } from "./testUtils";

const baseProps = {
  variant: "default" as const,
  sourceMode: "live" as const,
  maxSampleRate: 20_000_000,
  minReceiveSampleRate: 3_200_000,
  sampleRateOptions: [
    3_200_000,
    4_000_000,
    5_000_000,
    12_800_000,
    20_000_000,
  ],
  wholeChannelSampleRate: 5_200_000,
  fileCapturedRange: null,
  fftFrameRate: 12,
  maxFrameRate: 60,
  fftSize: 262144,
  fftSizeOptions: [262144],
  fftWindow: "Rectangular",
  temporalResolution: "medium" as const,
  autoFftOptions: null,
  backend: "hackrf_one",
  deviceProfile: {
    kind: "hackrf_one" as const,
    is_rtl_sdr: false,
    supports_approx_dbm: false,
    supports_raw_iq_stream: true,
  },
  powerScale: "dB" as const,
  displayMode: "fft" as const,
  onFftFrameRateChange: jest.fn(),
  onFftSizeChange: jest.fn(),
  onFftWindowChange: jest.fn(),
  onTemporalResolutionChange: jest.fn(),
  onPowerScaleChange: jest.fn(),
  onDisplayModeChange: jest.fn(),
  scheduleCoupledAdjustment: jest.fn(),
};

describe("SignalDisplaySection sample rate selector", () => {
  it("shows whole-channel as an explicit option while keeping numeric selections sticky", () => {
    const onSampleRateChange = jest.fn();
    const { rerender } = render(
      <TestWrapper>
        <SignalDisplaySection
          {...baseProps}
          sampleRate={5_200_000}
          onSampleRateChange={onSampleRateChange}
        />
      </TestWrapper>,
    );

    const sampleRateRow = screen.getAllByText("Sample Rate")[0].closest("div")
      ?.parentElement as HTMLElement;
    const select = within(sampleRateRow).getByRole(
      "combobox",
    ) as HTMLSelectElement;
    expect(
      screen.getByRole("option", { name: "Whole Channel (5.2MHz)" }),
    ).toBeInTheDocument();
    expect(select).toHaveValue("5200000");

    fireEvent.change(select, { target: { value: "20000000" } });
    expect(onSampleRateChange).toHaveBeenLastCalledWith(20_000_000);

    rerender(
      <TestWrapper>
        <SignalDisplaySection
          {...baseProps}
          sampleRate={20_000_000}
          onSampleRateChange={onSampleRateChange}
        />
      </TestWrapper>,
    );

    expect(select).toHaveValue("20000000");
    expect(select).not.toHaveDisplayValue("Whole Channel (5.2MHz)");
  });
});
