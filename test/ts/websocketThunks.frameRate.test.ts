import { sendSettings } from "@n-apt/redux/thunks/websocketThunks";

import { buildSettingsWireData, buildReconnectSettingsMessage } from "@n-apt/redux/settingsWire";

describe("settings wire policies", () => {
  it("keeps update rounding, finite checks, trimmed windows and extended fields", () => {
    expect(buildSettingsWireData({
      fftSize: 2048.9, sampleRate: 3200000.9, frameRate: 133,
      maxFrameRate: 133, fftWindow: "   ", gain: Infinity, ppm: -1.6,
      hackrfLnaGain: 0, hackrfVgaGain: 12, hackrfAmpEnabled: false,
      tunerBandwidth: 100.6, tunerAGC: false, rtlAGC: true,
      mirrorSpectrumBelowZero: false,
    })).toEqual({
      fftSize: 2048, sampleRate: 3200000, frameRate: 100, maxFrameRate: 100,
      ppm: -2, hackrfLnaGain: 0, hackrfVgaGain: 12, hackrfAmpEnabled: false,
      tunerBandwidth: 101, tunerAGC: false, rtlAGC: true,
      mirror_spectrum_below_zero: false,
    });
    expect(buildSettingsWireData({ fftSize: Infinity, sampleRate: NaN, ppm: Infinity })).toEqual({});
  });

  it("keeps reconnect fractions, whitespace, non-finite values and its narrower fields", () => {
    const message = buildReconnectSettingsMessage({
      fftSize: 2048.9, sampleRateHz: Infinity, fftFrameRate: 133,
      fftWindow: "   ", gain: Infinity, ppm: NaN, tunerAGC: false, rtlAGC: true,
      hackrfLnaGain: 12, hackrfVgaGain: 20, hackrfAmpEnabled: true,
    });
    expect(message).toEqual({
      type: "settings", scope: "device", fftSize: 2048.9,
      sampleRate: Infinity, frameRate: 100, fftWindow: "   ",
      gain: Infinity, ppm: NaN, tunerAGC: false, rtlAGC: true,
    });
    expect(JSON.parse(JSON.stringify(message))).toMatchObject({ sampleRate: null, gain: null, ppm: null });
    expect(buildReconnectSettingsMessage({})).toEqual({ type: "settings", scope: "device" });
    expect(buildReconnectSettingsMessage({ fftSize: -1, sampleRateHz: 0, gain: -1, ppm: 1.6 })).toEqual({ type: "settings", scope: "device", ppm: 1.6 });
  });
});

describe("sendSettings frame-rate protocol boundary", () => {
  it("clamps frameRate and maxFrameRate before dispatching a settings message", async () => {
    const dispatch = jest.fn();
    const getState = () => ({ websocket: { isConnected: true } });

    await (sendSettings({
      frameRate: 133,
      maxFrameRate: 133,
    }) as any)(dispatch, getState, undefined);

    expect(dispatch).toHaveBeenCalledWith({
      type: "websocket/sendMessage",
      payload: {
        type: "settings",
        data: {
          scope: "device",
          frameRate: 100,
          maxFrameRate: 100,
        },
      },
    });
  });

  it("sends the mirror-axis choice as device-scoped presentation state", async () => {
    const dispatch = jest.fn();
    const getState = () => ({ websocket: { isConnected: true } });

    await (sendSettings({ mirrorSpectrumBelowZero: true }) as any)(
      dispatch,
      getState,
      undefined,
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "websocket/sendMessage",
      payload: {
        type: "settings",
        data: {
          scope: "device",
          mirror_spectrum_below_zero: true,
        },
      },
    });
  });
});
