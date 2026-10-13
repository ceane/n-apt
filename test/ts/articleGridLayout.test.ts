import fs from "node:fs";
import path from "node:path";

const appSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/app-article/App.tsx"),
  "utf8",
);
const canvasHarnessSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/app-article/components/canvas/CanvasHarness.tsx"),
  "utf8",
);

describe("article grid layout", () => {
  it("uses a centered reading column with explicit article gutters", () => {
    const articleStart = appSource.indexOf("const ArticleContent = styled.article`");
    const articleEnd = appSource.indexOf("\n`;", articleStart);
    const articleStyles = appSource.slice(articleStart, articleEnd);

    expect(articleStyles).toContain("display: grid;");
    expect(articleStyles).toContain(
      "grid-template-columns: var(--article-gutter) minmax(0, 1fr) var(--article-gutter);",
    );
    expect(articleStyles).toContain(
      "> * {\n    grid-column: 2;\n    min-width: 0;\n  }",
    );
    expect(articleStyles).toContain("&& > * + * {\n    margin-top: 0;\n  }");
    expect(articleStyles).toContain("max-width: 800px;");
    expect(articleStyles).not.toContain("padding: var(--article-gutter);");
  });

  it("puts mobile images and canvases on the full track and keeps the collage inset", () => {
    expect(appSource).toContain("> figure,\n    > .article-canvas,\n    > .article-canvas-placeholder,");
    expect(appSource).toContain("grid-column: 1 / -1;");
    expect(appSource).toContain("width: calc(100% - 16px);");
    expect(appSource).toContain("margin-inline: auto;");
    expect(canvasHarnessSource).toContain('className={`article-canvas');
    expect(appSource).toContain('className="article-canvas-placeholder"');
    expect(appSource).toContain("> figure > img {\n      border-radius: 0;\n    }");
  });

  it("keeps canvas width governed by the article grid instead of viewport breakout offsets", () => {
    const mobileStart = canvasHarnessSource.indexOf("@media (max-width: 768px)");
    const mobileEnd = canvasHarnessSource.indexOf("\n  }", mobileStart);
    const mobileStyles = canvasHarnessSource.slice(mobileStart, mobileEnd);

    expect(mobileStyles).not.toContain("width: 100vw;");
    expect(mobileStyles).not.toContain("margin-left: 50%;");
    expect(mobileStyles).not.toContain("transform: translateX(-50%);");
  });

  it("retains constrained horizontal table scrolling in the reading track", () => {
    const wrapperStart = appSource.indexOf("  .table-scroll-wrapper {");
    const wrapperEnd = appSource.indexOf("  .table-dense", wrapperStart);
    const wrapperStyles = appSource.slice(wrapperStart, wrapperEnd);

    expect(wrapperStyles).toContain("min-width: 0;");
    expect(wrapperStyles).toContain("overflow-x: auto;");
    expect(wrapperStyles).toContain("width: max-content;");
    expect(wrapperStyles).toContain("width: stretch;");
  });
});
