import type { IqRawFrameV2 } from "@n-apt/consts/schemas/websocket";
import { presentationController } from "@n-apt/app/infrastructure/streams/sourcePresentationController";
import { notifyFrameArrival } from "@n-apt/app/infrastructure/visualization/frameRuntime";

export const makeLiveFrame = (
  iq_data: Uint8Array,
  sequence: number,
  frame_status: IqRawFrameV2["frame_status"] = "receiving",
): IqRawFrameV2 => ({
  type: "spectrum",
  data_type: "iq_raw",
  source_id: "test-source",
  protocol_version: 2,
  stream_epoch: 1,
  sequence,
  options_revision: 1,
  timestamp: sequence,
  center_frequency_hz: 100_500_000,
  sample_rate: 3_200_000,
  frame_status,
  iq_data,
});

export const setLiveFrame = (frame: IqRawFrameV2): void => {
  const mode =
    frame.frame_status === "standby" || frame.frame_status === "transmitting"
      ? "tx"
      : "rx";
  presentationController.selectSource(frame.source_id, mode, true);
  presentationController.commitActiveSource(frame.source_id);
  presentationController.acceptFrame(frame, mode);
  notifyFrameArrival();
};

export const resetLiveFrames = (): void => {
  presentationController.reset();
};
