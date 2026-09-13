import fs from "node:fs";
import path from "node:path";

describe("Estimated data table mobile layout", () => {
  it("constrains tiny tables and enables horizontal scrolling", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/app-article/App.tsx"),
      "utf8",
    );

    expect(source).toMatch(/--article-gutter:\s*clamp\(32px, 5vw, 72px\);[\s\S]*?padding:\s*var\(--article-gutter\);/);
    expect(source).toMatch(/\.estimated-data-table[\s\S]*?width:\s*min\(100%,\s*calc\(100vw - \(2 \* var\(--article-gutter\)\)\)\);/);
    expect(source).toMatch(/\.estimated-data-table[\s\S]*?max-width:\s*calc\(100vw - \(2 \* var\(--article-gutter\)\)\);[\s\S]*?overflow-x:\s*auto;/);
    expect(source).toMatch(/\.estimated-data-table[\s\S]*?table[\s\S]*?min-width:\s*720px;/);
  });
});
