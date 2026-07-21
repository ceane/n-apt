import { flowTemplates } from "../../src/ts/components/react-flow/flows/templates";

describe("Tx Suite flow", () => {
  it("contains role-specific Rx and Tx visualization branches", () => {
    const flow = flowTemplates.find((candidate) => candidate.id === "tx-suite");
    expect(flow?.label).toBe("Tx Suite (Two Devices or One Duplex Device)");
    expect(flow?.nodes.filter((node) => node.data?.sourceRole === "rx")).toHaveLength(4);
    expect(flow?.nodes.filter((node) => node.data?.sourceRole === "tx")).toHaveLength(4);
    expect(flow?.nodes.some((node) => node.data?.txOptions)).toBe(true);
    expect(flow?.nodes.some((node) => node.data?.txSignalOptions)).toBe(true);
  });
});
