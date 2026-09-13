import {
  resolveTxSuiteControlSourceId,
  shouldPinTxSuiteToRxSource,
} from "@n-apt/transmit/public/txSuiteSourceControl";

describe("Tx Suite source control", () => {
  it("keeps the Rx role as the active control source", () => {
    expect(
      resolveTxSuiteControlSourceId({
        isTxSuite: true,
        isTxSuiteRouteActive: true,
        rxSourceId: "mock-apt",
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
      }),
    ).toBe("mock-apt");
  });

  it("does not override normal single-source selection", () => {
    expect(
      resolveTxSuiteControlSourceId({
        isTxSuite: false,
        isTxSuiteRouteActive: false,
        rxSourceId: "mock-apt",
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-tx",
      }),
    ).toBe("mock-tx");
  });

  it("only requests a pin when Tx Suite has an Rx binding", () => {
    expect(
      shouldPinTxSuiteToRxSource({
        isTxSuite: true,
        isTxSuiteRouteActive: true,
        rxSourceId: "mock-apt",
        selectedSourceId: "mock-tx",
      }),
    ).toBe(true);
    expect(
      shouldPinTxSuiteToRxSource({
        isTxSuite: true,
        isTxSuiteRouteActive: true,
        rxSourceId: null,
        selectedSourceId: "mock-tx",
      }),
    ).toBe(false);
  });

  it("does not pin Visualizer selection when Tx Suite mode is still persisted", () => {
    expect(
      shouldPinTxSuiteToRxSource({
        isTxSuite: true,
        isTxSuiteRouteActive: false,
        rxSourceId: "mock-apt",
        selectedSourceId: "mock-tx",
      }),
    ).toBe(false);
  });
});
