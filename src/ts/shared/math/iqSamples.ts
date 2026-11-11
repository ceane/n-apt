export type IqSampleEncoding = {
  element_type: "integer";
  /** Number of significant bits in each I or Q value. */
  bits_per_element: 8 | 10 | 12 | 16;
  /** Container width; 10- and 12-bit values use signed 16-bit containers. */
  storage_bits_per_element?: 8 | 16;
  signed: boolean;
  byte_order?: "little" | "big";
  /** Where significant bits sit in a wider container. */
  bit_alignment?: "right" | "left";
  normalization?: string;
};

export const U8_IQ_ENCODING: IqSampleEncoding = {
  element_type: "integer",
  bits_per_element: 8,
  storage_bits_per_element: 8,
  signed: false,
  byte_order: "little",
  bit_alignment: "right",
  normalization: "(value - 128) / 128",
};

export const getIqComponentStorageBytes = (
  encoding?: IqSampleEncoding | null,
): number => {
  const bits = encoding?.storage_bits_per_element ??
    (encoding?.bits_per_element === undefined || encoding.bits_per_element === 8
      ? 8
      : 16);
  return bits / 8;
};

/** Return one IQ component as a normalized float in approximately [-1, 1]. */
export const readNormalizedIqComponent = (
  bytes: Uint8Array,
  componentIndex: number,
  encoding?: IqSampleEncoding | null,
): number => {
  const sampleEncoding = encoding ?? U8_IQ_ENCODING;
  const significantBits = sampleEncoding.bits_per_element;
  const storageBytes = getIqComponentStorageBytes(sampleEncoding);
  const offset = componentIndex * storageBytes;
  if (offset + storageBytes > bytes.length) return 0;

  if (storageBytes === 1) {
    const value = bytes[offset];
    if (sampleEncoding.signed) {
      const signedValue = value >= 128 ? value - 256 : value;
      return signedValue / 2 ** (significantBits - 1);
    }
    return (value - 2 ** (significantBits - 1)) / 2 ** (significantBits - 1);
  }

  const littleEndian = sampleEncoding.byte_order !== "big";
  const raw = littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
  let value = sampleEncoding.signed && raw >= 0x8000 ? raw - 0x10000 : raw;
  if (significantBits < 16) {
    if (sampleEncoding.bit_alignment === "left") {
      value >>= 16 - significantBits;
    } else {
      const signBit = 1 << (significantBits - 1);
      const mask = (1 << significantBits) - 1;
      value &= mask;
      if (sampleEncoding.signed && (value & signBit)) value -= 1 << significantBits;
    }
  }
  const midpoint = 2 ** (significantBits - 1);
  return sampleEncoding.signed
    ? value / midpoint
    : (value - midpoint) / midpoint;
};

export const decodeIqToNormalizedFloat32 = (
  bytes: Uint8Array,
  encoding?: IqSampleEncoding | null,
): Float32Array => {
  const storageBytes = getIqComponentStorageBytes(encoding);
  const componentCount = Math.floor(bytes.length / storageBytes);
  const samples = new Float32Array(componentCount);
  for (let i = 0; i < componentCount; i += 1) {
    samples[i] = readNormalizedIqComponent(bytes, i, encoding);
  }
  return samples;
};

/** Make the legacy U8 view required by the spectrum renderer, leaving source bytes untouched. */
export const makeIqU8DisplayView = (
  bytes: Uint8Array,
  encoding?: IqSampleEncoding | null,
): Uint8Array => {
  if (
    (!encoding ||
      (encoding.bits_per_element === 8 &&
        (encoding.storage_bits_per_element ?? 8) === 8 &&
        !encoding.signed)) &&
    bytes.length % 2 === 0
  ) {
    return bytes;
  }

  const normalized = decodeIqToNormalizedFloat32(bytes, encoding);
  const display = new Uint8Array(normalized.length);
  for (let i = 0; i < normalized.length; i += 1) {
    display[i] = Math.max(0, Math.min(255, Math.round(normalized[i] * 127 + 128)));
  }
  return display;
};
