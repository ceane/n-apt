import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("performance-critical FFT and waterfall modules", () => {
  const modules = [
    "src/ts/features/spectrum/hooks/useWasmSimdMath.ts",
    "src/ts/features/spectrum/hooks/useDraw2DFIFOWaterfall.ts",
    "src/ts/features/spectrum/hooks/useDrawWebGPUFIFOWaterfall.ts",
    "src/ts/features/spectrum/utils/rendering/fftZoom.ts",
    "src/ts/features/spectrum/utils/rendering/fifoWaterfall2d.ts",
    "src/ts/shared/math/resampleNearest.ts",
  ];

  it.each(modules)("keeps array combinators out of %s", (modulePath) => {
    const source = readFileSync(resolve(process.cwd(), modulePath), "utf8");
    expect(source).not.toMatch(/\.(?:map|forEach|filter|reduce)\s*\(/);
  });

  it.each(modules)("does not construct DataView in %s", (modulePath) => {
    const source = readFileSync(resolve(process.cwd(), modulePath), "utf8");
    expect(source).not.toMatch(/new\s+DataView\s*\(/);
  });
});
