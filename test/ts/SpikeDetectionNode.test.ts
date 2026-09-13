import { readFileSync } from "node:fs";
import { join } from "node:path";

const SPIKE_DETECTION_NODE_SOURCE = readFileSync(
  join(
    process.cwd(),
    "src/ts/features/demodulation/react-flow/nodes/SpikeDetectionNode.tsx",
  ),
  "utf8",
);

describe("SpikeDetectionNode classifier diagnostics layout", () => {
  it("uses compact spaced rows with an alternating darker diagnostic background", () => {
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain("const StripedRows");
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain("const StripedMetricRow");
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain("const NaptMetricRow");
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain("font-size: 14.3px");
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain("gap: 2px");
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain("padding: 5px 6px");
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain(
      "background: rgba(0, 0, 0, 0.15)",
    );
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain(":nth-child(even)");
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain("<StripedRows>");
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain("<StripedMetricRow>");
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain("gap: 2px;");
    expect(SPIKE_DETECTION_NODE_SOURCE).toContain("padding: 5px 6px");
  });
});
