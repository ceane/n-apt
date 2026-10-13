import fs from "node:fs";
import path from "node:path";
import katex from "katex";

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

  it("keeps the beat-frequency variable key in a compact two-column KaTeX array", () => {
    const markdown = fs.readFileSync(
      path.resolve(__dirname, "../../pages/how-do-they-do-it.md"),
      "utf8",
    );
    const beatFrequencyStart = markdown.indexOf("Throughout my research[^math]");
    const latexFenceStart = markdown.indexOf("```LaTex", beatFrequencyStart);
    const latexFenceEnd = markdown.indexOf("\n```", latexFenceStart + "```LaTex".length);
    const keyFenceStart = markdown.indexOf("```latex math-variable-key", latexFenceEnd + "\n```".length);
    const keyFenceEnd = markdown.indexOf("\n```", keyFenceStart + "```latex math-variable-key".length);
    const beatFrequencyBlock = markdown.slice(beatFrequencyStart, latexFenceEnd);
    const latexSource = markdown.slice(latexFenceStart, latexFenceEnd);
    const keySource = markdown.slice(keyFenceStart, keyFenceEnd);
    const expressions = [...latexSource.matchAll(/\\\[([\s\S]*?)\\\]/g)].map((match) => match[1]);
    const appSource = fs.readFileSync(
      path.resolve(__dirname, "../../src/app-article/App.tsx"),
      "utf8",
    );

    expect(beatFrequencyBlock).not.toContain("\\rule");
    expect(beatFrequencyBlock).not.toContain("\\small");
    expect(keySource).toContain("\\begin{array}{ll}");
    expect(keySource).toContain("\\text{Individual waveforms}");
    expect(keySource).toContain("\\text{Beat frequency}");
    expect(keySource).toContain("\\text{Resulting superposed}");
    expect(keySource).toContain("\\text{Frequencies of the}");
    expect(keySource).toContain("\\text{two waves (Hz)}");
    expect(keySource).toContain("\\text{(envelope from difference}");
    expect(keySource).toContain("\\text{of frequencies)}");
    expect(keySource).toContain("\\small");
    expect(keySource.match(/\\\\\[1\.25em\]/g)).toHaveLength(4);
    expect(keySource.match(/\\\\\[1\.75em\]/g)).toHaveLength(1);
    expect(keySource.match(/\\begin\{array\}\{l\}/g)).toHaveLength(3);
    expect(appSource).toContain(".katex-display");
    expect(appSource).toContain(".article-latex-block.math-variable-key .katex-display");
    expect(appSource).toContain("font-size: 1.1em;");
    expect(expressions).toHaveLength(4);
    for (const expression of expressions) {
      expect(katex.renderToString(expression, {
        displayMode: true,
        throwOnError: true,
        output: "html",
      })).toContain('class="katex-display"');
    }
  });
});
