import { resolveTxStandbyAnnouncement } from "@n-apt/streams/txStandbyAnnouncement";

describe("Tx standby control-plane announcement", () => {
  it("builds a source-owned standby status for a Tx mode handoff", () => {
    expect(
      resolveTxStandbyAnnouncement({
        id: "hackrf_one-serial",
        name: "HackRF One",
        serial_number: "serial",
      }),
    ).toEqual({
      status: "standby",
      txDevice: "HackRF One",
      serialNumber: "serial",
    });
  });

  it("falls back to the source id when display identity is absent", () => {
    expect(resolveTxStandbyAnnouncement({ id: "mock-tx" })).toEqual({
      status: "standby",
      txDevice: "mock-tx",
      serialNumber: "mock-tx",
    });
  });
});
