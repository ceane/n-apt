/**
 * Browser-only RTL-SDR transport.
 *
 * This module intentionally has no dependency on the application shell,
 * Redux, WebSockets, Rust/WASM, or styled-components. It is the seam used by
 * the two standalone WebUSB pages. The native libusb/libusb-sys path remains
 * a separate implementation for the full application.
 */
import { formatFrequency } from "./frequency";
import { R82xxTuner, R82XX_IF_FREQUENCY_HZ } from "./r82xx";

export type UsbTransferStatus = "ok" | "stall" | "babble" | string;

export interface WebUsbEndpointLike {
  endpointNumber: number;
  direction: "in" | "out" | string;
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
  controlTransferIn(
    setup: {
      requestType: "vendor";
      recipient: "device";
      request: number;
      value: number;
      index: number;
    },
    length: number,
  ): Promise<{ status: UsbTransferStatus; data?: DataView | null }>;
  transferIn(
    endpointNumber: number,
    length: number,
  ): Promise<{ status: UsbTransferStatus; data?: DataView | null }>;
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

export const DEFAULT_SAMPLE_RATE_HZ = 3_200_000;
export const MAX_SAMPLE_RATE_HZ = 3_200_000;
export const DEFAULT_FFT_SIZE = 32_768;
export const DEFAULT_GAIN_DB = 49.6;
export const MAX_GAIN_DB = 49.6;
export const DEFAULT_PPM = 1;
export const MIN_FFT_SIZE = 2_048;
export const FFT_SIZE_OPTIONS = [
  2_048,
  4_096,
  8_192,
  16_384,
  32_768,
  65_536,
  131_072,
  262_144,
  524_288,
] as const;
export const MAX_FFT_SIZE = FFT_SIZE_OPTIONS[FFT_SIZE_OPTIONS.length - 1];
export const FRAME_SAMPLE_COUNT = DEFAULT_FFT_SIZE;
export const FRAME_BYTE_LENGTH = FRAME_SAMPLE_COUNT * 2;
export const DEFAULT_SPECTRUM_MIN_DB = -120;
export const DEFAULT_SPECTRUM_MAX_DB = 0;
export const SPECTRUM_LEFT_PAD = 48;
export const SPECTRUM_TOP_PAD = 20;
export const SPECTRUM_RIGHT_PAD = 16;
export const SPECTRUM_BOTTOM_PAD = 40;

const RTL_INTERFACE = 0;
const RTL_BULK_IN_ENDPOINT = 1;
const RTL_XTAL_HZ = 28_800_000;
const RTL_WRITE_FLAG = 0x10;
const RTL_I2C_BLOCK = 0x600;
const RTL_SYS_BLOCK = 0x200;
const RTL_SYS_GPD = 0x3004;
const RTL_SYS_GPO = 0x3001;
const RTL_SYS_GPOE = 0x3003;

export const normalizeSampleRateHz = (value: number): number => {
  const safeValue = Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_SAMPLE_RATE_HZ, Math.floor(value)))
    : DEFAULT_SAMPLE_RATE_HZ;
  return safeValue;
};

export const normalizeFftSize = (value: number): number => {
  const safeValue = Number.isFinite(value)
    ? Math.max(MIN_FFT_SIZE, Math.min(MAX_FFT_SIZE, Math.floor(value)))
    : DEFAULT_FFT_SIZE;
  return 2 ** Math.floor(Math.log2(safeValue));
};

export const normalizeGainDb = (value: number): number => {
  const safeValue = Number.isFinite(value) ? value : DEFAULT_GAIN_DB;
  return Math.round(Math.max(0, Math.min(MAX_GAIN_DB, safeValue)) * 10) / 10;
};

export const normalizePpm = (value: number): number =>
  Math.max(0, Math.round(Number.isFinite(value) ? value : DEFAULT_PPM));

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
  // Match librtlsdr's demod-write transaction boundary. Its implementation
  // reads a harmless demod register after every write; this flush is
  // especially important for the live sample stream before PPM correction.
  await readRegister(device, 0x0a, 0x0120, 1);
}

