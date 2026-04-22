import React from "react";

export { PhaseShiftingCanvas } from "@n-apt/md-preview/components/canvas/PhaseShiftingCanvas";
export { FrequencyModulationCanvas } from "@n-apt/md-preview/components/canvas/FrequencyModulationCanvas";
export { AmplitudeModulationCanvas } from "@n-apt/md-preview/components/canvas/AmplitudeModulationCanvas";
export { default as MultipathCanvas } from "@n-apt/md-preview/components/canvas/MultipathReflectionCanvas";
export { HeterodyningCanvas } from "@n-apt/md-preview/components/canvas/HeterodyningCanvas";
export { TimeOfFlightCanvas } from "@n-apt/md-preview/components/canvas/TimeOfFlightCanvas";
export { ImpedanceCanvas } from "@n-apt/md-preview/components/canvas/ImpedanceCanvas";
export { BodyAttenuationCanvas } from "@n-apt/md-preview/components/canvas/BodyAttenuationCanvas";
export { EndpointRangeCanvas } from "@n-apt/md-preview/components/canvas/EndpointRangeCanvas";

export const CanvasComponents: React.FC<React.PropsWithChildren> = ({ children }) => <>{children}</>;
