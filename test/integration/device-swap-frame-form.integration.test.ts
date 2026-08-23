import { configureStore } from "@reduxjs/toolkit";
import websocketReducer, {
  updateDeviceState,
} from "@n-apt/redux/slices/websocketSlice";
import {
  acceptsMultiplexStreamWireFrame,
  createMultiplexStreamSequenceGate,
} from "@n-apt/spectrum/model/multiplexStream/frameGate";
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

const makeV2Frame = (
  sourceId: string,
  epoch: number,
  sequence: number,
  encryptedPayload: Uint8Array,
) => ({
  type: "spectrum" as const,
  data_type: "iq_raw" as const,
  protocol_version: 2 as const,
  source_id: sourceId,
  stream_epoch: epoch,
  sequence,
  center_frequency_hz: 137_100_000,
  sample_rate: 2_400_000,
  timestamp: Date.now(),
  frame_status: "receiving" as const,
  iq_data: encryptedPayload,
});

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

  it("executes the source handoff through the stream gate, Redux lifecycle, and pre-WebGPU queue", async () => {
    const store = configureStore({ reducer: { websocket: websocketReducer } });
    const lifecycle = {
      sourceId: "mock-apt" as string | null,
      streamEpoch: 11 as number | null,
    };
    const readiness: Array<{ sourceId: string; epoch?: number }> = [];
    const sequenceGate = createMultiplexStreamSequenceGate();

    // Ingress under test: identity gate → first-frame boundary → middleware
    // presentation queue. Mirrors the production multiplexed-stream path
    // (transport decrypt → gate → publish) without socket machinery.
    const ingest = (
      frame: ReturnType<typeof makeV2Frame>,
    ): boolean => {
      if (!acceptsMultiplexStreamWireFrame(frame, lifecycle)) return false;
      if (!sequenceGate.accept({
        sourceId: frame.source_id,
        streamEpoch: frame.stream_epoch,
        sequence: frame.sequence,
      })) {
        return false;
      }
      if (
        sequenceGate.consumeFirstFrameBoundary({
          sourceId: frame.source_id,
          streamEpoch: frame.stream_epoch,
        })
      ) {
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
      }
      __testQueueLiveDataForMiddleware(
        frame,
        store.dispatch,
        store.getState,
      );
      return true;
    };

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
    ingest(makeV2Frame("mock-apt", 11, 1, mockAptPayload));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const aptFrame = frameFromRef();
    const aptForm = payloadForm(aptFrame.iq_data);

    // This is the same handoff boundary as websocket/sendMessage(select_source):
    // clear the old presentation, reset the stream gate, and await the commit.
    lifecycle.sourceId = "mock-tx";
    lifecycle.streamEpoch = 12;
    liveDataRef.current = null;
    sequenceGate.reset();
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
    // pre-WebGPU presentation ref — the identity gate rejects it.
    expect(
      ingest(makeV2Frame("mock-apt", 11, 2, mockAptPayload)),
    ).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(liveDataRef.current).toBeNull();

    ingest(makeV2Frame("mock-tx", 12, 1, mockTxPayload));
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
