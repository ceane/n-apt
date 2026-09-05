import { describe, expect, it } from "@jest/globals";
import {
  isRebuildStatusStale,
  mergeRebuildRecentLines,
  RUST_HOT_RELOAD_BUILD_STALE_MS,
  RUST_HOT_RELOAD_WAIT_STALE_MS,
  summarizeCargoProgressChunk,
  summarizeRustBuildFailure,
  formatCargoBuildHeartbeat,
} from "../../../scripts/build/cargoBuildProgress";

describe("cargoBuildProgress", () => {
  it("summarizes the latest compiling line from a cargo chunk", () => {
    const summary = summarizeCargoProgressChunk(`
   Compiling serde v1.0.210
   Compiling n-apt-backend v0.5.0 (/tmp/n-apt)
`);
    expect(summary).toContain("Compiling n-apt-backend");
  });

  it("describes the n-apt-backend target during its long build", () => {
    expect(
      summarizeCargoProgressChunk(
        "Building [=====================> ] 404/406: n-apt-backend",
      ),
    ).toBe("Compiling n-apt-backend (404/406)");
  });

  it("distinguishes the backend crate from its binary target", () => {
    expect(summarizeCargoProgressChunk("Compiling n-apt-backend v0.5.0 (/tmp/n-apt)"))
      .toBe("Compiling n-apt-backend crate");
    expect(summarizeCargoProgressChunk("Building [====================] 405/406: n-apt-backend(bin)"))
      .toBe("Building n-apt-backend binary (405/406)");
  });

  it("describes a quiet n-apt-backend rustc interval", () => {
    expect(formatCargoBuildHeartbeat("Compiling n-apt-backend crate", 125_000))
      .toBe("Compiling n-apt-backend crate — rustc is still processing this crate (2m 5s elapsed)");
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

  it("keeps the actionable compiler diagnostic in the rebuild status", () => {
    expect(
      summarizeRustBuildFailure(
        "error[E0308]: mismatched types\n  --> src/rs/tx/monitor.rs:1:1\nerror: could not compile `n-apt-backend`",
      ),
    ).toBe("error[E0308]: mismatched types | error: could not compile `n-apt-backend`");
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
