declare const __N_APT_ML_BUNDLE_READY__: boolean;

declare module "@n-apt/encrypted-modules/tmp/ts/math/napt-spike-eq" {
  const calculateX: (t: number, clump: unknown) => number;
  export default calculateX;
}

declare module "@n-apt/encrypted-modules/tmp/ts/components/math/MockNAPTMath" {
  const MockNAPTMath: React.ComponentType;
  export default MockNAPTMath;
}

declare module "@n-apt/encrypted-modules/tmp/ts/components/math/DemodMath" {
  const DemodMath: React.ComponentType;
  export default DemodMath;
}

declare module "@n-apt/encrypted-modules/tmp/ml/index" {
  export const CoreMLNode: React.ComponentType<any>;
  export const StimulusNode: React.ComponentType<any>;
  export const StimulusNodeLibraryEntry: React.ComponentType<any>;
  export const AudioDemodWorkflowFlow: React.ComponentType<any>;
  export const VisionDemodWorkflowFlow: React.ComponentType<any>;
  export const VisionScene: React.ComponentType<any>;
  export const nativeClassifier: Record<string, any>;
  export const visionModel: Record<string, any>;
  export const visionDecoder: Record<string, any>;
  export const visionOnnx: Record<string, any>;
  export const audioSurveyModel: Record<string, any>;
  export const audioSurveyRuntime: Record<string, any>;
  export const ML_MODULE_BUNDLE_API_VERSION: 1;
}

declare module "@n-apt/webmcp/integration" {
  export function useWebMCP(route?: string): any;
  export function initializeWebMCP(): boolean;
  export function setupSpectrumToolHandlers(sidebarProps: any): void;
  export function setupDrawSignalToolHandlers(drawSignalProps: any): void;
  export function setupModel3DToolHandlers(model3DProps: any): void;
  export function setupHotspotToolHandlers(hotspotProps: any): void;
  export function setupMapEndpointsToolHandlers(mapProps: any): void;
}

declare module "express" {
  export interface Request {
    headers: { [key: string]: string | string[] | undefined };
    path: string;
  }
  export interface Response {
    setHeader(name: string, value: string): Response;
    send(body: any): Response;
  }
  export interface NextFunction {
    (): void;
  }
}
