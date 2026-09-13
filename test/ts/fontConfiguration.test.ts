import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");
const fontFiles = [
  "src/ts/fonts.css",
  "src/ts/features/learn/styles/fonts.css",
];
const canvasFiles = [
  "src/ts/features/learn/Aperture.tsx",
  "src/ts/features/learn/Heterodyning.tsx",
  "src/ts/features/learn/Triangulation.tsx",
];
const removedFontFamily = ["Silence", " Sans"].join("");
const removedFontAsset = ["SilenceSans", "-Regular.ttf"].join("");

describe("application typography", () => {
  it("uses Inter as the sans-serif font throughout the app and learn canvases", () => {
    const source = [...fontFiles, ...canvasFiles]
      .map((file) => fs.readFileSync(path.join(repoRoot, file), "utf8"))
      .join("\n");

    expect(source).toContain('"Inter"');
    expect(source).not.toContain(removedFontFamily);
    expect(source).not.toContain(removedFontAsset);
    expect(
      fs.existsSync(path.join(repoRoot, `public/fonts/${removedFontAsset}`)),
    ).toBe(false);
    expect(
      fs.readFileSync(path.join(repoRoot, "src/ts/index.html"), "utf8"),
    ).toContain("family=Inter");
  });
});
