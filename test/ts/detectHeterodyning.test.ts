import { detectHeterodyningFromHistory } from "../../src/ts/utils/detectHeterodyning";

function buildHistory(rows: number, cols: number, periodicColumns: number[] = []) {
  const history: Float32Array[] = [];

  for (let row = 0; row < rows; row++) {
    const data = new Float32Array(cols);
    for (let col = 0; col < cols; col++) {
      data[col] = -100 + ((row + col) % 3);
    }
    for (const col of periodicColumns) {
      data[col] = row % 2 === 0 ? -72 : -112;
      if (col + 1 < cols) {
        data[col + 1] = row % 2 === 0 ? -76 : -108;
      }
    }
    history.push(data);
  }

  return history;
}

describe("detectHeterodyningFromHistory", () => {
  it("returns not enough history when too few rows are available", () => {
    const result = detectHeterodyningFromHistory(buildHistory(8, 128, [16, 48]));

    expect(result.detected).toBe(false);
    expect(result.statusText).toBe("Not enough history");
    expect(result.highlightedBins).toHaveLength(0);
  });

  it("detects repeating stripe columns from recent waterfall history", () => {
    const result = detectHeterodyningFromHistory(buildHistory(64, 128, [12, 36, 60, 84]));

    expect(result.detected).toBe(true);
    expect(result.confidence).not.toBeNull();
    expect(result.highlightedBins.length).toBeGreaterThanOrEqual(2);
    expect(result.statusText).toMatch(/^Detected/);
  });

  it("does not report heterodyning for flat noisy history", () => {
    const result = detectHeterodyningFromHistory(buildHistory(64, 128));

    expect(result.detected).toBe(false);
    expect(result.highlightedBins).toHaveLength(0);
    expect(result.statusText).toMatch(/^Not detected|No periodic pattern/);
  });
});