async function initializeRtl2832u(
  device: WebUsbDeviceLike,
  sampleRateHz: number,
): Promise<void> {
  // Initialize the RTL2832U demodulator and USB FIFO. The R82xx adapter below
  // owns tuner-specific I2C programming and runs after this baseband setup.
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
    [1, 0xb1, 0x1a],
    [0, 0x0d, 0x83],
  ];
  for (const [page, address, value] of remainingRegisters) {
    await writeDemodRegister(device, page, address, value);
  }

  // R820T/R828D uses a 3.57 MHz low-IF path. The previous transport spike
  // left the demodulator in zero-IF mode, which can produce a valid bulk IQ
  // stream while placing tuned RF energy in the wrong place.
  await writeDemodRegister(device, 0, 0x08, 0x4d);
  const ifFrequency = -Math.floor(
    (R82XX_IF_FREQUENCY_HZ * (1 << 22)) / RTL_XTAL_HZ,
  );
  await writeDemodRegister(device, 1, 0x19, (ifFrequency >> 16) & 0x3f);
  await writeDemodRegister(device, 1, 0x1a, (ifFrequency >> 8) & 0xff);
  await writeDemodRegister(device, 1, 0x1b, ifFrequency & 0xff);
  await writeDemodRegister(device, 1, 0x15, 0x01);

  await applySampleRate(device, sampleRateHz);
  await writeDemodRegister(device, 1, 0x01, 0x14);
  await writeDemodRegister(device, 1, 0x01, 0x10);

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

async function applySampleRate(
  device: WebUsbDeviceLike,
  sampleRateHz: number,
): Promise<void> {
  const ratio =
    Math.floor((RTL_XTAL_HZ * (1 << 22)) / sampleRateHz) & 0x0ffffffc;
  await writeDemodRegister(device, 1, 0x9f, (ratio >> 16) & 0xffff, 2);
  await writeDemodRegister(device, 1, 0xa1, ratio & 0xffff, 2);
}

async function applyPpmCorrection(
  device: WebUsbDeviceLike,
  ppm: number,
): Promise<void> {
  // RTL-SDR's librtlsdr implementation stores the frequency correction in the
  // RTL2832U demodulator's signed 22-bit correction register.
  const offset = Math.trunc((ppm * -0x1000000) / 1_000_000);
  await writeDemodRegister(device, 1, 0x3f, offset & 0xff);
  await writeDemodRegister(device, 1, 0x3e, (offset >> 8) & 0x3f);
}

function isRtlSdrBlogV4(device: WebUsbDeviceLike): boolean {
  return /rtlsdrblog/i.test(device.manufacturerName ?? "") &&
    /blog v4(?!l)/i.test(device.productName ?? "");
}

async function readRegister(
  device: WebUsbDeviceLike,
  block: number,
  register: number,
  length: number,
): Promise<Uint8Array> {
  const result = await device.controlTransferIn(
    {
      requestType: "vendor",
      recipient: "device",
      request: 0,
      value: register,
      index: block,
    },
    length,
  );
  if (result.status !== "ok" || !result.data || result.data.byteLength !== length) {
    throw new Error(
      `RTL-SDR control read failed (register 0x${register.toString(16)}, status ${result.status})`,
    );
  }
  return Uint8Array.from(
    new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength),
  );
}

