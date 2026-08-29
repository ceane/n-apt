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
});
