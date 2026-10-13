import fs from "node:fs";
import path from "node:path";

describe("article WebGPU renderer sizing", () => {
  it("sizes the WebGPU drawing buffer before returning the initialized renderer", () => {
    const layoutsSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/app-article/components/canvas/shared/Layouts.tsx",
      ),
      "utf8",
    );

    expect(layoutsSource).toMatch(
      /await renderer\.init\(\);[\s\S]{0,160}syncRendererSizeToCanvas\(renderer, props\.canvas(?: as HTMLCanvasElement)?\);/,
    );
    expect(layoutsSource).toContain("canvas.getBoundingClientRect()");
    expect(layoutsSource).toContain("renderer.setSize(width, height, false);");
  });

  it("resynchronizes a retained renderer when the canvas mounts or changes size", () => {
    const layoutsSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/app-article/components/canvas/shared/Layouts.tsx",
      ),
      "utf8",
    );

    expect(layoutsSource).toContain("useLayoutEffect");
    expect(layoutsSource).toContain("useThree");
    expect(layoutsSource).toMatch(
      /function RendererSizeSync\(\)[\s\S]*?useLayoutEffect\(\(\) => \{[\s\S]*?gl\.setSize\(size\.width, size\.height, false\);[\s\S]*?\}, \[gl, size\.width, size\.height\]\);/,
    );
    expect(layoutsSource).toMatch(/<Canvas[\s\S]*?<RendererSizeSync \/>/);
  });
});