function createR82xxTransport(device: WebUsbDeviceLike) {
  return {
    setI2cRepeater: (enabled: boolean) =>
      writeDemodRegister(device, 1, 0x01, enabled ? 0x18 : 0x10),
    writeI2c: async (address: number, data: Uint8Array): Promise<void> => {
      const result = await device.controlTransferOut(
        {
          requestType: "vendor",
          recipient: "device",
          request: 0,
          value: address,
          index: RTL_I2C_BLOCK | RTL_WRITE_FLAG,
        },
        data.slice().buffer,
      );
      if (result.status !== "ok" || result.bytesWritten !== data.byteLength) {
        throw new Error(
          `RTL-SDR tuner I2C write failed (address 0x${address.toString(16)}, status ${result.status})`,
        );
      }
    },
    readI2c: async (
      address: number,
      register: number,
      length: number,
    ): Promise<Uint8Array> => {
      const pointer = Uint8Array.of(register);
      const pointerResult = await device.controlTransferOut(
        {
          requestType: "vendor",
          recipient: "device",
          request: 0,
          value: address,
          index: RTL_I2C_BLOCK | RTL_WRITE_FLAG,
        },
        pointer.buffer,
      );
      if (pointerResult.status !== "ok" || pointerResult.bytesWritten !== 1) {
        throw new Error(
          `RTL-SDR tuner I2C register select failed (address 0x${address.toString(16)})`,
        );
      }
      return readRegister(device, RTL_I2C_BLOCK, address, length);
    },
    setGpio: async (gpio: number, enabled: boolean): Promise<void> => {
      const bit = 1 << gpio;
      const direction = (await readRegister(device, RTL_SYS_BLOCK, RTL_SYS_GPD, 1))[0];
      await writeRegister(device, {
        block: RTL_SYS_BLOCK,
        register: RTL_SYS_GPD,
        value: direction & ~bit,
        bytes: 1,
      });
      const output = (await readRegister(device, RTL_SYS_BLOCK, RTL_SYS_GPO, 1))[0];
      await writeRegister(device, {
        block: RTL_SYS_BLOCK,
        register: RTL_SYS_GPO,
        value: enabled ? output | bit : output & ~bit,
        bytes: 1,
      });
      const outputEnable = (await readRegister(device, RTL_SYS_BLOCK, RTL_SYS_GPOE, 1))[0];
      await writeRegister(device, {
        block: RTL_SYS_BLOCK,
        register: RTL_SYS_GPOE,
        value: outputEnable | bit,
        bytes: 1,
      });
    },
  };
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

export type RtlSdrConnection = {
  deviceLabel: string;
  endpointNumber: number;
  sampleRateHz: number;
  fftSize: number;
  gainDb: number;
  ppm: number;
  centerFrequencyHz: number;
};

export type RtlSdrSessionOptions = {
  centerFrequencyHz?: number;
  sampleRateHz?: number;
  fftSize?: number;
  gainDb?: number;
  ppm?: number;
};

export class RtlSdrWebUsbSession {
  private readonly usb: WebUsbLike;
  private device: WebUsbDeviceLike | null = null;
  private opened = false;
  private endpointNumber = RTL_BULK_IN_ENDPOINT;
  private interfaceClaimed = false;
  private streamTask: Promise<void> | null = null;
  private streaming = false;
  private paused = false;
  private frameByteLength = FRAME_BYTE_LENGTH;
  private connection: RtlSdrConnection | null = null;
  private tuner: R82xxTuner | null = null;

  public constructor(usb = getWebUsb()) {
    if (!usb) {
      throw new Error(
        "WebUSB is unavailable. Use a Chromium browser on HTTPS or localhost.",
      );
    }
    this.usb = usb;
  }

  public async connect(
    options: RtlSdrSessionOptions = {},
  ): Promise<RtlSdrConnection> {
    if (this.device) throw new Error("The WebUSB SDR is already connected.");

    const sampleRateHz = normalizeSampleRateHz(
      options.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ,
    );
    const fftSize = normalizeFftSize(options.fftSize ?? DEFAULT_FFT_SIZE);
    const gainDb = normalizeGainDb(options.gainDb ?? DEFAULT_GAIN_DB);
    const ppm = normalizePpm(options.ppm ?? DEFAULT_PPM);
    const centerFrequencyHz = Number.isFinite(options.centerFrequencyHz)
      ? Math.max(1, Math.floor(options.centerFrequencyHz as number))
      : 1_600_000;
    this.frameByteLength = fftSize * 2;

    const device = await selectRtlSdrDevice(this.usb);
    let opened = false;
    try {
      if (!device.opened) {
        await device.open();
      }
      opened = true;
      if (!device.configuration) await device.selectConfiguration(1);
      await device.claimInterface(RTL_INTERFACE);
      this.interfaceClaimed = true;
      await initializeRtl2832u(device, sampleRateHz);
      const tuner = new R82xxTuner(createR82xxTransport(device), {
        blogV4: isRtlSdrBlogV4(device),
      });
      await tuner.probe();
      await tuner.initialize();
      await tuner.setFrequency(centerFrequencyHz);
      await tuner.setGainTenthsDb(gainDb * 10);
      if (ppm !== DEFAULT_PPM) await applyPpmCorrection(device, ppm);

      this.device = device;
      this.tuner = tuner;
      this.opened = true;
      this.endpointNumber = findBulkInEndpoint(device);
      this.connection = {
        deviceLabel:
          [device.manufacturerName, device.productName]
            .filter(Boolean)
            .join(" ") ||
          `USB ${device.vendorId.toString(16)}:${device.productId.toString(16)}`,
        endpointNumber: this.endpointNumber,
        sampleRateHz,
        fftSize,
        gainDb,
        ppm,
        centerFrequencyHz,
      };
      return this.connection;
    } catch (error) {
      if (this.interfaceClaimed) {
        await device.releaseInterface(RTL_INTERFACE).catch(() => undefined);
        this.interfaceClaimed = false;
      }
      if (opened) await device.close().catch(() => undefined);
      this.opened = false;
      this.tuner = null;
      throw error;
    }
  }

  public getConnection(): RtlSdrConnection | null {
    return this.connection;
  }

  public async updateOptions(
    options: RtlSdrSessionOptions,
  ): Promise<RtlSdrConnection> {
    const device = this.device;
    const current = this.connection;
    if (!device || !current) {
      throw new Error("Connect the WebUSB SDR before updating options.");
    }

    const nextSampleRateHz = normalizeSampleRateHz(
      options.sampleRateHz ?? current.sampleRateHz,
    );
    const nextFftSize = normalizeFftSize(options.fftSize ?? current.fftSize);
    const nextGainDb = normalizeGainDb(options.gainDb ?? current.gainDb);
    const nextPpm = normalizePpm(options.ppm ?? current.ppm);
    const nextCenterFrequencyHz = Number.isFinite(options.centerFrequencyHz)
      ? Math.max(1, Math.floor(options.centerFrequencyHz as number))
      : current.centerFrequencyHz;

    if (nextSampleRateHz !== current.sampleRateHz) {
      await applySampleRate(device, nextSampleRateHz);
    }
    if (nextPpm !== current.ppm) {
      await applyPpmCorrection(device, nextPpm);
    }
    if (
      nextCenterFrequencyHz !== current.centerFrequencyHz ||
      nextPpm !== current.ppm
    ) {
      if (!this.tuner) throw new Error("RTL-SDR tuner is not initialized.");
      await this.tuner.setFrequency(nextCenterFrequencyHz);
    }
    if (nextGainDb !== current.gainDb) {
      if (!this.tuner) throw new Error("RTL-SDR tuner is not initialized.");
      await this.tuner.setGainTenthsDb(nextGainDb * 10);
    }

    this.frameByteLength = nextFftSize * 2;
    this.connection = {
      ...current,
      sampleRateHz: nextSampleRateHz,
      fftSize: nextFftSize,
      gainDb: nextGainDb,
      ppm: nextPpm,
      centerFrequencyHz: nextCenterFrequencyHz,
    };
    return this.connection;
  }

  public async readFrame(): Promise<Uint8Array> {
    const device = this.device;
    if (!device) throw new Error("Connect the WebUSB SDR before reading.");

    const result = await device.transferIn(
      this.endpointNumber,
      this.frameByteLength,
    );
    if (result.status !== "ok" || !result.data) {
      if (result.status === "stall") {
        await device.clearHalt("in", this.endpointNumber);
      }
      throw new Error(`RTL-SDR sample read failed (status ${result.status}).`);
    }

    const bytes = new Uint8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength,
    );
    return new Uint8Array(bytes);
  }

  public start(onFrame: (frame: Uint8Array) => void): Promise<void> {
    if (!this.device) throw new Error("Connect the WebUSB SDR before streaming.");
    if (this.streamTask) return this.streamTask;

    this.paused = false;
    this.streaming = true;
    this.streamTask = this.readLoop(onFrame).finally(() => {
      this.streaming = false;
      this.streamTask = null;
    });
    return this.streamTask;
  }

  public pause(): void {
    if (!this.device) throw new Error("Connect the WebUSB SDR before pausing.");
    this.paused = true;
  }

  public resume(): void {
    if (!this.device) throw new Error("Connect the WebUSB SDR before resuming.");
    this.paused = false;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public async disconnect(): Promise<void> {
    const device = this.device;
    if (!device) return;

    this.streaming = false;
    this.paused = false;
    // close() aborts an outstanding transferIn. The loop treats that abort as
    // normal because streaming has already been set to false.
    if (this.opened) await device.close().catch(() => undefined);
    this.opened = false;
    await this.streamTask?.catch(() => undefined);
    this.streamTask = null;

    if (this.interfaceClaimed) {
      await device.releaseInterface(RTL_INTERFACE).catch(() => undefined);
      this.interfaceClaimed = false;
    }
    this.device = null;
    this.tuner = null;
    this.connection = null;
  }

  private async readLoop(onFrame: (frame: Uint8Array) => void): Promise<void> {
    while (this.streaming) {
      if (this.paused) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
        continue;
      }
      try {
        const frame = await this.readFrame();
        if (this.streaming && !this.paused) onFrame(frame);
      } catch (error) {
        if (!this.streaming) return;
        throw error;
      }
    }
  }
}

