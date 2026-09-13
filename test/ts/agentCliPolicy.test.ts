import { evaluateCliToolRequest } from "../../scripts/cli/agent";

describe("CLI agent tool policy", () => {
  test("returns a machine-readable rejection for blocked tools", () => {
    expect(evaluateCliToolRequest("transmitSignal", false)).toEqual({
      allowed: false,
      reason: "blocked",
    });
  });

  test("requires explicit mutation opt-in", () => {
    expect(evaluateCliToolRequest("setGain", false)).toEqual({
      allowed: false,
      reason: "mutation_requires_opt_in",
    });
    expect(evaluateCliToolRequest("setGain", true)).toEqual({ allowed: true });
  });
});
