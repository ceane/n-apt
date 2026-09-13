import {
  resolveContainedPath,
} from "../../scripts/encrypted-modules/pathSafety";

describe("resolveContainedPath", () => {
  it("rejects traversal and absolute bundle paths", () => {
    expect(() => resolveContainedPath("/tmp/output", "../outside.txt")).toThrow(
      /outside target directory/i,
    );
    expect(() => resolveContainedPath("/tmp/output", "/tmp/outside.txt")).toThrow(
      /relative/i,
    );
  });

  it("resolves a normal relative bundle path inside the target", () => {
    expect(resolveContainedPath("/tmp/output", "nested/file.txt")).toBe(
      "/tmp/output/nested/file.txt",
    );
  });
});
