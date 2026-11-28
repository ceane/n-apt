export type HackRfLedId = "3v3" | "1v8" | "rf" | "usb" | "rx" | "tx";
export type HackRfLedStage = "idle" | "rx" | "tx";
export type HackRfLedObservation = "on" | "off" | "skip" | "timeout";
export type HackRfLedGrade = "PASS" | "FAIL" | "SKIP" | "TIMEOUT" | "INFO";

export const HACKRF_LED_LAYOUT: ReadonlyArray<{
  id: HackRfLedId;
  label: string;
  color: string;
  placement: "between-reset-and-dfu" | "row";
}> = [
  {
    id: "3v3",
    label: "3V3",
    color: "green",
    placement: "between-reset-and-dfu",
  },
  { id: "1v8", label: "1V8", color: "#ffb000", placement: "row" },
  { id: "rf", label: "RF", color: "red", placement: "row" },
  { id: "usb", label: "USB", color: "green", placement: "row" },
  { id: "rx", label: "RX", color: "yellow", placement: "row" },
  { id: "tx", label: "TX", color: "red", placement: "row" },
];

export const HACKRF_LED_CHECKS: ReadonlyArray<{
  id: HackRfLedId;
  stage: HackRfLedStage;
  expectedOn: boolean | null;
  instruction: string;
}> = [
  {
    id: "3v3",
    stage: "idle",
    expectedOn: true,
    instruction: "Check the green 3V3 LED between Reset and DFU.",
  },
  {
    id: "1v8",
    stage: "idle",
    expectedOn: true,
    instruction: "Check the yellow-orange 1V8 LED.",
  },
  {
    id: "rf",
    stage: "idle",
    expectedOn: null,
    instruction:
      "Record whether the red RF LED is lit; its state is informational.",
  },
  {
    id: "usb",
    stage: "idle",
    expectedOn: true,
    instruction: "Check the green USB LED.",
  },
  {
    id: "rx",
    stage: "rx",
    expectedOn: true,
    instruction: "Put N-APT in RX mode, then check for the yellow RX LED.",
  },
  {
    id: "tx",
    stage: "rx",
    expectedOn: false,
    instruction: "While still in RX mode, check that the red TX LED is off.",
  },
  {
    id: "tx",
    stage: "tx",
    expectedOn: true,
    instruction: "Put N-APT in TX mode, then check for the red TX LED.",
  },
  {
    id: "rx",
    stage: "tx",
    expectedOn: false,
    instruction: "While still in TX mode, check that the yellow RX LED is off.",
  },
];

export function getHackRfLedExpectation(
  id: HackRfLedId,
  stage: HackRfLedStage,
): boolean | null {
  if (id === "3v3" || id === "1v8" || id === "usb") return true;
  if (id === "rf") return null;
  return id === "rx" ? stage === "rx" : stage === "tx";
}

export function gradeHackRfLedObservation(
  expectedOn: boolean | null,
  observation: HackRfLedObservation,
): HackRfLedGrade {
  if (observation === "skip") return "SKIP";
  if (observation === "timeout") return "TIMEOUT";
  if (expectedOn === null) return "INFO";
  return (observation === "on") === expectedOn ? "PASS" : "FAIL";
}
