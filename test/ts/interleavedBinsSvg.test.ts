import fs from "node:fs";
import path from "node:path";

describe("Interleaved bins SVG", () => {
  it("contains selectable labels for the alternating frequency grid", () => {
    const svg = fs.readFileSync(
      path.resolve(__dirname, "../../public/images/interleaved-bins.svg"),
      "utf8",
    );

    expect(svg).toContain('viewBox="0 0 960 500"');
    expect(svg).toContain("Shared orthogonal frequency grid");
    expect(svg).toContain("Frequency →");
    expect(svg).toContain("Both signals are present simultaneously");
    expect(svg).toContain("X[2k] = R[k]");
    expect(svg).toContain("X[2k + 1] = W[k]");

    for (const label of ["R0", "W0", "R1", "W1", "R2", "W2", "R3", "W3", "R4", "W4"]) {
      expect(svg).toContain(`>${label}<`);
    }
  });
});
