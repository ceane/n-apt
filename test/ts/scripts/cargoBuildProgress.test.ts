import { describe, expect, it } from "@jest/globals";
import {
  isRebuildStatusStale,
  mergeRebuildRecentLines,
  RUST_HOT_RELOAD_BUILD_STALE_MS,
  RUST_HOT_RELOAD_WAIT_STALE_MS,
  summarizeCargoProgressChunk,
} from "../../../scripts/build/cargoBuildProgress";

describe("cargoBuildProgress", () => {
  it("summarizes the latest compiling line from a cargo chunk", () => {
    const summary = summarizeCargoProgressChunk(`
   Compiling serde v1.0.210
   Compiling n-apt-backend v0.5.0 (/tmp/n-apt)
`);
    expect(summary).toContain("Compiling n-apt-backend");
  });

  it("ignores noisy non-progress lines", () => {
    expect(
      summarizeCargoProgressChunk("   Blocking waiting for file lock on package cache"),
    ).toBeNull();
  });

  it("keeps a rolling window of recent lines", () => {
    const lines = mergeRebuildRecentLines(
      ["a", "b"],
      "c\nd\ne\nf\ng\nh\ni\nj\nk",
      8,
    );
    expect(lines).toEqual(["d", "e", "f", "g", "h", "i", "j", "k"]);
  });

  it("marks a waiting status stale after the wait ceiling", () => {
    expect(
      isRebuildStatusStale(
        { rebuilding: false, pending: true, phase: "waiting", startedAt: 0 },
        RUST_HOT_RELOAD_WAIT_STALE_MS,
      ),
    ).toBe(true);
    expect(
      isRebuildStatusStale(
        { rebuilding: false, pending: true, phase: "waiting", startedAt: 0 },
        RUST_HOT_RELOAD_WAIT_STALE_MS - 1,
      ),
    ).toBe(false);
  });

  it("marks a building status stale after the build ceiling", () => {
    expect(
      isRebuildStatusStale(
        { rebuilding: true, phase: "building", startedAt: 0 },
        RUST_HOT_RELOAD_BUILD_STALE_MS,
      ),
    ).toBe(true);
  });
});
