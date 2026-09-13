import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("legacy Vite root", () => {
  it("does not remount R3F auth canvases through StrictMode cleanup", () => {
    const mainSource = readFileSync(
      resolve(__dirname, "../../src/ts/app/Main.tsx"),
      "utf8",
    );

    expect(mainSource).not.toContain("<React.StrictMode>");
  });
});
