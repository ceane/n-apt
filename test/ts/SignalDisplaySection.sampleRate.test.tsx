import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { TestWrapper } from "./testUtils";

const baseProps = {
  variant: "default" as const,
  sourceMode: "live" as const,
  maxSampleRate: 20_000_000,
  minReceiveSampleRate: 3_200_000,
  sampleRateOptions: [3_200_000, 4_000_000, 5_000_000, 12_800_000, 20_000_000],
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
  it("caps the logical frame-rate control from the live sample rate", () => {
    render(
      <TestWrapper>
        <SignalDisplaySection
          {...baseProps}
          sampleRate={3_200_000}
          maxFrameRate={16}
          fftSize={262144}
          fftFrameRate={16}
          onSampleRateChange={jest.fn()}
        />
      </TestWrapper>,
    );

    const frameRateRow = screen
      .getAllByText("Frame rate (logical)")[0]
      .closest("div")?.parentElement as HTMLElement;
    const frameRateInput = within(frameRateRow).getByRole(
      "spinbutton",
    ) as HTMLInputElement;

    expect(frameRateInput).toHaveAttribute("max", "12");
  });

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
    expect(
      screen.queryByRole("option", { name: "5.2MHz" }),
    ).not.toBeInTheDocument();
    expect(select).toHaveValue("whole-channel");

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

  it("does not show whole-channel for RTL-SDR devices", () => {
    render(
      <TestWrapper>
        <SignalDisplaySection
          {...baseProps}
          backend="rtl_sdr"
          deviceProfile={{
            kind: "rtl_sdr" as const,
            is_rtl_sdr: true,
            supports_approx_dbm: true,
            supports_raw_iq_stream: true,
          }}
          sampleRate={3_200_000}
          wholeChannelSampleRate={3_200_000}
          onSampleRateChange={jest.fn()}
        />
      </TestWrapper>,
    );

    const sampleRateRow = screen.getAllByText("Sample Rate")[0].closest("div")
      ?.parentElement as HTMLElement;
    const select = within(sampleRateRow).getByRole(
      "combobox",
    ) as HTMLSelectElement;

    expect(
      screen.queryByRole("option", { name: /Whole Channel/ }),
    ).not.toBeInTheDocument();
    expect(select).toHaveValue("3200000");
  });

  it("shows whole-channel for Mock APT even if stale profile metadata marks it as RTL-SDR", () => {
    render(
      <TestWrapper>
        <SignalDisplaySection
          {...baseProps}
          backend="mock_apt"
          deviceProfile={{
            kind: "mock_apt" as const,
            is_rtl_sdr: true,
            supports_approx_dbm: false,
            supports_raw_iq_stream: false,
          }}
          sampleRate={4_372_000}
          wholeChannelSampleRate={4_372_000}
          onSampleRateChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("option", { name: "Whole Channel (4.372MHz)" }),
    ).toBeInTheDocument();
  });

  it("allows Tx viewers to label sample rate as the FFT view rate", () => {
    render(
      <TestWrapper>
        <SignalDisplaySection
          {...baseProps}
          sampleRateLabel="FFT view sample rate"
          sampleRate={3_200_000}
          onSampleRateChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getAllByText("FFT view sample rate").length).toBeGreaterThan(0);
  });

  it("shows the reordered temporal resolution labels", () => {
    render(
      <TestWrapper>
        <SignalDisplaySection
          {...baseProps}
          sampleRate={5_200_000}
          onSampleRateChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByRole("option", { name: "Slow" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Reduced" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Lossless" }),
    ).toBeInTheDocument();
  });
});
