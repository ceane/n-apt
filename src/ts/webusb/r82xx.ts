/**
 * Minimal Rafael Micro R820T/R828D tuner adapter for the RTL2832U WebUSB
 * transport.
 *
 * The register values and tuning equations follow the upstream rtl-sdr
 * R82xx driver. This is intentionally a small, async browser adapter rather
 * than a port of the librtlsdr reader, device enumeration, or native libusb
 * layers. Public distribution still needs a source/license review because
 * the upstream driver is GPL-2.0-or-later.
 */

export type R82xxTransport = {
  setI2cRepeater(enabled: boolean): Promise<void>;
  writeI2c(address: number, data: Uint8Array): Promise<void>;
  /** Return the raw, bit-reversed bytes read from the tuner. */
  readI2c(address: number, register: number, length: number): Promise<Uint8Array>;
  setGpio?(gpio: number, enabled: boolean): Promise<void>;
};

export type R82xxOptions = {
  /** RTL-SDR Blog V4 uses the R828D address and HF upconversion path. */
  blogV4?: boolean;
  i2cAddress?: number;
  xtalHz?: number;
};

export const R820T_I2C_ADDRESS = 0x34;
export const R828D_I2C_ADDRESS = 0x74;
export const R82XX_CHECK_VALUE = 0x69;
export const R82XX_IF_FREQUENCY_HZ = 3_570_000;
export const R82XX_DEFAULT_XTAL_HZ = 28_800_000;

const REG_SHADOW_START = 5;
const R82XX_REGISTER_COUNT = 30;
const MAX_I2C_MESSAGE_LENGTH = 8;
const PLL_SETTLE_DELAY_MS = 10;
const HF = 1;
const VHF = 2;
const UHF = 3;

const INITIAL_REGISTERS = Uint8Array.from([
  0x83, 0x32, 0x75, 0xc0, 0x40, 0xd6, 0x6c, 0xf5, 0x63, 0x75, 0x68, 0x6c,
  0x83, 0x80, 0x00, 0x0f, 0x00, 0xc0, 0x30, 0x48, 0xcc, 0x60, 0x00, 0x54,
  0xae, 0x4a, 0xc0,
]);

const FREQUENCY_RANGES = [
  { frequencyMHz: 0, openDrain: 0x08, rfMuxPoly: 0x02, trackingFilter: 0xdf, xtal20p: 0x02, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 50, openDrain: 0x08, rfMuxPoly: 0x02, trackingFilter: 0xbe, xtal20p: 0x02, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 55, openDrain: 0x08, rfMuxPoly: 0x02, trackingFilter: 0x8b, xtal20p: 0x02, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 60, openDrain: 0x08, rfMuxPoly: 0x02, trackingFilter: 0x7b, xtal20p: 0x02, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 65, openDrain: 0x08, rfMuxPoly: 0x02, trackingFilter: 0x69, xtal20p: 0x02, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 70, openDrain: 0x08, rfMuxPoly: 0x02, trackingFilter: 0x58, xtal20p: 0x02, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 75, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x44, xtal20p: 0x02, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 80, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x44, xtal20p: 0x02, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 90, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x34, xtal20p: 0x01, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 100, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x34, xtal20p: 0x01, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 110, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x24, xtal20p: 0x01, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 120, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x24, xtal20p: 0x01, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 140, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x14, xtal20p: 0x01, xtal10p: 0x01, xtal0p: 0x00 },
  { frequencyMHz: 180, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x13, xtal20p: 0x00, xtal10p: 0x00, xtal0p: 0x00 },
  { frequencyMHz: 220, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x13, xtal20p: 0x00, xtal10p: 0x00, xtal0p: 0x00 },
  { frequencyMHz: 250, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x11, xtal20p: 0x00, xtal10p: 0x00, xtal0p: 0x00 },
  { frequencyMHz: 280, openDrain: 0x00, rfMuxPoly: 0x02, trackingFilter: 0x00, xtal20p: 0x00, xtal10p: 0x00, xtal0p: 0x00 },
  { frequencyMHz: 310, openDrain: 0x00, rfMuxPoly: 0x41, trackingFilter: 0x00, xtal20p: 0x00, xtal10p: 0x00, xtal0p: 0x00 },
  { frequencyMHz: 450, openDrain: 0x00, rfMuxPoly: 0x41, trackingFilter: 0x00, xtal20p: 0x00, xtal10p: 0x00, xtal0p: 0x00 },
  { frequencyMHz: 588, openDrain: 0x00, rfMuxPoly: 0x40, trackingFilter: 0x00, xtal20p: 0x00, xtal10p: 0x00, xtal0p: 0x00 },
  { frequencyMHz: 650, openDrain: 0x00, rfMuxPoly: 0x40, trackingFilter: 0x00, xtal20p: 0x00, xtal10p: 0x00, xtal0p: 0x00 },
] as const;

