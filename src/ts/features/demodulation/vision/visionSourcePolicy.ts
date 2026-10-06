import type { SourceInfo } from "@n-apt/consts/schemas/websocket";

export type VisionReceiverLabel = "RTL-SDR" | "HackRF One";

export const isMockVisionTestSource = (
  source: SourceInfo | undefined,
): boolean => {
  if (
    !source ||
    (!source.is_mock && source.capability !== "mock") ||
    source.capability === "tx" ||
    source.capabilities?.can_receive === false ||
    source.active_duplex_mode === "tx"
  ) {
    return false;
  }

  const identity = [source.kind, source.name, source.product]
    .filter(Boolean)
    .join(" ");
  return (
    /sdr|receiver|\brx\b/i.test(identity) && !/\btx\b|transmit/i.test(identity)
  );
};

export const getVisionReceiverLabel = (
  source: SourceInfo | undefined,
): VisionReceiverLabel | null => {
  if (
    !source ||
    source.is_mock ||
    (source.capability !== "rx" && source.capability !== "tx_rx") ||
    source.capabilities?.can_receive === false ||
    source.active_duplex_mode === "tx"
  ) {
    return null;
  }

  const identity = [source.kind, source.name, source.product]
    .filter(Boolean)
    .join(" ");
  if (/hackrf[-_\s]?one/i.test(identity)) return "HackRF One";
  if (/rtl[-_\s]?sdr/i.test(identity)) return "RTL-SDR";
  return null;
};
