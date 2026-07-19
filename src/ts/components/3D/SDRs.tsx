export {
  HackRFOne,
  SpinningHackRFOne,
  RTLSdr,
  SDRplay,
  Transmitters,
  type TransmitterModel,
} from "./Transmitters";

import { HackRFOne, RTLSdr, SDRplay, SpinningHackRFOne } from "./Transmitters";

/** SDR capability namespaces: tx is transmit-capable; rx is receive-only. */
export const SDRs = {
  tx: { HackRFOne, SpinningHackRFOne },
  rx: { RTLSdr, SDRplay },
} as const;
