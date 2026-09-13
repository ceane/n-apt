import {
  DEFAULT_FFT_SIZE,
  DEFAULT_GAIN_DB,
  DEFAULT_PPM,
  DEFAULT_SAMPLE_RATE_HZ,
  FFT_SIZE_OPTIONS,
  MAX_GAIN_DB,
  FRAME_BYTE_LENGTH,
  MAX_SAMPLE_RATE_HZ,
  RtlSdrWebUsbSession,
  drawSpectrum,
  mapDbToCanvasY,
  normalizeFftSize,
  normalizeGainDb,
  normalizePpm,
  normalizeSampleRateHz,
  processRtlSdrFrame,
  resampleSpectrumForCanvas,
  SPECTRUM_RIGHT_PAD,
  SPECTRUM_LEFT_PAD,
} from "@n-apt/webusb/rtlSdrWebUsb";
import {
  getSpectrumLoadingPlaceholder,
  getSpectrumPlaceholderState,
} from "@n-apt/webusb/spectrumPlaceholder";
import { getOptionSyncIndicator } from "@n-apt/webusb/optionSync";
import {
  clampFrequencyHz,
  formatFrequency,
  formatFrequencyInputValue,
  getFrequencyArrowStepHz,
  getFrequencyUnitScale,
  getOptimalFrequencyScale,
  parseFrequencyInputValue,
  trimNumericString,
} from "@n-apt/webusb/frequency";
import { R82xxTuner, reverseR82xxByte } from "@n-apt/webusb/r82xx";