function reverseBits(value: number, bitCount: number): number {
  let result = 0;
  for (let bit = 0; bit < bitCount; bit += 1) {
    result = (result << 1) | ((value >>> bit) & 1);
  }
  return result;
}

/** Convert one unsigned, interleaved RTL-SDR IQ frame to app-style dB bins. */
export function processRtlSdrFrame(input: Uint8Array): Float32Array {
  const complexCount = Math.floor(input.byteLength / 2);
  const fftSize = 2 ** Math.floor(Math.log2(Math.max(2, complexCount)));
  const bitCount = Math.log2(fftSize);
  const numSamples = Math.max(1, Math.min(fftSize, complexCount));
  const real = new Float32Array(fftSize);
  const imaginary = new Float32Array(fftSize);
  let windowEnergy = 0;

  for (let index = 0; index < fftSize; index += 1) {
    // Match the app's Hanning window, including its N-1 denominator. Samples
    // beyond the received frame remain zero, like the WASM path's padding.
    const window =
      index >= numSamples
        ? 0
        : numSamples <= 1
        ? 1
        : 0.5 -
          0.5 * Math.cos((2 * Math.PI * index) / (numSamples - 1));
    if (index < numSamples) {
      const inputIndex = index * 2;
      // Center unsigned RTL-SDR bytes exactly as the app's WASM processor.
      real[index] = (((input[inputIndex] ?? 128) - 128) / 128) * window;
      imaginary[index] =
        (((input[inputIndex + 1] ?? 128) - 128) / 128) * window;
    }
    windowEnergy += window * window;
  }

  // Bit-reverse the windowed samples before the iterative butterfly stages.
  for (let index = 0; index < fftSize; index += 1) {
    const reversed = reverseBits(index, bitCount);
    if (reversed > index) {
      const realValue = real[index];
      real[index] = real[reversed];
      real[reversed] = realValue;
      const imaginaryValue = imaginary[index];
      imaginary[index] = imaginary[reversed];
      imaginary[reversed] = imaginaryValue;
    }
  }

  for (let size = 2; size <= fftSize; size <<= 1) {
    const half = size >>> 1;
    const angle = -((2 * Math.PI) / size);
    for (let start = 0; start < fftSize; start += size) {
      for (let offset = 0; offset < half; offset += 1) {
        const phase = angle * offset;
        const cosine = Math.cos(phase);
        const sine = Math.sin(phase);
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * cosine - imaginary[odd] * sine;
        const oddImaginary = real[odd] * sine + imaginary[odd] * cosine;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
      }
    }
  }

  // Match process_iq_to_dbm_spectrum: normalize power, clamp to the app's
  // usable dB domain, and FFT-shift DC to the center of the plot.
  const normalization = Math.max(numSamples * windowEnergy, 1e-12);
  const bins = new Float32Array(fftSize);
  const half = fftSize >>> 1;
  for (let index = 0; index < bins.length; index += 1) {
    const source = (index + half) % fftSize;
    const power =
      ((real[source] ** 2 + imaginary[source] ** 2) / normalization) +
      1e-15;
    bins[index] = Math.max(-150, Math.min(0, 10 * Math.log10(power)));
  }
  return bins;
}