const LNA_GAIN_STEPS = [0, 9, 13, 40, 38, 13, 31, 22, 26, 31, 26, 14, 19, 5, 35, 13];
const MIXER_GAIN_STEPS = [0, 5, 10, 10, 19, 9, 10, 25, 17, 10, 8, 16, 13, 6, 3, -8];

export function reverseR82xxByte(value: number): number {
  let result = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    result = (result << 1) | ((value >>> bit) & 1);
  }
  return result;
}

function maskRegister(current: number, value: number, mask: number): number {
  return (current & ~mask) | (value & mask);
}

function frequencyRangeFor(frequencyHz: number) {
  const frequencyMHz = Math.floor(frequencyHz / 1_000_000);
  let selected: (typeof FREQUENCY_RANGES)[number] = FREQUENCY_RANGES[0];
  for (const range of FREQUENCY_RANGES) {
    if (frequencyMHz < range.frequencyMHz) break;
    selected = range;
  }
  return selected;
}

export class R82xxTuner {
  private readonly transport: R82xxTransport;
  private readonly blogV4: boolean;
  private readonly i2cAddress: number;
  private readonly xtalHz: number;
  private readonly registers = new Uint8Array(R82XX_REGISTER_COUNT);
  private intermediateFrequencyHz = R82XX_IF_FREQUENCY_HZ;
  private input = 0;
  private hasLock = false;

  public constructor(transport: R82xxTransport, options: R82xxOptions = {}) {
    this.transport = transport;
    this.blogV4 = options.blogV4 ?? false;
    this.i2cAddress = options.i2cAddress ??
      (this.blogV4 ? R828D_I2C_ADDRESS : R820T_I2C_ADDRESS);
    this.xtalHz = options.xtalHz ?? R82XX_DEFAULT_XTAL_HZ;
  }

  public async probe(): Promise<void> {
    await this.withRepeater(async () => {
      // librtlsdr's tuner probe uses the raw identity byte. The R82xx driver
      // bit-reverses ordinary register reads, but the probe is intentionally
      // a direct I2C read and compares the returned 0x69 byte as-is.
      const value = (await this.readRaw(0x00, 1))[0];
      if (value !== R82XX_CHECK_VALUE) {
        throw new Error(
          `Unsupported RTL-SDR tuner at I2C address 0x${this.i2cAddress.toString(16)} (id 0x${value.toString(16)})`,
        );
      }
    });
  }

  public async initialize(): Promise<void> {
    await this.withRepeater(async () => {
      this.registers.fill(0);
      await this.write(0x05, INITIAL_REGISTERS);
      await this.setTvStandard();
      await this.selectSystemFrequency();
    });
  }

  public async setFrequency(frequencyHz: number): Promise<void> {
    if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
      throw new Error("RTL-SDR center frequency must be positive.");
    }

