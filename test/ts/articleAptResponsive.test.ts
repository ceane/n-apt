import fs from "node:fs";
import path from "node:path";
import katex from "katex";

describe("Automatic Picture Transmission responsive variable key", () => {
  it("provides aligned desktop and stacked mobile KaTeX keys", () => {
    const markdown = fs.readFileSync(
      path.resolve(__dirname, "../../pages/how-do-they-do-it.md"),
      "utf8",
    );
    const aptStart = markdown.indexOf("### Automatic Picture Transmission / APT.");
    const aptEnd = markdown.indexOf("### Frequency Modulation", aptStart);
    const aptSection = markdown.slice(aptStart, aptEnd);
    const desktopMatch = aptSection.match(/<desktop-only>\s*```latex\s*([\s\S]*?)```\s*<\/desktop-only>/);
    const mobileMatch = aptSection.match(/<mobile-only>\s*```latex\s*([\s\S]*?)```\s*<\/mobile-only>/);

    expect(desktopMatch).not.toBeNull();
    expect(mobileMatch).not.toBeNull();

    const desktopSource = desktopMatch?.[1] ?? "";
    const mobileSource = mobileMatch?.[1] ?? "";
    expect(desktopSource).toContain("\\begin{aligned}");
    expect(mobileSource).toContain("\\begin{array}{l}");
    expect(mobileSource).toContain("s_{\\mathrm{RF}}(t)");
    expect(mobileSource).toContain("\\text{Final transmitted RF signal}");
    expect(mobileSource).toContain("\\text{Normalized image intensity signal}");

    for (const source of [desktopSource, mobileSource]) {
      const expression = source.match(/\\\[([\s\S]*?)\\\]/)?.[1];
      expect(expression).toBeDefined();
      expect(katex.renderToString(expression ?? "", {
        displayMode: true,
        throwOnError: true,
        output: "html",
      })).toContain('class="katex-display"');
    }
  });
});
