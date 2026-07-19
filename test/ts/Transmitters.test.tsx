import { SDRs } from "@n-apt/components/3D/SDRs";

describe("SDRs", () => {
  it("keeps transmit-capable and receive-only hardware in separate namespaces", () => {
    expect(SDRs.tx.HackRFOne).toBeDefined();
    expect(SDRs.rx.RTLSdr).toBeDefined();
    expect(SDRs.rx.SDRplay).toBeDefined();
    expect("RTLSdr" in SDRs.tx).toBe(false);
  });
});