export function mapDbToCanvasY(
  valueDb: number,
  height: number,
  minDb = DEFAULT_SPECTRUM_MIN_DB,
  maxDb = DEFAULT_SPECTRUM_MAX_DB,
  topPad = SPECTRUM_TOP_PAD,
  bottomPad = SPECTRUM_BOTTOM_PAD,
): number {
  const safeHeight = Math.max(1, height);
  const top = Math.min(topPad, Math.max(0, safeHeight - 1));
  const bottom = Math.max(top, safeHeight - bottomPad);
  const range = Math.max(1, maxDb - minDb);
  const normalized = Math.max(
    0,
    Math.min(1, (valueDb - minDb) / range),
  );
  return Math.round(bottom - normalized * (bottom - top));
}

/**
 * Match the app's WebGPU resampler: each display bucket keeps its strongest
 * raw FFT bin so narrow signals survive the reduction to canvas pixels.
 */
export function resampleSpectrumForCanvas(
  bins: Float32Array,
  targetLength: number,
  fallbackDb = DEFAULT_SPECTRUM_MIN_DB,
): Float32Array {
  const outputLength = Math.max(0, Math.floor(targetLength));
  const output = new Float32Array(outputLength);
  if (outputLength === 0) return output;
  if (bins.length === 0) {
    output.fill(fallbackDb);
    return output;
  }

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor((outputIndex * bins.length) / outputLength);
    const end = Math.min(
      bins.length,
      Math.max(
        start + 1,
        Math.ceil(((outputIndex + 1) * bins.length) / outputLength),
      ),
    );
    let peak = fallbackDb;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      const value = bins[sourceIndex];
      if (Number.isFinite(value)) peak = Math.max(peak, value);
    }
    output[outputIndex] = peak;
  }
  return output;
}

