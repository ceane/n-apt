type UsbTransferStatus = "ok" | "stall" | "babble" | string;

export interface WebUsbEndpointLike {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous" | string;
}

export interface WebUsbDeviceLike {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  opened: boolean;
  configuration: {
    interfaces: Array<{
      alternates: Array<{
        endpoints: WebUsbEndpointLike[];
      }>;
    }>;
  } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  controlTransferOut(
    setup: {
      requestType: "vendor";
      recipient: "device";
      request: number;
      value: number;
      index: number;
    },
    data?: ArrayBuffer,
  ): Promise<{ status: UsbTransferStatus; bytesWritten: number }>;
  transferIn(
    endpointNumber: number,
    length: number,
  ): Promise<{
    status: UsbTransferStatus;
    data?: DataView | null;
  }>;
  clearHalt(direction: "in" | "out", endpointNumber: number): Promise<void>;
}

export interface WebUsbLike {
  getDevices(): Promise<WebUsbDeviceLike[]>;
  requestDevice(options: {
    filters: Array<{ vendorId: number; productId: number }>;
  }): Promise<WebUsbDeviceLike>;
}

export const RTL_SDR_FILTERS = [
  { vendorId: 0x0bda, productId: 0x2832 },
  { vendorId: 0x0bda, productId: 0x2838 },
] as const;

const RTL_INTERFACE = 0;
const RTL_BULK_IN_ENDPOINT = 1;
const RTL_XTAL_HZ = 28_800_000;
const RTL_WRITE_FLAG = 0x10;

export const DEFAULT_SAMPLE_RATE_HZ = 1_024_000;
export const FRAME_SAMPLE_COUNT = 16_384;

type RegisterWrite = {
  block: number;
  register: number;
  value: number;
  bytes: number;
  bigEndian?: boolean;
};

function toBuffer(
  value: number,
  bytes: number,
  bigEndian = false,
): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);

  if (bytes === 1) view.setUint8(0, value);
  else if (bytes === 2) view.setUint16(0, value, !bigEndian);
  else if (bytes === 4) view.setUint32(0, value, !bigEndian);
  else throw new Error(`Unsupported RTL-SDR register width: ${bytes}`);

  return buffer;
}

async function writeRegister(
  device: WebUsbDeviceLike,
  { block, register, value, bytes, bigEndian }: RegisterWrite,
): Promise<void> {
  const result = await device.controlTransferOut(
    {
      requestType: "vendor",
      recipient: "device",
      request: 0,
      value: register,
      index: block | RTL_WRITE_FLAG,
    },
    toBuffer(value, bytes, bigEndian),
  );

  if (result.status !== "ok") {
    throw new Error(
      `RTL-SDR control write failed (register 0x${register.toString(16)}, status ${result.status})`,
    );
  }
}

async function writeDemodRegister(
  device: WebUsbDeviceLike,
  page: number,
  address: number,
  value: number,
  bytes = 1,
): Promise<void> {
  await writeRegister(device, {
    block: page,
    register: (address << 8) | 0x20,
    value,
    bytes,
    bigEndian: true,
  });
}

async function initializeRtl2832u(
  device: WebUsbDeviceLike,
  sampleRateHz: number,
): Promise<void> {
  // This is the RTL2832U demodulator/USB path only. Tuner-specific I2C
  // programming is deliberately left out of this first WebUSB experiment.
  const registers: RegisterWrite[] = [
    { block: 0x100, register: 0x2000, value: 0x09, bytes: 1 },
    { block: 0x100, register: 0x2158, value: 0x0200, bytes: 2 },
    { block: 0x100, register: 0x2148, value: 0x0210, bytes: 2 },
    { block: 0x200, register: 0x300b, value: 0x22, bytes: 1 },
    { block: 0x200, register: 0x3000, value: 0xe8, bytes: 1 },
  ];

  for (const register of registers) await writeRegister(device, register);

  await writeDemodRegister(device, 1, 0x01, 0x14);
  await writeDemodRegister(device, 1, 0x01, 0x10);
  await writeDemodRegister(device, 1, 0x15, 0x00);

  for (const address of [0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b]) {
    await writeDemodRegister(device, 1, address, 0x00);
  }

  const lpfCoefficients = [
    0xca, 0xdc, 0xd7, 0xd8, 0xe0, 0xf2, 0x0e, 0x35, 0x06, 0x50, 0x9c, 0x0d,
    0x71, 0x11, 0x14, 0x71, 0x74, 0x19, 0x41, 0xa5,
  ];
  for (const [offset, value] of lpfCoefficients.entries()) {
    await writeDemodRegister(device, 1, 0x1c + offset, value);
  }

  const remainingRegisters: Array<[number, number, number]> = [
    [0, 0x19, 0x05],
    [1, 0x93, 0xf0],
    [1, 0x94, 0x0f],
    [1, 0x11, 0x00],
    [1, 0x04, 0x00],
    [0, 0x61, 0x60],
    [0, 0x06, 0x80],
    [1, 0xb1, 0x1b],
    [0, 0x0d, 0x83],
  ];
  for (const [page, address, value] of remainingRegisters) {
    await writeDemodRegister(device, page, address, value);
  }

  const ratio =
    Math.floor((RTL_XTAL_HZ * (1 << 22)) / sampleRateHz) & 0x0ffffffc;
  await writeDemodRegister(device, 1, 0x9f, (ratio >> 16) & 0xffff, 2);
  await writeDemodRegister(device, 1, 0xa1, ratio & 0xffff, 2);
  await writeDemodRegister(device, 1, 0x01, 0x14);
  await writeDemodRegister(device, 1, 0x01, 0x10);

  // Reset/stall the RTL2832U bulk FIFO before the first read.
  await writeRegister(device, {
    block: 0x100,
    register: 0x2148,
    value: 0x0210,
    bytes: 2,
  });
  await writeRegister(device, {
    block: 0x100,
    register: 0x2148,
    value: 0,
    bytes: 2,
  });
}

