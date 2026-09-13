import fs from "node:fs";
import path from "node:path";

describe("markdown Vite aliases", () => {
  it("maps @n-apt/math imports to shared math", () => {
    const configPath = path.resolve(__dirname, "../../vite.markdown.config.ts");
    const config = fs.readFileSync(configPath, "utf8");

    expect(config).toContain('find: /^@n-apt\\/math\\/(.*)$/');
    expect(config).toContain("src/ts/shared/math");
  });

  it("serves markdown requests under the canonical article route", () => {
    const configPath = path.resolve(__dirname, "../../vite.markdown.config.ts");
    const config = fs.readFileSync(configPath, "utf8");

    expect(config).toContain('url.startsWith("/article/pages/")');
    expect(config).toContain('url.startsWith("/md-preview/pages/")');
  });
});
