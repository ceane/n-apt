import {
  DEFAULT_SAMPLE_RATE_HZ,
  FRAME_SAMPLE_COUNT,
  readRtlSdrFrame,
} from "@n-apt/app/routes/pages/webUsbRtlSdr";
import { RtlSdrWebUsbSession } from "@n-apt/webusb/rtlSdrWebUsb";

function createHardware() {
  const samples = Uint8Array.from([99, 128, 129, 255, 64, 88]);
  const device = {
    vendorId: 0x0bda,
    productId: 0x2838,
    productName: "RTL2838",
    opened: false,
    configuration: null as null | {
      interfaces: Array<{
        alternates: Array<{
          endpoints: Array<{ endpointNumber: number; direction: string; type: string }>;
        }>;
      }>;
    },
    open: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
    selectConfiguration: jest.fn(async () => undefined),
    claimInterface: jest.fn(async () => undefined),
    releaseInterface: jest.fn(async () => undefined),
    controlTransferOut: jest.fn(async (_setup: { value: number; index: number }, data?: ArrayBuffer) => ({
      status: "ok",
      bytesWritten: data?.byteLength ?? 0,
    })),
    controlTransferIn: jest.fn(async (_setup: unknown, length: number) => ({
      status: "ok",
      data: new DataView(new ArrayBuffer(length)),
    })),
    transferIn: jest.fn(async (_endpoint: number, _length: number) => ({
      status: "ok",
      data: new DataView(samples.buffer, 1, 4) as DataView | null,
    })),
    clearHalt: jest.fn(async () => undefined),
  };
  const usb = {
    getDevices: jest.fn(async () => [device]),
    requestDevice: jest.fn(async () => device),
  };
  return { device, usb, samples };
}