describe("standalone WebUSB SDR transport", () => {
  it("uses the app's RTL defaults and normalizes probe controls", () => {
    expect(DEFAULT_SAMPLE_RATE_HZ).toBe(3_200_000);
    expect(MAX_SAMPLE_RATE_HZ).toBe(3_200_000);
    expect(DEFAULT_FFT_SIZE).toBe(32_768);
    expect(FFT_SIZE_OPTIONS).toEqual([
      2_048,
      4_096,
      8_192,
      16_384,
      32_768,
      65_536,
      131_072,
      262_144,
      524_288,
    ]);
    expect(DEFAULT_GAIN_DB).toBe(49.6);
    expect(MAX_GAIN_DB).toBe(49.6);
    expect(SPECTRUM_LEFT_PAD).toBe(48);
    expect(SPECTRUM_RIGHT_PAD).toBe(16);
    expect(DEFAULT_PPM).toBe(1);
    expect(FRAME_BYTE_LENGTH).toBe(DEFAULT_FFT_SIZE * 2);
    expect(normalizeFftSize(20_000)).toBe(16_384);
    expect(normalizeFftSize(524_288)).toBe(524_288);
    expect(normalizeGainDb(99)).toBe(49.6);
    expect(normalizePpm(-4)).toBe(0);
    expect(normalizeSampleRateHz(9_999_999)).toBe(MAX_SAMPLE_RATE_HZ);
  });

  it("formats the sample rate with the app's frequency utility", () => {
    expect(formatFrequency(3_200_000)).toBe("3.2MHz");
    expect(
      formatFrequency(1_618_000, {
        precisionMHz: 4,
        precisionKHz: 2,
        trimTrailingZeros: true,
      }),
    ).toBe("1.618MHz");
    expect(
      formatFrequency(3_200_000, {
        precisionMHz: 3,
        trimTrailingZeros: false,
      }),
    ).toBe("3.200MHz");
  });

  it("copies the FrequencyInput scale, formatting, parsing, and clamp behavior", () => {
    expect(getOptimalFrequencyScale(1_600_000)).toEqual({
      value: 1.6,
      unit: "MHz",
    });
    expect(getFrequencyUnitScale("MHz")).toBe(1_000_000);
    expect(getFrequencyArrowStepHz("MHz")).toBe(50_000);
    expect(getFrequencyArrowStepHz("kHz")).toBe(50);
    expect(trimNumericString("1.600")).toBe("1.6");
    expect(formatFrequencyInputValue(1_600_000, "MHz")).toBe("1.6");
    expect(parseFrequencyInputValue("1.6", "MHz", 0, 30_000_000_000)).toBe(
      1_600_000,
    );
    expect(clampFrequencyHz(31_000_000_000, 0, 30_000_000_000)).toBe(
      30_000_000_000,
    );
  });

  it("configures an RTL-SDR and reads a copied frame through its bulk endpoint", async () => {
    const device = {
      vendorId: 0x0bda,
      productId: 0x2838,
      productName: "RTL2838",
      manufacturerName: "Test tuner",
      opened: false,
      configuration: {
        interfaces: [
          {
            alternates: [
              {
                endpoints: [
                  { endpointNumber: 2, direction: "in", type: "bulk" },
                ],
              },
            ],
          },
        ],
      },
      open: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
      selectConfiguration: jest.fn(async () => undefined),
      claimInterface: jest.fn(async () => undefined),
      releaseInterface: jest.fn(async () => undefined),
      controlTransferOut: jest.fn(async (_setup, data?: ArrayBuffer) => ({
        status: "ok",
        bytesWritten: data?.byteLength ?? 1,
      })),
      controlTransferIn: jest.fn(async (_setup, length: number) => ({
        status: "ok",
        data: new DataView(
          (() => {
            const data = new Uint8Array(length).fill(0);
            if (length === 1) data[0] = 0x69;
            if (length >= 3) data[2] = 0x02;
            return data;
          })().buffer,
        ),
      })),
      transferIn: jest.fn(async () => ({
        status: "ok",
        data: new DataView(Uint8Array.from([128, 128, 255, 128]).buffer),
      })),
      clearHalt: jest.fn(async () => undefined),
    };
    const usb = {
      getDevices: jest.fn(async () => []),
      requestDevice: jest.fn(async () => device),
    };
    const session = new RtlSdrWebUsbSession(usb);

    await expect(
      session.connect({
        centerFrequencyHz: 100_000_000,
        sampleRateHz: 9_999_999,
        fftSize: DEFAULT_FFT_SIZE,
        gainDb: DEFAULT_GAIN_DB,
        ppm: DEFAULT_PPM,
      }),
    ).resolves.toMatchObject({
      deviceLabel: "Test tuner RTL2838",
      endpointNumber: 2,
      sampleRateHz: MAX_SAMPLE_RATE_HZ,
      fftSize: DEFAULT_FFT_SIZE,
      gainDb: DEFAULT_GAIN_DB,
      ppm: DEFAULT_PPM,
      centerFrequencyHz: 100_000_000,
    });
    await expect(session.readFrame()).resolves.toEqual(
      Uint8Array.from([128, 128, 255, 128]),
    );

    expect(usb.requestDevice).toHaveBeenCalledWith({
      filters: expect.arrayContaining([
        { vendorId: 0x0bda, productId: 0x2832 },
        { vendorId: 0x0bda, productId: 0x2838 },
      ]),
    });
    expect(device.claimInterface).toHaveBeenCalledWith(0);
    expect(session.isPaused()).toBe(false);
    session.pause();
    expect(session.isPaused()).toBe(true);
    session.resume();
    expect(session.isPaused()).toBe(false);
    expect(device.controlTransferIn).toHaveBeenCalled();
    expect(
      device.controlTransferOut.mock.calls.some(
        ([setup, data]) =>
          setup.value === 0x34 &&
          setup.index === 0x610 &&
          data !== undefined &&
          new Uint8Array(data)[0] === 0x05,
      ),
    ).toBe(true);
    expect(device.transferIn).toHaveBeenCalledWith(2, FRAME_BYTE_LENGTH);

    const writesBeforeUpdate = device.controlTransferOut.mock.calls.length;
    await expect(
      session.updateOptions({
        centerFrequencyHz: 101_000_000,
        sampleRateHz: 9_999_999,
        fftSize: 16_384,
        gainDb: 49.6,
        ppm: 3,
      }),
    ).resolves.toMatchObject({
      centerFrequencyHz: 101_000_000,
      sampleRateHz: MAX_SAMPLE_RATE_HZ,
      fftSize: 16_384,
      gainDb: 49.6,
      ppm: 3,
    });
    expect(device.controlTransferOut.mock.calls.length).toBeGreaterThan(
      writesBeforeUpdate,
    );
    expect(
      device.controlTransferIn.mock.calls.some(
        ([setup]) => setup.value === 0x120 && setup.index === 0x0a,
      ),
    ).toBe(true);
    await expect(session.readFrame()).resolves.toEqual(
      Uint8Array.from([128, 128, 255, 128]),
    );
    expect(device.transferIn).toHaveBeenLastCalledWith(2, 16_384 * 2);
    await session.disconnect();
    expect(device.releaseInterface).toHaveBeenCalledWith(0);
    expect(device.close).toHaveBeenCalled();
  });

  it("encodes R82xx tuner reads and writes through the RTL2832U I2C bridge", async () => {
    const writes: Array<{ address: number; bytes: number[] }> = [];
    const transport = {
      setI2cRepeater: jest.fn(async () => undefined),
      writeI2c: jest.fn(async (address: number, data: Uint8Array) => {
        writes.push({ address, bytes: Array.from(data) });
      }),
      readI2c: jest.fn(
        async (
          _address: number,
          _register: number,
          length: number,
        ): Promise<Uint8Array> => {
          const raw = new Uint8Array(length);
          raw.fill(reverseR82xxByte(0));
          if (length >= 3) raw[2] = reverseR82xxByte(0x40);
          return raw;
        },
      ),
    };
    const tuner = new R82xxTuner(transport, { blogV4: true });

    await tuner.initialize();
    await tuner.setFrequency(100_000_000);
    await tuner.setGainTenthsDb(496);

    expect(transport.setI2cRepeater).toHaveBeenCalledWith(true);
    expect(
      writes.some(({ address, bytes }) => address === 0x74 && bytes[0] === 0x05),
    ).toBe(true);
    expect(
      writes.some(
        ({ address, bytes }) =>
          address === 0x74 && bytes[0] === 0x10 && bytes.length === 8,
      ),
    ).toBe(true);
    expect(
      writes.some(
        ({ address, bytes }) =>
          address === 0x74 && bytes[0] === 0x05 &&
          (bytes[1] & 0x0f) === 0x0f,
      ),
    ).toBe(true);
  });

  it("processes unsigned interleaved IQ into reusable display bins", () => {
    const input = Uint8Array.from([
      255, 128,
      255, 128,
      255, 128,
      255, 128,
    ]);
    const output = processRtlSdrFrame(input);

    expect(output.length).toBe(4);
    expect(output.every((value) => Number.isFinite(value))).toBe(true);
    expect(output.every((value) => value >= -150 && value <= 0)).toBe(true);
    // FFT shift places the DC magnitude in the middle of the display.
    expect(output[2]).toBeGreaterThan(output[0]);
  });

  it("maps fixed dB magnitude values from the floor to the top of the plot", () => {
    expect(mapDbToCanvasY(-120, 400)).toBe(360);
    expect(mapDbToCanvasY(-60, 400)).toBe(190);
    expect(mapDbToCanvasY(0, 400)).toBe(20);
  });

  it("fills the spectrum from the magnitude trace down to the plot floor", () => {
    const context = {
      beginPath: jest.fn(),
      closePath: jest.fn(),
      fill: jest.fn(),
      fillRect: jest.fn(),
      lineTo: jest.fn(),
      moveTo: jest.fn(),
      fillText: jest.fn(),
      measureText: jest.fn((value: string) => ({ width: value.length * 7 })),
      setLineDash: jest.fn(),
      setTransform: jest.fn(),
      stroke: jest.fn(),
    } as any;
    const canvas = {
      clientHeight: 400,
      clientWidth: 2,
      height: 400,
      width: 2,
      getContext: jest.fn(() => context),
    } as any;

    drawSpectrum(canvas, new Float32Array([-120, 0]));

    expect(context.fill).toHaveBeenCalledTimes(1);
    expect(context.closePath).toHaveBeenCalledTimes(1);
    expect(context.stroke).toHaveBeenCalled();
  });

  it("draws app-style dB and frequency axes around the magnitude trace", () => {
    const context = {
      beginPath: jest.fn(),
      closePath: jest.fn(),
      fill: jest.fn(),
      fillRect: jest.fn(),
      fillText: jest.fn(),
      lineTo: jest.fn(),
      moveTo: jest.fn(),
      measureText: jest.fn((value: string) => ({ width: value.length * 7 })),
      setLineDash: jest.fn(),
      setTransform: jest.fn(),
      stroke: jest.fn(),
    } as any;
    const canvas = {
      clientHeight: 400,
      clientWidth: 800,
      height: 400,
      width: 800,
      getContext: jest.fn(() => context),
    } as any;

    drawSpectrum(canvas, new Float32Array([-80, -60, -40]), {
      centerFrequencyHz: 1_600_000,
      sampleRateHz: 3_200_000,
    });

    expect(context.fillText).toHaveBeenCalled();
    expect(
      context.fillText.mock.calls.some(([label]: [string]) => label.includes("dB")),
    ).toBe(true);
    expect(
      context.fillText.mock.calls.some(([label]: [string]) => label.includes("MHz")),
    ).toBe(true);
    expect(
      context.fillText.mock.calls.some(([label]: [string]) => label === "1.6MHz"),
    ).toBe(true);
    expect(
      context.fillText.mock.calls.some(([label]: [string]) => label === "0 dB"),
    ).toBe(true);
    expect(
      context.fillText.mock.calls.some(([label]: [string]) => label === "-10"),
    ).toBe(true);
    expect(
      context.fillText.mock.calls.some(([label]: [string]) => label === "-10 dB"),
    ).toBe(false);
    expect(
      context.fillText.mock.calls.some(([label]: [string]) => label === "0Hz"),
    ).toBe(true);
    expect(
      context.fillText.mock.calls.some(([label]: [string]) => label === "3.2MHz"),
    ).toBe(true);
    const frequencyLabelYs = new Set(
      context.fillText.mock.calls
        .filter(([label]: [string]) => /(?:Hz|kHz|MHz|GHz)$/.test(label))
        .map(([, , y]: [string, number, number]) => y),
    );
    expect(frequencyLabelYs).toEqual(new Set([385]));
    expect(context.textBaseline).toBe("alphabetic");
  });

  it("reduces high-resolution FFT bins to display pixels by preserving bucket peaks", () => {
    expect(
      Array.from(
        resampleSpectrumForCanvas(new Float32Array([-90, -20, -80, -10]), 2),
      ),
    ).toEqual([-20, -10]);
  });

  it("provides app-style placeholder states for idle, loading, and errors", () => {
    expect(getSpectrumPlaceholderState(false)).toMatchObject({
      kind: "disconnected",
      kicker: "Standby",
      title: "Waiting for RTL-SDR",
    });
    expect(getSpectrumLoadingPlaceholder()).toMatchObject({
      kind: "loading",
      title: "Connecting to RTL-SDR",
    });
    expect(getSpectrumPlaceholderState(true)).toBeNull();
    expect(getSpectrumPlaceholderState(false, new Error("Device busy"))).toMatchObject({
      kind: "error",
      title: "No device available",
      message: "Connect your SDR (RTL-SDR) to start streaming.",
    });
  });

  it("labels debounced option writes with pending and sent indicators", () => {
    expect(getOptionSyncIndicator("pending")).toEqual({
      symbol: "⟳",
      label: "Applying",
    });
    expect(getOptionSyncIndicator("sent")).toEqual({
      symbol: "✓",
      label: "Applied",
    });
    expect(getOptionSyncIndicator("error")).toEqual({
      symbol: "×",
      label: "Error",
    });
    expect(getOptionSyncIndicator("local").label).toBe("Local");
    expect(getOptionSyncIndicator("idle").label).toBe("Not connected");
  });
});