    await this.withRepeater(async () => {
      const tunedFrequencyHz =
        this.blogV4 && frequencyHz < 28_800_000
          ? frequencyHz + 28_800_000
          : frequencyHz;
      const localOscillatorHz = tunedFrequencyHz + this.intermediateFrequencyHz;
      await this.setMux(localOscillatorHz);
      await this.setPll(localOscillatorHz);

      if (this.blogV4) await this.setBlogV4Input(frequencyHz);
      else await this.setR828DInput(frequencyHz);
    });
  }

  public async setGainTenthsDb(gainTenthsDb: number): Promise<void> {
    const target = Math.max(0, Math.min(496, Math.round(gainTenthsDb)));
    await this.withRepeater(async () => {
      await this.writeMasked(0x05, 0x10, 0x10);
      await this.writeMasked(0x07, 0x00, 0x10);
      await this.writeMasked(0x0c, 0x08, 0x9f);

      let totalGain = 0;
      let lnaIndex = 0;
      let mixerIndex = 0;
      for (let index = 0; index < 15; index += 1) {
        if (totalGain >= target) break;
        lnaIndex += 1;
        totalGain += LNA_GAIN_STEPS[lnaIndex];
        if (totalGain >= target) break;
        mixerIndex += 1;
        totalGain += MIXER_GAIN_STEPS[mixerIndex];
      }

      await this.writeMasked(0x05, lnaIndex, 0x0f);
      await this.writeMasked(0x07, mixerIndex, 0x0f);
    });
  }

  private async withRepeater(operation: () => Promise<void>): Promise<void> {
    await this.transport.setI2cRepeater(true);
    try {
      await operation();
    } finally {
      await this.transport.setI2cRepeater(false);
    }
  }

  private readCached(register: number): number {
    const index = register - REG_SHADOW_START;
    if (index < 0 || index >= this.registers.length) {
      throw new Error(`R82xx register 0x${register.toString(16)} is not cached.`);
    }
    return this.registers[index];
  }

  private async write(register: number, values: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < values.length) {
      const length = Math.min(MAX_I2C_MESSAGE_LENGTH - 1, values.length - offset);
      const chunk = values.slice(offset, offset + length);
      const current = this.registers.slice(
        Math.max(0, register + offset - REG_SHADOW_START),
        Math.max(0, register + offset - REG_SHADOW_START) + length,
      );
      if (current.length !== chunk.length || current.some((value, index) => value !== chunk[index])) {
        const data = new Uint8Array(length + 1);
        data[0] = register + offset;
        data.set(chunk, 1);
        await this.transport.writeI2c(this.i2cAddress, data);
        this.registers.set(chunk, register + offset - REG_SHADOW_START);
      }
      offset += length;
    }
  }

  private async writeRegister(register: number, value: number): Promise<void> {
    await this.write(register, Uint8Array.of(value & 0xff));
  }

  private async writeMasked(register: number, value: number, mask: number): Promise<void> {
    await this.writeRegister(register, maskRegister(this.readCached(register), value, mask));
  }

  private async read(register: number, length: number): Promise<Uint8Array> {
    return Uint8Array.from(await this.readRaw(register, length), reverseR82xxByte);
  }

  private async readRaw(register: number, length: number): Promise<Uint8Array> {
    const raw = await this.transport.readI2c(this.i2cAddress, register, length);
    if (raw.length !== length) {
      throw new Error(`RTL-SDR tuner read returned ${raw.length} bytes; expected ${length}.`);
    }
    return raw;
  }

  private async setTvStandard(): Promise<void> {
    await this.writeMasked(0x0c, 0x00, 0x0f);
    await this.writeMasked(0x13, 49, 0x3f);
    await this.writeMasked(0x1d, 0x00, 0x38);
    this.intermediateFrequencyHz = R82XX_IF_FREQUENCY_HZ;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.writeMasked(0x0b, 0x6b, 0x60);
      await this.writeMasked(0x0f, 0x04, 0x04);
      await this.writeMasked(0x10, 0x00, 0x03);
      await this.setPll(56_000_000);
      await this.writeMasked(0x0b, 0x10, 0x10);
      await this.writeMasked(0x0b, 0x00, 0x10);
      await this.writeMasked(0x0f, 0x00, 0x04);
      const data = await this.read(0x00, 5);
      const calibrationCode = data[4] & 0x0f;
      if (calibrationCode !== 0 && calibrationCode !== 0x0f) {
        await this.writeMasked(0x0a, 0x10 | calibrationCode, 0x1f);
        break;
      }
      await this.writeMasked(0x0a, 0x10, 0x1f);
    }

    await this.writeMasked(0x0b, 0x6b, 0xef);
    await this.writeMasked(0x07, 0x00, 0x80);
    await this.writeMasked(0x06, 0x10, 0x30);
    await this.writeMasked(0x1e, 0x60, 0x60);
    await this.writeMasked(0x05, 0x01, 0x80);
    await this.writeMasked(0x1f, 0x00, 0x80);
    await this.writeMasked(0x0f, 0x00, 0x80);
    await this.writeMasked(0x19, 0x60, 0x60);
  }

  private async selectSystemFrequency(): Promise<void> {
    await this.writeMasked(0x1d, 0xe5, 0xc7);
    await this.writeMasked(0x1c, 0x24, 0xf8);
    await this.writeRegister(0x0d, 0x53);
    await this.writeRegister(0x0e, 0x75);
    this.input = 0;
    await this.writeMasked(0x05, 0x00, 0x60);
    await this.writeMasked(0x06, 0x00, 0x08);
    await this.writeMasked(0x11, 0x38, 0x38);
    await this.writeMasked(0x17, 0x30, 0x30);
    await this.writeMasked(0x0a, 0x40, 0x60);
    await this.writeMasked(0x1d, 0x00, 0x38);
    await this.writeMasked(0x1c, 0x00, 0x04);
    await this.writeMasked(0x06, 0x00, 0x40);
    await this.writeMasked(0x1a, 0x30, 0x30);
    await this.writeMasked(0x1d, 0x18, 0x38);
    await this.writeMasked(0x1c, 0x24, 0x04);
    await this.writeMasked(0x1e, 14, 0x1f);
    await this.writeMasked(0x1a, 0x20, 0x30);
  }

  private async setMux(frequencyHz: number): Promise<void> {
    const range = frequencyRangeFor(frequencyHz);
    await this.writeMasked(0x17, range.openDrain, 0x08);
    await this.writeMasked(0x1a, range.rfMuxPoly, 0xc3);
    await this.writeRegister(0x1b, range.trackingFilter);
    await this.writeMasked(0x10, range.xtal0p, 0x0b);
    await this.writeMasked(0x08, 0x00, 0x3f);
    await this.writeMasked(0x09, 0x00, 0x3f);
  }

  private async setPll(frequencyHz: number): Promise<void> {
    // Match librtlsdr: select the 128 kHz PLL auto-tune mode before loading a
    // new divider. The final 8 kHz mode is restored after lock is confirmed.
    await this.writeMasked(0x1a, 0x00, 0x0c);
    const frequencyKHz = Math.floor((frequencyHz + 500) / 1000);
    let mixDiv = 2;
    let dividerNumber = 0;
    while (mixDiv <= 64) {
      if (frequencyKHz * mixDiv >= 1_770_000 && frequencyKHz * mixDiv < 3_540_000) {
        let divider = mixDiv;
        while (divider > 2) {
          divider >>= 1;
          dividerNumber += 1;
        }
        break;
      }
      mixDiv <<= 1;
    }
    if (mixDiv > 64) throw new Error(`R82xx cannot synthesize ${frequencyHz} Hz.`);

    const data = await this.read(0x00, 5);
    const vcoPowerReference = this.blogV4 ? 1 : 2;
    const vcoFineTune = (data[4] & 0x30) >> 4;
    if (vcoFineTune > vcoPowerReference) dividerNumber -= 1;
    else if (vcoFineTune < vcoPowerReference) dividerNumber += 1;

    const registers = Uint8Array.from(this.registers.slice(0x10 - REG_SHADOW_START, 0x17 - REG_SHADOW_START));
    const vcoFrequency = frequencyHz * mixDiv;
    const vcoDivider = Math.floor((this.xtalHz + 65_536 * vcoFrequency) / (2 * this.xtalHz));
    const nint = Math.floor(vcoDivider / 65_536);
    const sdm = vcoDivider % 65_536;
    if (nint < 13 || nint > 127) throw new Error(`R82xx produced an invalid PLL divider for ${frequencyHz} Hz.`);

    const ni = Math.floor((nint - 13) / 4);
    const si = nint - 4 * ni - 13;
    registers[0] = maskRegister(registers[0], dividerNumber << 5, 0xe0);
    registers[2] = maskRegister(registers[2], sdm === 0 ? 0x08 : 0x00, 0x08);
    registers[4] = ni + (si << 6);
    registers[5] = sdm & 0xff;
    registers[6] = sdm >> 8;
    await this.write(0x10, registers);
    // Native librtlsdr normally gets this settling time from the surrounding
    // USB scheduling. WebUSB resolves each transfer immediately, so give the
    // R82xx PLL a bounded settle window before sampling its lock status.
    await new Promise<void>((resolve) => setTimeout(resolve, PLL_SETTLE_DELAY_MS));

    let status = await this.read(0x00, 3);
    if ((status[2] & 0x40) === 0) {
      await this.writeMasked(0x12, 0x60, 0xe0);
      status = await this.read(0x00, 3);
    }
    this.hasLock = (status[2] & 0x40) !== 0;
    if (!this.hasLock) throw new Error(`R82xx PLL did not lock at ${frequencyHz} Hz.`);
    await this.writeMasked(0x1a, 0x08, 0x08);
  }

  private async setBlogV4Input(frequencyHz: number): Promise<void> {
    const openDrain =
      frequencyHz <= 2_200_000 ||
      (frequencyHz >= 85_000_000 && frequencyHz <= 112_000_000) ||
      (frequencyHz >= 172_000_000 && frequencyHz <= 242_000_000)
        ? 0x00
        : 0x08;
    await this.writeMasked(0x17, openDrain, 0x08);
    const band = frequencyHz <= 28_800_000 ? HF : frequencyHz < 250_000_000 ? VHF : UHF;
    if (band === HF) {
      await this.writeMasked(0x1a, 0x40, 0xc3);
      await this.writeRegister(0x1b, 0x00);
    }
    if (band === this.input) return;
    this.input = band;
    const cable2 = band === HF ? 0x08 : 0x00;
    await this.writeMasked(0x06, cable2, 0x08);
    if (this.transport.setGpio) await this.transport.setGpio(5, !cable2);
    await this.writeMasked(0x05, band === VHF ? 0x40 : 0x00, 0x40);
    await this.writeMasked(0x05, band === UHF ? 0x00 : 0x20, 0x20);
  }

  private async setR828DInput(frequencyHz: number): Promise<void> {
    const input = frequencyHz > 345_000_000 ? 0x00 : 0x60;
    if (input === this.input) return;
    this.input = input;
    await this.writeMasked(0x05, input, 0x60);
  }
}
