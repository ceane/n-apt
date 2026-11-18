import {
  SpectrumWorkerClient,
  type SpectrumWorkerRequest,
} from "@n-apt/spectrum/fft/spectrumWorkerClient";

describe("spectrum worker PPM uniforms", () => {
  it("sends aligned raw samples and model values to the WebGPU worker", () => {
    const postMessage = jest.fn();
    const worker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage,
      terminate: jest.fn(),
    } as unknown as Worker;
    const client = new SpectrumWorkerClient(worker);
    const correctedIq = Uint8Array.from({ length: 8 }, (_, index) => index);
    const rawSpectrumIq = Uint8Array.from(
      { length: 40 },
      (_, index) => index + 20,
    );
    const frame = {
      type: "spectrum" as const,
      data_type: "iq_raw" as const,
      iq_data: correctedIq,
      spectrum_iq_data: rawSpectrumIq,
      spectrum_ppm_correction: {
        correction_hz: 41.2,
        input_per_output: 1.5,
        source_offset: 0.25,
      },
      center_frequency_hz: 1_618_000,
      sample_rate: 3_200_000,
      source_id: "rtl-sdr-v4",
      stream_epoch: 1,
      sequence: 1,
      timestamp: 1,
    };

    client.submit(frame, {
      fftSize: 2,
      offsetDb: 0,
      ppm: 1,
      applyPpmCorrection: false,
    });

    const request = postMessage.mock.calls[0][0] as SpectrumWorkerRequest;
    expect(Array.from(request.iq)).toEqual([26, 27, 28, 29, 30, 31, 30, 31]);
    expect(request.applyPpmCorrection).toBe(true);
    expect(request.ppmCorrectionHz).toBeCloseTo(41.2);
    expect(request.ppmInputPerOutput).toBe(1.5);
    expect(request.ppmSourceOffset).toBe(0.25);
    expect(postMessage.mock.calls[0][1]).toEqual([request.iq.buffer]);
    client.dispose();
  });
});