describe("WebUSB experiment shared transport adapter", () => {
  afterEach(() => jest.restoreAllMocks());

  it("connects the shared session directly with the demod-only profile", async () => {
    const { device, usb } = createHardware();
    const session = new RtlSdrWebUsbSession(usb, "experiment-demod-only");
    await expect(session.connect({ fftSize: FRAME_SAMPLE_COUNT })).resolves.toMatchObject({
      sampleRateHz: DEFAULT_SAMPLE_RATE_HZ,
      fftSize: FRAME_SAMPLE_COUNT,
    });
    expect(device.controlTransferIn).not.toHaveBeenCalled();
    await expect(session.readFrame()).resolves.toEqual(Uint8Array.from([128, 129, 255, 64]));
    await session.disconnect();
  });

  it("rejects live option updates for the one-shot experiment profile without writing hardware", async () => {
    const { device, usb } = createHardware();
    const session = new RtlSdrWebUsbSession(usb, "experiment-demod-only");
    await session.connect();
    device.controlTransferOut.mockClear();
    await expect(session.updateOptions({ sampleRateHz: 2_000_000, ppm: 3 })).rejects.toThrow(
      "The demod-only experiment does not support live option updates.",
    );
    expect(device.controlTransferOut).not.toHaveBeenCalled();
    expect(device.controlTransferIn).not.toHaveBeenCalled();
    await session.disconnect();
  });

  it("keeps the experiment's open call even for an already opened device", async () => {
    const { device, usb } = createHardware();
    device.opened = true;
    await readRtlSdrFrame({ usb });
    expect(device.open).toHaveBeenCalledTimes(1);
  });

  it("uses the persistent session transport for its single copied frame", async () => {
    const { device, usb, samples } = createHardware();
    const connect = jest.spyOn(RtlSdrWebUsbSession.prototype, "connect");
    const readFrame = jest.spyOn(RtlSdrWebUsbSession.prototype, "readFrame");
    const disconnect = jest.spyOn(RtlSdrWebUsbSession.prototype, "disconnect");

    const frame = await readRtlSdrFrame({ usb });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(readFrame).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(frame).toEqual({
      data: Uint8Array.from([128, 129, 255, 64]),
      deviceLabel: "RTL2838",
      endpointNumber: 1,
      sampleRateHz: 1_024_000,
    });
    samples.fill(0);
    expect(frame.data).toEqual(Uint8Array.from([128, 129, 255, 64]));
    expect(device.transferIn).toHaveBeenCalledWith(1, 16_384 * 2);
    expect(usb.requestDevice).not.toHaveBeenCalled();
    expect(device.selectConfiguration).toHaveBeenCalledWith(1);
    expect(device.releaseInterface.mock.invocationCallOrder[0]).toBeLessThan(
      device.close.mock.invocationCallOrder[0],
    );
  });

  it("preserves every demod-only initialization write without flush reads or tuner programming", async () => {
    const { device, usb } = createHardware();
    await readRtlSdrFrame({ usb });
    const demod = (page: number, address: number, ...bytes: number[]) =>
      [page | 0x10, (address << 8) | 0x20, bytes];
    const ratio = Math.floor((28_800_000 * (1 << 22)) / DEFAULT_SAMPLE_RATE_HZ) & 0x0ffffffc;
    expect(device.controlTransferOut.mock.calls.map(([setup, data]) => [
      setup.index, setup.value, Array.from(new Uint8Array(data!)),
    ])).toEqual([
      [0x110, 0x2000, [0x09]],
      [0x110, 0x2158, [0x00, 0x02]],
      [0x110, 0x2148, [0x10, 0x02]],
      [0x210, 0x300b, [0x22]],
      [0x210, 0x3000, [0xe8]],
      demod(1, 0x01, 0x14),
      demod(1, 0x01, 0x10),
      demod(1, 0x15, 0),
      ...[0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b].map((address) => demod(1, address, 0)),
      ...[0xca, 0xdc, 0xd7, 0xd8, 0xe0, 0xf2, 0x0e, 0x35, 0x06, 0x50,
        0x9c, 0x0d, 0x71, 0x11, 0x14, 0x71, 0x74, 0x19, 0x41, 0xa5,
      ].map((value, offset) => demod(1, 0x1c + offset, value)),
      ...[[0, 0x19, 0x05], [1, 0x93, 0xf0], [1, 0x94, 0x0f],
        [1, 0x11, 0], [1, 0x04, 0], [0, 0x61, 0x60], [0, 0x06, 0x80],
        [1, 0xb1, 0x1b], [0, 0x0d, 0x83],
      ].map(([page, address, value]) => demod(page, address, value)),
      demod(1, 0x9f, (ratio >>> 24) & 0xff, (ratio >>> 16) & 0xff),
      demod(1, 0xa1, (ratio >>> 8) & 0xff, ratio & 0xff),
      demod(1, 0x01, 0x14),
      demod(1, 0x01, 0x10),
      [0x110, 0x2148, [0x10, 0x02]],
      [0x110, 0x2148, [0, 0]],
    ]);
    expect(device.controlTransferIn).not.toHaveBeenCalled();
  });

  it("retains the experiment's unnormalized sample rate and discovered bulk endpoint", async () => {
    const { device, usb } = createHardware();
    device.configuration = { interfaces: [{ alternates: [{ endpoints: [
      { endpointNumber: 3, direction: "out", type: "bulk" },
      { endpointNumber: 2, direction: "in", type: "bulk" },
    ] }] }] };
    const frame = await readRtlSdrFrame({ usb, sampleRateHz: 4_000_000.5 });
    expect(frame.sampleRateHz).toBe(4_000_000.5);
    expect(device.transferIn).toHaveBeenCalledWith(2, FRAME_SAMPLE_COUNT * 2);
    expect(device.selectConfiguration).not.toHaveBeenCalled();
  });

  it.each(["stall", "babble", "ok"])("cleans up an unsuccessful %s frame", async (status) => {
    const { device, usb } = createHardware();
    device.transferIn.mockResolvedValue({ status, data: null });
    await expect(readRtlSdrFrame({ usb })).rejects.toThrow("sample read failed");
    expect(device.clearHalt).toHaveBeenCalledTimes(status === "stall" ? 1 : 0);
    if (status === "stall") expect(device.clearHalt).toHaveBeenCalledWith("in", 1);
    expect(device.releaseInterface).toHaveBeenCalledWith(0);
    expect(device.close).toHaveBeenCalledTimes(1);
  });

  it.each(["open", "claimInterface", "controlTransferOut", "transferIn"] as const)(
    "preserves the original error and releases acquired resources when %s fails",
    async (operation) => {
      const { device, usb } = createHardware();
      const failure = new Error(operation);
      device[operation].mockRejectedValueOnce(failure);
      device.releaseInterface.mockRejectedValue(new Error("release failed"));
      device.close.mockRejectedValue(new Error("close failed"));
      await expect(readRtlSdrFrame({ usb })).rejects.toBe(failure);
      expect(device.releaseInterface).toHaveBeenCalledTimes(
        operation === "open" || operation === "claimInterface" ? 0 : 1,
      );
      expect(device.close).toHaveBeenCalledTimes(operation === "open" ? 0 : 1);
    },
  );

  it("propagates chooser cancellation without touching hardware", async () => {
    const { device, usb } = createHardware();
    usb.getDevices.mockResolvedValue([]);
    const failure = new Error("No device selected");
    usb.requestDevice.mockRejectedValue(failure);
    await expect(readRtlSdrFrame({ usb })).rejects.toBe(failure);
    expect(device.open).not.toHaveBeenCalled();
    expect(device.close).not.toHaveBeenCalled();
  });
});
