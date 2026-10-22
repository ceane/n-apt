import { SpectrumWorkerClient } from "@n-apt/spectrum/fft/spectrumWorkerClient";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";

const frame = (sequence: number, source = "mock-apt") => ({
  type: "spectrum", data_type: "iq_raw", source_id: source, stream_epoch: 1,
  options_revision: 1, sequence, timestamp: sequence, sample_rate: 3200000,
  center_frequency_hz: 10000000, iq_data: new Uint8Array(32),
}) as LiveFrameData;
const config = { fftSize: 8, offsetDb: 0, windowType: "hanning" };

test("bounds FFT work to one in flight and the newest pending frame", () => {
  const worker: any = { postMessage: jest.fn(), terminate: jest.fn() };
  const client = new SpectrumWorkerClient(worker);
  const a = frame(1), b = frame(2), c = frame(3);
  expect(client.read(a, config)).toBeNull();
  client.read(b, config); client.read(c, config);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  expect(a.iq_data.length).toBe(32);
  worker.onmessage({ data: { id: worker.postMessage.mock.calls[0][0].id, spectrum: new Float32Array(8).fill(-50) } });
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  const result = client.read(c, config);
  expect(result?.frame).toBe(a);
  expect(result?.spectrum[0]).toBe(-50);
  expect(client.read(frame(1, "rtl-1"), config)).toBeNull();
  client.dispose();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test("rejects completed FFT work from an older processing configuration", () => {
  const worker: any = { postMessage: jest.fn(), terminate: jest.fn() };
  const client = new SpectrumWorkerClient(worker);
  const a = frame(1);
  client.read(a, config);
  const next = { ...config, windowType: "blackman" };
  client.read(a, next);
  worker.onmessage({ data: { id: 1, spectrum: new Float32Array(8) } });
  expect(client.read(a, next)).toBeNull();
  client.dispose();
});
