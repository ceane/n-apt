import fs from "node:fs";
import path from "node:path";

describe("Estimated data article LaTeX", () => {
  it("wraps each display formula in a fenced latex block", () => {
    const markdown = fs.readFileSync(
      path.resolve(__dirname, "../../pages/how-do-they-do-it.md"),
      "utf8",
    );
    const estimatedData = markdown.slice(markdown.indexOf("### Estimated data"));

    for (const expression of [
      String.raw`\text{FFT size}=\text{channel sample rate}\div24\text{ Hz}`,
      String.raw`\text{FFT size}=\text{channel sample rate}\div60\text{ Hz}`,
      String.raw`\text{frame bytes}=\text{FFT size}\times\text{bytes per I/Q bin}`,
    ]) {
      expect(estimatedData).toContain(`\`\`\`latex\n\\[\n${expression}\n\\]\n\`\`\``);
    }
  });
});