export interface SpectrumDrawOptions {
  centerFrequencyHz?: number;
  sampleRateHz?: number;
  minDb?: number;
  maxDb?: number;
}

const FREQUENCY_TICK_RANGES = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500,
  1_000, 2_000, 2_500, 5_000, 10_000, 20_000, 25_000, 50_000, 100_000,
  200_000, 250_000, 500_000, 1_000_000, 2_000_000, 2_500_000, 5_000_000,
  10_000_000, 20_000_000, 25_000_000, 50_000_000, 100_000_000,
  200_000_000, 250_000_000, 500_000_000,
];

function findBestFrequencyTickStep(bandwidthHz: number, maxSteps: number): number {
  for (const range of FREQUENCY_TICK_RANGES) {
    if (bandwidthHz / range < maxSteps) return range;
  }
  return 50_000_000;
}

function tickPrecisionForStep(stepHz: number): {
  precisionMHz: number;
  precisionKHz: number;
  precisionGHz: number;
} {
  if (stepHz >= 1_000_000) {
    return { precisionMHz: 1, precisionKHz: 0, precisionGHz: 3 };
  }
  if (stepHz >= 100_000) {
    return { precisionMHz: 1, precisionKHz: 0, precisionGHz: 4 };
  }
  if (stepHz >= 10_000) {
    return { precisionMHz: 2, precisionKHz: 1, precisionGHz: 5 };
  }
  if (stepHz >= 1_000) {
    return { precisionMHz: 3, precisionKHz: 2, precisionGHz: 6 };
  }
  return { precisionMHz: 4, precisionKHz: 3, precisionGHz: 6 };
}

function formatFrequencyTick(frequencyHz: number, stepHz: number): string {
  const precision = tickPrecisionForStep(stepHz);
  return formatFrequency(frequencyHz, {
    trimTrailingZeros: true,
    precisionMHz: Math.max(precision.precisionMHz, 4),
    precisionKHz: Math.max(precision.precisionKHz, 2),
    precisionGHz: precision.precisionGHz,
  });
}

