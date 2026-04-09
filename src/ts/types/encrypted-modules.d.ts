declare module "@n-apt/encrypted-modules/tmp/ts/math/napt-spike-eq" {
  const calculateX: (t: number, clump: unknown) => number;
  export default calculateX;
}

declare module "@n-apt/encrypted-modules/tmp/ts/components/math/DrawMath" {
  const DrawMath: React.ComponentType;
  export default DrawMath;
}

declare module "@n-apt/encrypted-modules/tmp/ts/components/math/DemodMath" {
  const DemodMath: React.ComponentType;
  export default DemodMath;
}

declare module "@n-apt/webmcp/integration" {
  export function useWebMCP(): any;
  export function initializeWebMCP(): boolean;
  export function setupSpectrumToolHandlers(sidebarProps: any): void;
  export function setupDrawSignalToolHandlers(drawSignalProps: any): void;
  export function setupModel3DToolHandlers(model3DProps: any): void;
  export function setupHotspotToolHandlers(hotspotProps: any): void;
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