function findBulkInEndpoint(device: WebUsbDeviceLike): number {
  const endpoint = device.configuration?.interfaces
    .flatMap((usbInterface) => usbInterface.alternates)
    .flatMap((alternate) => alternate.endpoints)
    .find(
      (candidate) => candidate.direction === "in" && candidate.type === "bulk",
    );

  return endpoint?.endpointNumber ?? RTL_BULK_IN_ENDPOINT;
}

function isMatchingRtlSdr(device: WebUsbDeviceLike): boolean {
  return RTL_SDR_FILTERS.some(
    (filter) =>
      filter.vendorId === device.vendorId &&
      filter.productId === device.productId,
  );
}

function getWebUsb(): WebUsbLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { usb?: WebUsbLike }).usb;
}

async function selectRtlSdrDevice(usb: WebUsbLike): Promise<WebUsbDeviceLike> {
  const alreadyGranted = (await usb.getDevices()).find(isMatchingRtlSdr);
  return (
    alreadyGranted ??
    (await usb.requestDevice({ filters: [...RTL_SDR_FILTERS] }))
  );
}

export type RtlSdrFrame = {
  data: Uint8Array;
  deviceLabel: string;
  endpointNumber: number;
  sampleRateHz: number;
};

export async function readRtlSdrFrame({
  sampleRateHz = DEFAULT_SAMPLE_RATE_HZ,
  usb = getWebUsb(),
}: {
  sampleRateHz?: number;
  usb?: WebUsbLike;
} = {}): Promise<RtlSdrFrame> {
  if (!usb) {
    throw new Error(
      "WebUSB is unavailable. Use a Chromium browser on HTTPS or localhost.",
    );
  }

  const device = await selectRtlSdrDevice(usb);
  let opened = false;
  let claimed = false;

  try {
    await device.open();
    opened = true;
    if (!device.configuration) await device.selectConfiguration(1);
    await device.claimInterface(RTL_INTERFACE);
    claimed = true;
    await initializeRtl2832u(device, sampleRateHz);

    const endpointNumber = findBulkInEndpoint(device);
    const result = await device.transferIn(
      endpointNumber,
      FRAME_SAMPLE_COUNT * 2,
    );
    if (result.status !== "ok" || !result.data) {
      if (result.status === "stall") {
        await device.clearHalt("in", endpointNumber);
      }
      throw new Error(`RTL-SDR sample read failed (status ${result.status}).`);
    }

    const bytes = new Uint8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength,
    );
    return {
      data: new Uint8Array(bytes),
      deviceLabel:
        [device.manufacturerName, device.productName]
          .filter(Boolean)
          .join(" ") ||
        `USB ${device.vendorId.toString(16)}:${device.productId.toString(16)}`,
      endpointNumber,
      sampleRateHz,
    };
  } finally {
    if (claimed)
      await device.releaseInterface(RTL_INTERFACE).catch(() => undefined);
    if (opened) await device.close().catch(() => undefined);
  }
}

export function drawRtlSdrFrame(
  canvas: HTMLCanvasElement,
  data: Uint8Array,
): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D rendering is unavailable.");

  const width = canvas.width;
  const height = canvas.height;
  context.fillStyle = "#07111f";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#60a5fa";
  context.lineWidth = 1;
  context.beginPath();

  const samples = Math.floor(data.byteLength / 2);
  for (let x = 0; x < width; x += 1) {
    const sampleIndex = Math.min(
      samples - 1,
      Math.floor((x / width) * samples),
    );
    const inPhase = (data[sampleIndex * 2] ?? 128) - 128;
    const y = height / 2 - (inPhase / 128) * (height * 0.42);
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}
