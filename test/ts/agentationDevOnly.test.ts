import fs from "node:fs";
import path from "node:path";

describe("article Agentation integration", () => {
  it("loads Agentation only through the development flag", () => {
    const appSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/app-article/App.tsx"),
      "utf8",
    );

    expect(appSource).not.toMatch(/import\s*\{\s*Agentation\s*\}\s*from\s*[\"']agentation/);
    expect(appSource).toMatch(/__DEV__\s*\?\s*lazy\(\(\)\s*=>\s*import\([\"']agentation[\"']\)/);
  });
});
