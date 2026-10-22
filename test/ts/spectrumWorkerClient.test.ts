import { SpectrumWorkerClient } from "@n-apt/spectrum/fft/spectrumWorkerClient";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";

const frame = (sequence: number, source = "mock-apt") => ({
  type: "spectrum", data_type: "iq_raw", source_id: source, stream_epoch: 1,
  options_revision: 1, sequence, timestamp: sequence, sample_rate: 3200000,
  center_frequency_hz: 10000000, iq_data: new Uint8Array(32),
}) as LiveFrameData;
const config = { fftSize: 8, offsetDb: 0, windowType: "hanning" };

test("publishes each completion while keeping only the latest pending frame", () => {
  const worker: any = { postMessage: jest.fn(), terminate: jest.fn() };
  const onResult = jest.fn();
  const client = new SpectrumWorkerClient(worker, onResult);
  const a = frame(1), b = frame(2), c = frame(3);
  client.submit(a, config);
  client.submit(b, config); client.submit(c, config);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  expect(a.iq_data.length).toBe(32);
  worker.onmessage({ data: { id: worker.postMessage.mock.calls[0][0].id, spectrum: new Float32Array(8).fill(-50) } });
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  expect(onResult).toHaveBeenCalledTimes(1);
  expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ frame: a }));
  expect(client.read(c, config)).toEqual({ frame: a, spectrum: new Float32Array(8).fill(-50) });
  worker.onmessage({ data: { id: worker.postMessage.mock.calls[1][0].id, spectrum: new Float32Array(8).fill(-42) } });
  expect(onResult).toHaveBeenCalledTimes(2);
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ frame: c }));
  const result = client.read(c, config);
  expect(result?.frame).toBe(c);
  expect(result?.spectrum[0]).toBe(-42);
  expect(client.read(frame(1, "rtl-1"), config)).toBeNull();
  client.dispose();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test("rejects completed FFT work from an older processing configuration", () => {
  const worker: any = { postMessage: jest.fn(), terminate: jest.fn() };
  const onResult = jest.fn();
  const client = new SpectrumWorkerClient(worker, onResult);
  const a = frame(1);
  client.submit(a, config);
  const next = { ...config, windowType: "blackman" };
  client.submit(a, next);
  worker.onmessage({ data: { id: 1, spectrum: new Float32Array(8) } });
  expect(client.read(a, next)).toBeNull();
  expect(onResult).not.toHaveBeenCalled();
  client.dispose();
});

test("exposes the latest completed frame while newer work is pending", () => {
  const worker: any = { postMessage: jest.fn(), terminate: jest.fn() };
  const client = new SpectrumWorkerClient(worker);
  const a = frame(1), b = frame(2);
  client.submit(a, config);
  client.submit(b, config);
  worker.onmessage({ data: { id: 1, spectrum: new Float32Array(8).fill(-50) } });
  expect(client.read(b, config)?.frame).toBe(a);
  expect(client.read(frame(2, "rtl-1"), config)).toBeNull();
  client.dispose();
});
