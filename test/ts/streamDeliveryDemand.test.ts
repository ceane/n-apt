import {
  acquireStreamDeliveryDemand,
  getStreamDeliveryDemandPolicy,
  resetStreamDeliveryDemands,
  subscribeStreamDeliveryDemand,
} from "@n-apt/app/infrastructure/streams/streamDeliveryDemand";

describe("stream delivery demand", () => {
  afterEach(() => resetStreamDeliveryDemands());

  it("upgrades one source demand to lossless and downgrades after release", () => {
    const key = { sourceId: "mock-apt", mode: "rx" as const };
    const updates: string[] = [];
    const unsubscribe = subscribeStreamDeliveryDemand((_key, policy) => {
      updates.push(policy);
    });

    const latestRelease = acquireStreamDeliveryDemand(key, "latest");
    const losslessRelease = acquireStreamDeliveryDemand(key, "lossless");
    expect(getStreamDeliveryDemandPolicy(key)).toBe("lossless");

    losslessRelease();
    expect(getStreamDeliveryDemandPolicy(key)).toBe("latest");
    latestRelease();
    unsubscribe();

    expect(updates).toEqual(["latest", "lossless", "latest", "latest"]);
  });
});
