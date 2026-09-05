import fs from "node:fs";
import path from "node:path";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
) as { scripts?: Record<string, string> };
const buildScriptPath = path.resolve(
  process.cwd(),
  "scripts/build/inline-webusb-build.mjs",
);
const viteConfigPath = path.resolve(process.cwd(), "vite.webusb.config.ts");

describe("self-contained WebUSB build", () => {
  it("builds only the singleton WebUSB probe entry", () => {
    const viteConfig = fs.readFileSync(viteConfigPath, "utf8");

    expect(viteConfig).toContain(
      "webUsbProbe: path.resolve(dirname, \"src/ts/webusb-probe/index.html\")",
    );
    expect(viteConfig).not.toContain("lite: path.resolve");
    expect(viteConfig).not.toContain("src/ts/lite/index.html");
  });

  it("runs the Vite build followed by the single-file inliner", () => {
    expect(packageJson.scripts?.["build:webusb"]).toBe(
      "vite build --config vite.webusb.config.ts && node scripts/build/inline-webusb-build.mjs",
    );
  });

  it("bundles entry imports and minifies the final HTML document", () => {
    const buildScript = fs.readFileSync(buildScriptPath, "utf8");

    expect(buildScript).toContain("bundle: true");
    expect(buildScript).toContain("minify: true");
    expect(buildScript).toContain("<script type=\"module\">");
    expect(buildScript).toContain("modulepreload");
    expect(buildScript).toContain("minifyCss");
    expect(buildScript).not.toMatch(/replace\(\/<!--/);
    expect(buildScript).toContain(
      '.replace(/\\s*([{}:;,>])\\s*/g, "$1")',
    );
    expect(buildScript).toContain("replace(/<\\/script/gi, \"<\\\\/script\")");
    expect(buildScript).toContain(
      '() => `<script type="module">${htmlSafeScript}</script>`',
    );
    expect(buildScript).toContain("result.outputFiles[0].text.trim()");
    expect(buildScript).toContain("rm");
  });
});
