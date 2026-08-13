import { configureStore } from "@reduxjs/toolkit";
import websocketReducer, {
  updateDeviceState,
} from "@n-apt/redux/slices/websocketSlice";
import {
  createIqFramePump,
  type IqFramePumpLifecycle,
} from "@n-apt/app/infrastructure/io/iqFramePump";
import {
  __testQueueLiveDataForMiddleware,
  liveDataRef,
  resetWebSocketMiddlewareState,
} from "@n-apt/redux/middleware/websocketMiddleware";
import {
  resolveLiveSourcePresentationPolicy,
  shouldClearPausedStandbyPresentation,
} from "@n-apt/spectrum/hooks/liveSourceLifecycle";
import {
  resolveWebGpuStreamTransition,
  shouldResetVisualPresentationForSelection,
} from "@n-apt/app/infrastructure/visualization/webgpuStreamReset";

type Form = {
  length: number;
  meanMagnitude: number;
  adjacentVariation: number;
};

const payloadForm = (iq: Uint8Array): Form => {
  let magnitudeSum = 0;
  let adjacentVariation = 0;
  for (let index = 0; index + 1 < iq.length; index += 2) {
    magnitudeSum += Math.abs(iq[index] - 128) + Math.abs(iq[index + 1] - 128);
  }
  for (let index = 1; index < iq.length; index += 1) {
    adjacentVariation += Math.abs(iq[index] - iq[index - 1]);
  }
  return {
    length: iq.length,
    meanMagnitude: magnitudeSum / Math.max(1, iq.length / 2),
    adjacentVariation,
  };
};

const makeV2Envelope = (
  sourceId: string,
  epoch: number,
  sequence: number,
  encryptedPayload: Uint8Array,
): ArrayBuffer => {
  const sourceBytes = new TextEncoder().encode(sourceId);
  const headerLength = 56 + sourceBytes.length;
  const bytes = new Uint8Array(headerLength + encryptedPayload.length);
  bytes.set(new TextEncoder().encode("NAPT"));
  const view = new DataView(bytes.buffer);
  view.setUint8(4, 2);
  view.setUint16(6, headerLength, true);
  view.setUint16(8, sourceBytes.length, true);
  view.setBigUint64(16, BigInt(epoch), true);
  view.setBigUint64(24, BigInt(sequence), true);
  view.setBigUint64(32, BigInt(sequence), true);
  view.setBigUint64(40, 137_100_000n, true);
  view.setUint32(48, 1, true);
  view.setUint32(52, 2_400_000, true);
  bytes.set(sourceBytes, 56);
  bytes.set(encryptedPayload, headerLength);
  return bytes.buffer;
};

const frameFromRef = (): { iq_data: Uint8Array; source_id?: string } => {
  const current = liveDataRef.current;
  const frame = Array.isArray(current) ? current[current.length - 1] : current;
  if (!frame || !frame.iq_data) {
    throw new Error("expected a frame at the pre-WebGPU live-data boundary");
  }
  return frame as { iq_data: Uint8Array; source_id?: string };
};

