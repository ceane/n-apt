import type { SourceInfo } from "@n-apt/consts/schemas/websocket";

export type VisionReceiverLabel = "RTL-SDR" | "HackRF One";

export const isMockVisionTestSource = (_source: SourceInfo | undefined): boolean =>
  false;

export const getVisionReceiverLabel = (
  _source: SourceInfo | undefined,
): VisionReceiverLabel | null => null;