function drawSpectrumAxes(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: SpectrumDrawOptions,
): void {
  const minDb = options.minDb ?? DEFAULT_SPECTRUM_MIN_DB;
  const maxDb = options.maxDb ?? DEFAULT_SPECTRUM_MAX_DB;
  const centerFrequencyHz = options.centerFrequencyHz ?? 1_600_000;
  const sampleRateHz = Math.max(
    1,
    options.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ,
  );
  const plotRight = Math.max(SPECTRUM_LEFT_PAD, width - SPECTRUM_RIGHT_PAD);
  const plotBottom = Math.max(SPECTRUM_TOP_PAD, height - SPECTRUM_BOTTOM_PAD);
  const plotWidth = Math.max(1, plotRight - SPECTRUM_LEFT_PAD);
  const frequencyStartHz = centerFrequencyHz - sampleRateHz / 2;
  const frequencyEndHz = centerFrequencyHz + sampleRateHz / 2;
  const frequencySpanHz = Math.max(1, frequencyEndHz - frequencyStartHz);

  context.lineWidth = 1;
  context.setLineDash([]);
  context.strokeStyle = "rgba(83, 117, 149, 0.38)";
  context.fillStyle = "#8fa8c4";
  context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textBaseline = "middle";
  context.textAlign = "right";

  const topDb = Math.floor(maxDb / 10) * 10;
  for (let db = topDb; db >= minDb; db -= 10) {
    const y = mapDbToCanvasY(db, height, minDb, maxDb);
    context.beginPath();
    context.moveTo(SPECTRUM_LEFT_PAD, y);
    context.lineTo(plotRight, y);
    context.stroke();
    context.fillText(
      db === topDb ? `${db} dB` : String(db),
      SPECTRUM_LEFT_PAD - 8,
      y,
    );
  }

  const frequencyToX = (frequencyHz: number): number =>
    SPECTRUM_LEFT_PAD +
    ((frequencyHz - frequencyStartHz) / frequencySpanHz) * plotWidth;
  const frequencyStepHz = findBestFrequencyTickStep(frequencySpanHz, 10);
  const firstTickHz =
    Math.ceil(frequencyStartHz / frequencyStepHz) * frequencyStepHz;
  // All frequency labels share the app's VFO row baseline. The grid/tick
  // geometry may end at the plot floor, but its labels belong to one row.
  context.textBaseline = "alphabetic";
  context.textAlign = "center";

  const occupiedLabelRects: Array<{ left: number; right: number }> = [];
  const occupyLabel = (
    x: number,
    text: string,
    align: "left" | "center" | "right",
    padding: number,
  ): void => {
    const textWidth = context.measureText(text).width;
    const left =
      align === "left"
        ? x - padding
        : align === "right"
          ? x - textWidth - padding
          : x - textWidth / 2 - padding;
    const right =
      align === "left"
        ? x + textWidth + padding
        : align === "right"
          ? x + padding
          : x + textWidth / 2 + padding;
    occupiedLabelRects.push({ left, right });
  };
  const labelCollides = (x: number, text: string): boolean => {
    const textWidth = context.measureText(text).width;
    const left = x - textWidth / 2 - 8;
    const right = x + textWidth / 2 + 8;
    return occupiedLabelRects.some(
      (occupied) => left < occupied.right && right > occupied.left,
    );
  };
  const labelY = plotBottom + 25;
  const startLabel = formatFrequencyTick(frequencyStartHz, frequencyStepHz);
  const endLabel = formatFrequencyTick(frequencyEndHz, frequencyStepHz);
  const centerLabel = formatFrequencyTick(centerFrequencyHz, frequencyStepHz);
  const centerX = Math.min(
    plotRight,
    Math.max(SPECTRUM_LEFT_PAD, frequencyToX(centerFrequencyHz)),
  );

  context.fillStyle = "#8fa8c4";
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.fillText(startLabel, SPECTRUM_LEFT_PAD, labelY);
  occupyLabel(SPECTRUM_LEFT_PAD, startLabel, "left", 14);
  context.textAlign = "right";
  context.fillText(endLabel, plotRight, labelY);
  occupyLabel(plotRight, endLabel, "right", 14);

  context.fillStyle = "#ffffff";
  context.font = "bold 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.fillText(centerLabel, centerX, labelY);
  occupyLabel(centerX, centerLabel, "center", 10);
  context.textAlign = "right";
  context.fillText(
    "✋",
    centerX - context.measureText(centerLabel).width / 2 - 8,
    labelY,
  );
  context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textBaseline = "alphabetic";

  for (
    let frequencyHz = firstTickHz;
    frequencyHz <= frequencyEndHz + frequencyStepHz * 0.001;
    frequencyHz += frequencyStepHz
  ) {
    const x = Math.round(frequencyToX(frequencyHz));
    if (x < SPECTRUM_LEFT_PAD || x > plotRight) continue;
    context.strokeStyle = "rgba(83, 117, 149, 0.28)";
    context.beginPath();
    context.moveTo(x, SPECTRUM_TOP_PAD);
    context.lineTo(x, plotBottom);
    context.stroke();
    context.strokeStyle = "#8fa8c4";
    context.beginPath();
    context.moveTo(x, plotBottom);
    context.lineTo(x, plotBottom + 7);
    context.stroke();
    const label = formatFrequencyTick(frequencyHz, frequencyStepHz);
    if (!labelCollides(x, label)) {
      context.fillText(label, x, labelY);
    }
  }

  context.strokeStyle = "#8fa8c4";
  context.beginPath();
  context.moveTo(SPECTRUM_LEFT_PAD, plotBottom);
  context.lineTo(plotRight, plotBottom);
  context.stroke();
  context.beginPath();
  context.moveTo(SPECTRUM_LEFT_PAD, SPECTRUM_TOP_PAD);
  context.lineTo(SPECTRUM_LEFT_PAD, plotBottom);
  context.stroke();

  // Keep the app's VFO line visible independently of the ordinary frequency
  // ticks. The numeric label is centered on the line; the hand icon sits to
  // its left without shifting the frequency itself.
  if (Number.isFinite(centerFrequencyHz)) {
    context.strokeStyle = "rgba(220, 255, 0, 0.7)";
    context.beginPath();
    context.moveTo(Math.round(centerX), SPECTRUM_TOP_PAD);
    context.lineTo(Math.round(centerX), plotBottom);
    context.stroke();
    context.fillStyle = "#ffffff";
    context.font = "bold 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
  }
}

