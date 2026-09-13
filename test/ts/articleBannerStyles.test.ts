import fs from "node:fs";
import path from "node:path";

describe("article repository banner shell styles", () => {
  it("resets the document edges before React styles load", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "../../src/app-article/index.html"), "utf8");

    expect(html).toMatch(/html,\s*body\s*\{/);
    expect(html).toContain("margin: 0;");
    expect(html).toContain("width: 100%;");
    expect(html).toContain("box-sizing: border-box;");
    expect(html).toContain("width: 100vw;");
    expect(html).not.toContain("margin-left: calc(50% - 50vw);");
  });
});
