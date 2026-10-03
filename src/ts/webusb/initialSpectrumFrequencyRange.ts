import signalsYaml from "../../../signals.yaml?raw";
import { getInitialNaptFrequencyRange } from "./naptChannels";

export const INITIAL_SPECTRUM_FREQUENCY_RANGE =
  getInitialNaptFrequencyRange(signalsYaml);
