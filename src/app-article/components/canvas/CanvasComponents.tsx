import React from "react";

export { PhaseShiftingCanvas } from "@n-apt/app-article/components/canvas/PhaseShiftingCanvas";
export { FrequencyModulationCanvas } from "@n-apt/app-article/components/canvas/FrequencyModulationCanvas";
export { AmplitudeModulationCanvas } from "@n-apt/app-article/components/canvas/AmplitudeModulationCanvas";
export { default as MultipathCanvas } from "@n-apt/app-article/components/canvas/MultipathReflectionCanvas";
export { HeterodyningCanvas } from "@n-apt/app-article/components/canvas/HeterodyningCanvas";
export { TimeOfFlightCanvas } from "@n-apt/app-article/components/canvas/TimeOfFlightCanvas";
export { ImpedanceCanvas } from "@n-apt/app-article/components/canvas/ImpedanceCanvas";
export { BodyAttenuationCanvas } from "@n-apt/app-article/components/canvas/BodyAttenuationCanvas";
export { EndpointRangeCanvas } from "@n-apt/app-article/components/canvas/EndpointRangeCanvas";
export { TriangulationMapCanvas } from "@n-apt/app-article/components/canvas/TriangulationMapCanvas";
export { TriangulationCloseEnoughCanvas } from "@n-apt/app-article/components/canvas/TriangulationCloseEnoughCanvas";

export const CanvasComponents: React.FC<React.PropsWithChildren> = ({ children }) => <>{children}</>;
