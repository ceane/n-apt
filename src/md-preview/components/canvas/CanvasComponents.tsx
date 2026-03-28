import React from "react";

export { PhaseShiftingCanvas } from "./PhaseShiftingCanvas";
export { FrequencyModulationCanvas } from "./FrequencyModulationCanvas";
export { AmplitudeModulationCanvas } from "./AmplitudeModulationCanvas";
export { default as MultipathCanvas } from "./MultipathReflectionCanvas";
export { HeterodyningCanvas } from "./HeterodyningCanvas";
export { TimeOfFlightCanvas } from "./TimeOfFlightCanvas";
export { ImpedanceCanvas } from "./ImpedanceCanvas";
export { BodyAttenuationCanvas } from "./BodyAttenuationCanvas";

export const CanvasComponents: React.FC<React.PropsWithChildren> = ({ children }) => <>{children}</>;
