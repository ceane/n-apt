import PhaseShiftingCanvasComponent, { PhaseShiftingCanvas as NamedPhaseShiftingCanvas } from "./PhaseShiftingCanvas";

export const PhaseShiftingCanvas = NamedPhaseShiftingCanvas ?? PhaseShiftingCanvasComponent;
export { FrequencyModulationCanvas } from "./FrequencyModulationCanvas";
export { AmplitudeModulationCanvas } from "./AmplitudeModulationCanvas";
export { default as MultipathCanvas } from "./MultipathReflectionCanvas";
export { default as SignalMockupCanvas } from "./SignalMockupCanvas";
export { HeterodyningCanvas } from "./HeterodyningCanvas";
export { TimeOfFlightCanvas } from "./TimeOfFlightCanvas";
export { ImpedanceCanvas } from "./ImpedanceCanvas";
export { BodyAttenuationCanvas } from "./BodyAttenuationCanvas";
export { EndpointRangeCanvas } from "./EndpointRangeCanvas";

export * from "./shared";