export function drawSpectrum(
  canvas: HTMLCanvasElement,
  bins: Float32Array,
  options: SpectrumDrawOptions = {},
): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D rendering is unavailable.");

  const pixelRatio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.width;
  const cssHeight = canvas.clientHeight || canvas.height;
  const width = Math.max(1, Math.floor(cssWidth * pixelRatio));
  const height = Math.max(1, Math.floor(cssHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  // The app's 2D renderer draws in logical CSS pixels after scaling the
  // context. Keep the plot rectangle separate from the physical backing store
  // so HiDPI displays do not change the spectrum's geometry.
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = "#07111f";
  context.fillRect(0, 0, cssWidth, cssHeight);
  const plotRight = Math.max(SPECTRUM_LEFT_PAD, cssWidth - SPECTRUM_RIGHT_PAD);
  const plotBottom = Math.max(
    SPECTRUM_TOP_PAD,
    cssHeight - SPECTRUM_BOTTOM_PAD,
  );
  const plotWidth = Math.max(0, plotRight - SPECTRUM_LEFT_PAD);
  const displayBins = resampleSpectrumForCanvas(
    bins,
    Math.max(2, Math.ceil(plotWidth) + 1),
  );
  const xForBin = (index: number) =>
    displayBins.length <= 1
      ? SPECTRUM_LEFT_PAD
      : SPECTRUM_LEFT_PAD + (index / (displayBins.length - 1)) * plotWidth;
  const yForBin = (index: number) =>
    mapDbToCanvasY(
      displayBins[index],
      cssHeight,
      options.minDb ?? DEFAULT_SPECTRUM_MIN_DB,
      options.maxDb ?? DEFAULT_SPECTRUM_MAX_DB,
    );

  // Match drawSpectrumTrace in the app: fill is a separate underlay and its
  // closing edge is never stroked as part of the visible magnitude trace.
  context.fillStyle = "rgba(0, 212, 255, 0.2)";
  context.beginPath();
  context.moveTo(xForBin(0), plotBottom);
  for (let index = 0; index < displayBins.length; index += 1) {
    context.lineTo(xForBin(index), yForBin(index));
  }
  context.lineTo(xForBin(displayBins.length - 1), plotBottom);
  context.closePath();
  context.fill();

  // Keep the app's grid and labels visible over the underlay, while the
  // magnitude trace itself is painted last.
  drawSpectrumAxes(context, cssWidth, cssHeight, options);

  context.strokeStyle = "#00d4ff";
  context.lineWidth = Math.max(1, (cssWidth < 700 ? 0.75 : 1.5) / pixelRatio);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.setLineDash([]);
  context.beginPath();
  for (let index = 0; index < displayBins.length; index += 1) {
    const x = xForBin(index);
    const y = yForBin(index);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}
