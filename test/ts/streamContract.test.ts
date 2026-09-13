import {
  STREAM_CONTROL_CONTRACT,
  resolveStreamControlScope,
} from "@n-apt/app/infrastructure/streams/streamContract";

describe("stream control contract", () => {
  it("keeps RX playback subscriber-scoped and RX controls device-scoped", () => {
    expect(resolveStreamControlScope("rx", "pause")).toBe("subscriber");
    expect(resolveStreamControlScope("rx", "settings")).toBe("device");
    expect(resolveStreamControlScope("rx", "tune")).toBe("device");
  });

  it("keeps TX control shared by the device", () => {
    expect(resolveStreamControlScope("tx", "pause")).toBe("device");
    expect(resolveStreamControlScope("tx", "stop")).toBe("device");
    expect(resolveStreamControlScope("tx", "settings")).toBe("device");
    expect(STREAM_CONTROL_CONTRACT.tx.stop).toBe("device");
  });
});
