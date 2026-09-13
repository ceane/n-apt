import { describe, expect, it } from "@jest/globals";

describe("Rust watcher path filter", () => {
  it("accepts Rust files inside src/rs and rejects frontend or outside paths", () => {
    const { isRustSourceChange } = require("../../scripts/build/rustWatchFilter");
    const root = "/workspace/src/rs";

    expect(isRustSourceChange(root, "server/main.rs")).toBe(true);
    expect(isRustSourceChange(root, "Cargo.toml")).toBe(true);
    expect(isRustSourceChange(root, "../ts/App.tsx")).toBe(false);
    expect(isRustSourceChange(root, "/workspace/src/ts/app/App.tsx")).toBe(false);
    expect(isRustSourceChange(root, "server/main.txt")).toBe(false);
  });
});