describe("device swap payload-form integration", () => {
  beforeEach(() => {
    resetWebSocketMiddlewareState();
    liveDataRef.current = null;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      window.setTimeout(() => callback(performance.now()), 0);
      return 1;
    }) as typeof window.requestAnimationFrame;
  });

  it("executes the source handoff through the frame pump, Redux lifecycle, and pre-WebGPU queue", async () => {
    const store = configureStore({ reducer: { websocket: websocketReducer } });
    const lifecycle: IqFramePumpLifecycle = {
      sourceId: "mock-apt",
      streamEpoch: 11,
    };
    const readiness: Array<{ sourceId: string; epoch?: number }> = [];
    const pump = createIqFramePump({
      decrypt: async (payload) => payload,
      getLifecycle: () => lifecycle,
      publish: (frame) =>
        __testQueueLiveDataForMiddleware(frame, store.dispatch, store.getState),
      onFirstFrameAccepted: (frame) => {
        readiness.push({
          sourceId: frame.source_id ?? "",
          epoch: frame.stream_epoch,
        });
        store.dispatch(
          updateDeviceState({
            sourceFrameReadiness: {
              sourceId: frame.source_id ?? "",
              streamEpoch: frame.stream_epoch ?? null,
              sequence: frame.sequence ?? 0,
            },
          }),
        );
      },
    });

    const mockAptPayload = new Uint8Array([
      128, 128, 176, 76, 92, 164, 211, 45, 118, 138, 160, 96,
    ]);
    const mockTxPayload = new Uint8Array([
      128, 128, 255, 0, 255, 0, 128, 128, 255, 0, 255, 0,
    ]);

    const selectionReset = resolveWebGpuStreamTransition(
      {
        sourceId: "mock-apt",
        selectedSourceId: "mock-apt",
        status: "streaming",
      },
      {
        sourceId: "mock-apt",
        selectedSourceId: "mock-tx",
        status: "streaming",
      },
    );
    expect(selectionReset).toEqual({
      clearLiveFrame: true,
      advanceResetEpoch: true,
    });
    expect(
      shouldResetVisualPresentationForSelection("mock-apt", "mock-tx"),
    ).toBe(true);

    expect(
      shouldClearPausedStandbyPresentation({
        isStandby: true,
        selectedSourceId: "mock-tx",
        presentedSourceId: "mock-apt",
        readiness: null,
      }),
    ).toBe(true);
    const pausedStandbyPolicy = resolveLiveSourcePresentationPolicy({
      phase: "standby",
      selectedSourceId: "mock-tx",
      activeSourceId: "mock-tx",
      readiness: null,
      presentedSourceId: "mock-apt",
      isStandby: true,
    });
    expect(pausedStandbyPolicy).toMatchObject({
      clearStalePresentation: true,
      preserveMatchingPresentation: false,
    });

    store.dispatch(
      updateDeviceState({
        activeSourceId: "mock-apt",
        sources: [
          { id: "mock-apt", stream_epoch: 11 } as never,
          { id: "mock-tx", stream_epoch: 12, status: "transmitting" } as never,
        ],
      }),
    );
    pump.enqueue(makeV2Envelope("mock-apt", 11, 1, mockAptPayload), "mock-apt");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const aptFrame = frameFromRef();
    const aptForm = payloadForm(aptFrame.iq_data);

    // This is the same handoff boundary as websocket/sendMessage(select_source):
    // clear the old presentation, reset the source pump, and await the commit.
    lifecycle.sourceId = "mock-tx";
    lifecycle.streamEpoch = 12;
    liveDataRef.current = null;
    pump.reset();
    store.dispatch(
      updateDeviceState({
        activeSourceId: "mock-tx",
        sources: [
          { id: "mock-apt", stream_epoch: 11 } as never,
          { id: "mock-tx", stream_epoch: 12, status: "transmitting" } as never,
        ],
        sourceFrameReadiness: null,
      }),
    );

    // A late old-source frame follows the swap and must never reach the
    // pre-WebGPU presentation ref.
    pump.enqueue(makeV2Envelope("mock-apt", 11, 2, mockAptPayload), "mock-tx");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(liveDataRef.current).toBeNull();

    pump.enqueue(makeV2Envelope("mock-tx", 12, 1, mockTxPayload), "mock-tx");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const txFrame = frameFromRef();
    const txForm = payloadForm(txFrame.iq_data);

    expect(txFrame.source_id).toBe("mock-tx");
    expect(txForm).not.toEqual(aptForm);
    expect(readiness).toEqual([
      { sourceId: "mock-apt", epoch: 11 },
      { sourceId: "mock-tx", epoch: 12 },
    ]);
    expect(store.getState().websocket.sourceFrameReadiness).toMatchObject({
      sourceId: "mock-tx",
      streamEpoch: 12,
      sequence: 1,
    });
  });
});
