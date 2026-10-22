import { act, renderHook } from "@testing-library/react";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import { notifyFrameArrival } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { useSpectrumWorker } from "@n-apt/spectrum/hooks/useSpectrumWorker";

const mockWorker: any = {
  postMessage: jest.fn(),
  terminate: jest.fn(),
  onmessage: null,
  onerror: null,
  onmessageerror: null,
};
jest.mock("@n-apt/spectrum/fft/spectrumWorkerFactory", () => ({
  createSpectrumWorker: () => mockWorker,
}));

const makeFrame = (sequence: number) => ({
  type: "spectrum", data_type: "iq_raw", source_id: "mock-apt", stream_epoch: 1,
  options_revision: 1, sequence, timestamp: sequence, sample_rate: 3_200_000,
  center_frequency_hz: 10_000_000, iq_data: new Uint8Array(32),
}) as LiveFrameData;

test("submits on frame arrival and notifies the renderer as soon as FFT completes", () => {
  mockWorker.postMessage.mockClear();
  mockWorker.terminate.mockClear();
  const frameRef = { current: makeFrame(1) };
  const config = { fftSize: 8, offsetDb: 0, windowType: "hanning" };
  const onSpectrumReady = jest.fn();
  const { result, unmount } = renderHook(() => useSpectrumWorker({
    frameRef, config, onSpectrumReady,
  }));

  expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
  const requestId = mockWorker.postMessage.mock.calls[0][0].id;
  act(() => mockWorker.onmessage({
    data: { id: requestId, spectrum: new Float32Array(8).fill(-45) },
  }));

  expect(onSpectrumReady).toHaveBeenCalledTimes(1);
  expect(result.current.readSpectrum(frameRef.current, config)?.spectrum[0]).toBe(-45);
  unmount();
  expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
});

test("submits the latest frame when the shared frame runtime signals arrival", () => {
  mockWorker.postMessage.mockClear();
  mockWorker.terminate.mockClear();
  const frameRef = { current: makeFrame(1) };
  const { unmount } = renderHook(() => useSpectrumWorker({
    frameRef,
    config: { fftSize: 8, offsetDb: 0, windowType: "hanning" },
  }));
  frameRef.current = makeFrame(2);
  act(() => notifyFrameArrival());
  expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
  act(() => mockWorker.onmessage({
    data: {
      id: mockWorker.postMessage.mock.calls[0][0].id,
      spectrum: new Float32Array(8).fill(-50),
    },
  }));
  expect(mockWorker.postMessage).toHaveBeenCalledTimes(2);
  expect(Array.from(mockWorker.postMessage.mock.calls[1][0].iq)).toEqual(
    Array.from(frameRef.current.iq_data.slice(-16)),
  );
  unmount();
});
