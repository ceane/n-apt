import fs from "node:fs";
import path from "node:path";

describe("Estimated data interleaved bins article section", () => {
  it("embeds the Interleaved bins SVG by URL in both article copies", () => {
    expect(
      fs.existsSync(path.resolve(__dirname, "../../public/images/interleaved-bins.svg")),
    ).toBe(true);

    for (const articlePath of [
      "../../pages/how-do-they-do-it.md",
      "../../docs/pages/how-do-they-do-it.md",
    ]) {
      const markdown = fs.readFileSync(path.resolve(__dirname, articlePath), "utf8");
      const estimatedData = markdown.slice(markdown.indexOf("### Estimated data"));

      expect(estimatedData).toContain("### Interleaved bins");
      expect(estimatedData).toContain("![Interleaved bins](/md-preview/images/interleaved-bins.svg)");
    }
  });

  it("marks the interleaved bins image as full bleed in the article renderer", () => {
    const app = fs.readFileSync(path.resolve(__dirname, "../../src/app-article/App.tsx"), "utf8");
    expect(app).toContain('normalizedAlt.includes("interleaved bins")');
    expect(app).toContain("@media (max-width: 768px)");
    expect(app).toContain("width: 100vw;");
    expect(app).toContain("margin-left: calc((100% - 100vw) / 2);");
  });
});
