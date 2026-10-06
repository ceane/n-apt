import {
  encodeIqCaptureV4,
  encodeNaptCaptureV4,
} from "@n-apt/webusb/iqCaptureFormat";

const encoder = new TextEncoder();
const keyBytes = new Uint8Array(32).fill(7);
const samples = Uint8Array.from({ length: 32 }, (_, index) => 128 + index);
const channels = [
  {
    offset_iq: 0,
    center_freq_hz: 100_000,
    sample_rate_hz: 1_000,
    label: "first",
  },
  {
    offset_iq: 16,
    center_freq_hz: 200_000,
    sample_rate_hz: 1_000,
    label: "second",
  },
];

function legacyFile(
  metadata: any,
  payload: Uint8Array,
  headerSize = 4096,
  newline = true,
): ArrayBuffer {
  const bytes = new Uint8Array(headerSize + payload.length);
  bytes.set(encoder.encode(JSON.stringify(metadata) + (newline ? "\n" : "")));
  bytes.set(payload, headerSize);
  return bytes.buffer;
}

function sectionedFile(
  options: {
    formatVersion?: number;
    binaryLength?: number;
    trailerVersion?: number;
    trailerJson?: string;
    frameUpdates?: Array<{
      sample_offset: number;
      timestamp_us: number;
      channel?: number;
      patch: Record<string, unknown>;
    }>;
    channels?: Array<
      (typeof channels)[number] & {
        iq_length?: number;
        requested_min_freq_hz?: number;
        requested_max_freq_hz?: number;
        bins_per_frame?: number;
      }
    >;
  } = {},
): ArrayBuffer {
  const trailerJson = encoder.encode(
    options.trailerJson ?? '{"processing":{"operation":"capture"}}',
  );
  const binaryLength = options.binaryLength ?? samples.length;
  const trailerOffset = 4096 + binaryLength;
  const bytes = new Uint8Array(trailerOffset + 24 + trailerJson.length);
  bytes.set(
    encoder.encode(
      JSON.stringify({
        metadata: {
          format_version: options.formatVersion ?? 4,
          encrypted: false,
          channels: options.channels ?? channels,
          frame_updates: options.frameUpdates,
          sections: {
            binary: { offset_bytes: 4096, length_bytes: binaryLength },
            trailer: {
              offset_bytes: trailerOffset,
              length_bytes: 24 + trailerJson.length,
              version: options.trailerVersion ?? 1,
            },
          },
        },
      }) + "\n",
    ),
  );
  bytes.set(samples.slice(0, binaryLength), 4096);
  bytes.set(encoder.encode("NAPTTRLR"), trailerOffset);
  bytes[trailerOffset + 8] = options.trailerVersion ?? 1;
  new DataView(bytes.buffer).setBigUint64(
    trailerOffset + 16,
    BigInt(trailerJson.length),
    true,
  );
  bytes.set(trailerJson, trailerOffset + 24);
  return bytes.buffer;
}

async function encrypt(
  payload: Uint8Array,
  rawKey = keyBytes,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = new Uint8Array(12).fill(3);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      payload as Uint8Array<ArrayBuffer>,
    ),
  );
  const result = new Uint8Array(12 + cipher.length);
  result.set(iv);
  result.set(cipher, 12);
  return result;
}

async function protectCapture(plaintext: Uint8Array): Promise<Uint8Array> {
  const salt = new Uint8Array(32).fill(19);
  const saltKey = await crypto.subtle.importKey(
    "raw",
    salt,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const pseudorandomKey = await crypto.subtle.sign("HMAC", saltKey, keyBytes);
  const expansionKey = await crypto.subtle.importKey(
    "raw",
    pseudorandomKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const context = new TextEncoder().encode("n-apt/capture-protection/v1");
  const expansionInput = new Uint8Array(context.length + 1);
  expansionInput.set(context);
  expansionInput[context.length] = 1;
  const captureKeyBytes = await crypto.subtle.sign(
    "HMAC",
    expansionKey,
    expansionInput,
  );
  const captureKey = await crypto.subtle.importKey(
    "raw",
    captureKeyBytes,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const nonce = new Uint8Array(12).fill(23);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      captureKey,
      plaintext as Uint8Array<ArrayBuffer>,
    ),
  );
  const envelope = new Uint8Array(
    8 + salt.length + nonce.length + ciphertext.length,
  );
  envelope.set(encoder.encode("NAPTENC1"), 0);
  envelope.set(salt, 8);
  envelope.set(nonce, 40);
  envelope.set(ciphertext, 52);
  return envelope;
}

let handler: (event: any) => Promise<void>;
let postMessage: jest.SpyInstance;
let consoleError: jest.SpyInstance;
const previousHandler = self.onmessage;

beforeAll(async () => {
  await import("@n-apt/workers/fileWorker");
  handler = self.onmessage as unknown as typeof handler;
});
afterAll(() => {
  self.onmessage = previousHandler;
});
beforeEach(() => {
  postMessage = jest.spyOn(self, "postMessage").mockImplementation(() => {});
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  postMessage.mockRestore();
  consoleError.mockRestore();
});

async function run(fileData: ArrayBuffer, extra: Record<string, unknown> = {}) {
  postMessage.mockClear();
  await handler({
    data: {
      type: "stitchFiles",
      id: "decode",
      data: {
        files: [{ fileData, fileName: "capture.napt" }],
        aesKey: keyBytes,
        settings: {},
        fftSize: 8,
        ...extra,
      },
    },
  });
  const messages = postMessage.mock.calls.map(([message]) => message);
  return messages.find(
    (message) => message.type === "result" || message.type === "error",
  );
}

function rawResult(result: any): Uint8Array {
  expect(result.type).toBe("result");
  return result.data.fileDataCache[0][1];
}

describe("NAPT decoding", () => {
  it.each([1024, 2048, 4096, 8192])(
    "decrypts legacy header offset %i",
    async (offset) => {
      const file = legacyFile(
        { encrypted: "true", channels: [{ ...channels[0], iq_length: 16 }] },
        await encrypt(samples),
        offset,
        false,
      );
      expect(rawResult(await run(file))).toEqual(samples.slice(0, 16));
    },
  );

  it("ignores braces and escaped quotes inside header strings", async () => {
    const file = legacyFile(
      {
        note: 'nested { \\" } text',
        encrypted: false,
        channels: [{ ...channels[0], iq_length: 16 }],
      },
      samples,
      4096,
      false,
    );
    expect(rawResult(await run(file))).toEqual(samples.slice(0, 16));
  });

  it.each([
    "wrapped_dek",
    "encrypted_dek",
    "wrapped_key",
    "encrypted_key",
    "session_key",
  ])("unwraps nested legacy %s", async (field) => {
    const dek = new Uint8Array(32).fill(9);
    const wrapped = await encrypt(dek);
    const file = legacyFile(
      {
        metadata: {
          encrypted: true,
          channels: [{ ...channels[0], iq_length: 16 }],
          [field]: btoa(String.fromCharCode(...wrapped)),
        },
      },
      await encrypt(samples, dek),
    );
    expect(rawResult(await run(file))).toEqual(samples.slice(0, 16));
  });

  it("decodes a sectioned trailer", async () => {
    const result = await run(sectionedFile());
    if (result.type === "error") throw new Error(result.error);
    expect(result.type).toBe("result");
    const metadata = result.data.metadataMap[0][1];
    expect(metadata.trailer).toEqual({ processing: { operation: "capture" } });
  });

  it("accepts the v2 trailer marker used by V6 captures", async () => {
    const result = await run(
      sectionedFile({ formatVersion: 6, trailerVersion: 2 }),
      { allowIntegrityFailure: true },
    );
    expect(result.type).toBe("result");
  });

  it("attaches V6 frame patches to the channel data used by playback", async () => {
    const frameUpdates: Array<{
      sample_offset: number;
      timestamp_us: number;
      channel?: number;
      patch: Record<string, unknown>;
    }> = [
      {
        sample_offset: 4,
        timestamp_us: 250,
        patch: { center_frequency_hz: 100_000 },
      },
    ];
    const result = await run(
      sectionedFile({
        formatVersion: 6,
        trailerVersion: 2,
        frameUpdates,
        channels: [{ ...channels[0], offset_iq: 0, iq_length: 16 }],
      }),
      { allowIntegrityFailure: true },
    );

    expect(result.type).toBe("result");
    const metadata = result.data.metadataMap[0][1];
    expect(metadata.channels_data[0].frame_updates).toEqual(
      frameUpdates.map(({ channel: _channel, ...update }) => update),
    );
  });

  it("preserves backend Frame timestamps and sequences for playback", async () => {
    const frameUpdates = [
      {
        sample_offset: 0,
        timestamp_us: 1_000_000,
        channel: 0,
        kind: "Frame",
        frame_sequence: 0,
        source_id: "rtl-sdr-0",
        job_id: "capture-1",
        patch: {},
      },
      {
        sample_offset: 8,
        timestamp_us: 1_125_000,
        channel: 0,
        kind: "Frame",
        frame_sequence: 1,
        source_id: "rtl-sdr-0",
        job_id: "capture-1",
        patch: {},
      },
    ];
    const result = await run(
      sectionedFile({
        formatVersion: 6,
        trailerVersion: 2,
        frameUpdates,
        channels: [{ ...channels[0], offset_iq: 0, iq_length: 16 }],
      }),
      { allowIntegrityFailure: true },
    );

    expect(result.type).toBe("result");
    const metadata = result.data.metadataMap[0][1];
    expect(metadata.channels_data[0].frame_updates).toEqual(
      frameUpdates.map(({ channel: _channel, ...update }) => update),
    );
  });

  it("routes channel-scoped V6 frame patches only to their matching channel", async () => {
    const frameUpdates = [
      {
        sample_offset: 4,
        timestamp_us: 250,
        channel: 0,
        patch: { center_frequency_hz: 100_000 },
      },
      {
        sample_offset: 8,
        timestamp_us: 500,
        channel: 1,
        patch: { center_frequency_hz: 200_000 },
      },
    ];
    const result = await run(
      sectionedFile({
        formatVersion: 6,
        trailerVersion: 2,
        frameUpdates,
        channels: [
          { ...channels[0], offset_iq: 0, iq_length: 16 },
          { ...channels[1], offset_iq: 16, iq_length: 16 },
        ],
      }),
      { allowIntegrityFailure: true },
    );

    expect(result.type).toBe("result");
    const metadata = result.data.metadataMap[0][1];
    expect(metadata.channels_data).toHaveLength(2);
    expect(metadata.channels_data[0].frame_updates).toEqual([
      {
        sample_offset: 4,
        timestamp_us: 250,
        patch: { center_frequency_hz: 100_000 },
      },
    ]);
    expect(metadata.channels_data[1].frame_updates).toEqual([
      {
        sample_offset: 8,
        timestamp_us: 500,
        patch: { center_frequency_hz: 200_000 },
      },
    ]);
  });

  it.each(["marker", "version", "length", "truncated", "json"])(
    "rejects malformed trailer: %s",
    async (failure) => {
      let file = sectionedFile(failure === "json" ? { trailerJson: "{" } : {});
      const bytes = new Uint8Array(file);
      const start = 4096 + samples.length;
      if (failure === "marker") bytes[start] = 0;
      if (failure === "version") bytes[start + 8] = 3;
      if (failure === "length")
        new DataView(file).setBigUint64(start + 16, 0n, true);
      if (failure === "truncated") file = file.slice(0, -1);
      const result = await run(file, { allowIntegrityFailure: true });
      expect(result.type).toBe("error");
      if (failure !== "json")
        expect(result.error).toContain(
          failure === "truncated"
            ? "section index"
            : `trailer ${failure === "version" ? "marker" : failure}`,
        );
    },
  );

  it("requires integrity for v5 unless explicitly overridden", async () => {
    const file = sectionedFile({ formatVersion: 5 });
    expect((await run(file)).error).toContain("INTEGRITY_FAILED");
    expect((await run(file, { allowIntegrityFailure: true })).type).toBe(
      "result",
    );
  });
});

describe("IQ trailer compatibility", () => {
  it("keeps originalVersion metadata visible to playback for upgraded V6 captures", async () => {
    const encoded = await encodeIqCaptureV4({
      metadata: {},
      originalVersion: 3,
      frameUpdates: [],
      chunks: [{ sample_offset: 0, channel: 0, data: samples }],
    });
    const result = await run(encoded.slice().buffer, {
      files: [{ fileData: encoded.slice().buffer, fileName: "upgraded.iq" }],
    });
    expect(result.type).toBe("result");
    expect(result.data.metadataMap[0][1]).toMatchObject({
      format_version: 6,
      originalVersion: 3,
    });
  });

  it("decodes a stamped IQ capture produced by the real encoder", async () => {
    const encoded = await encodeIqCaptureV4({
      metadata: {},
      frameUpdates: [],
      chunks: [{ sample_offset: 0, channel: 0, data: samples }],
    });
    const result = await run(encoded.slice().buffer, {
      files: [{ fileData: encoded.slice().buffer, fileName: "capture.iq" }],
    });
    expect(rawResult(result)).toEqual(samples);
  });

  it.each(["marker", "length", "truncated", "integrity"])(
    "rejects IQ trailer %s even with the NAPT override",
    async (failure) => {
      const encoded = await encodeIqCaptureV4({
        metadata: {},
        frameUpdates: [],
        chunks: [{ sample_offset: 0, channel: 0, data: samples }],
      });
      let file = encoded.slice().buffer;
      const view = new DataView(file);
      const trailerStart =
        40 +
        Number(view.getBigUint64(8, true)) +
        Number(view.getBigUint64(16, true)) +
        Number(view.getBigUint64(24, true));
      if (failure === "marker") new Uint8Array(file)[trailerStart] = 0;
      if (failure === "length") view.setBigUint64(trailerStart + 16, 0n, true);
      if (failure === "truncated") file = file.slice(0, -1);
      if (failure === "integrity") new Uint8Array(file)[trailerStart - 1] ^= 1;
      const result = await run(file, {
        files: [{ fileData: file, fileName: "capture.iq" }],
        allowIntegrityFailure: true,
      });
      expect(result.type).toBe("error");
      expect(result.error).toContain(
        failure === "integrity"
          ? "INTEGRITY_FAILED"
          : `Invalid IQ v4 trailer ${failure === "truncated" ? "bounds" : failure}`,
      );
    },
  );
});

describe("protected capture playback", () => {
  it("refuses local decryption because the salt must come from authenticated Redis-backed playback", async () => {
    const capture = await encodeIqCaptureV4({
      metadata: {
        center_frequency_hz: 137_500_000,
        capture_sample_rate_hz: 3_200_000,
      },
      frameUpdates: [],
      chunks: [{ sample_offset: 0, channel: 0, data: samples }],
    });
    const protectedCapture = await protectCapture(capture);
    const file = protectedCapture.slice().buffer;
    const result = await run(file, {
      files: [{ fileData: file, fileName: "capture.iq.enc" }],
    });

    expect(result.type).toBe("error");
    expect(result.error).toContain("salt in Redis");
  });
});

describe("NAPT stitching policies", () => {
  it("stitches all channels using the next channel offset", async () => {
    const file = legacyFile({ metadata: { channels } }, samples);
    const stitched = await run(file);
    expect(
      stitched.data.channels.map((channel: any) => channel.iq_data),
    ).toEqual([samples.slice(0, 16), samples.slice(16)]);
  });

  it("prefers nested channels over top-level channels", async () => {
    const file = legacyFile(
      {
        channels: [{ ...channels[0], offset_iq: 16, iq_length: 16 }],
        metadata: { channels: [{ ...channels[0], iq_length: 16 }] },
      },
      samples,
    );
    expect(rawResult(await run(file))).toEqual(samples.slice(0, 16));
  });

  it("rejects headers smaller than the legacy probe sizes", async () => {
    const file = legacyFile(
      {
        channels: [{ offset_iq: 0, iq_length: 4 }],
        sections: { binary: { offset_bytes: 256 } },
      },
      samples,
      256,
    );
    expect((await run(file)).error).toContain("Could not parse NAPT header");
  });

  it("retains unencrypted offset probes for short indexed payloads", async () => {
    const file = sectionedFile({ binaryLength: 4 });
    expect(rawResult(await run(file))).toEqual(new Uint8Array(16));
  });

  it("accepts a zero-length indexed binary section", async () => {
    const file = sectionedFile({ binaryLength: 0 });
    expect((await run(file)).type).toBe("result");
  });

  it("decodes a stamped capture produced by the real encoder", async () => {
    const passphrase = "fixture passphrase";
    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const rawKey = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode("n-apt-aes-salt-v1"),
        iterations: 100_000,
        hash: "SHA-256",
      },
      material,
      256,
    );
    const bytes = await encodeNaptCaptureV4({
      metadata: {},
      channels: channels.map((channel) => ({
        ...channel,
        bins_per_frame: 8,
        iq_length: 16,
      })),
      data: samples,
      passphrase,
    });
    expect(
      rawResult(await run(bytes.slice().buffer, { aesKey: rawKey })),
    ).toEqual(samples.slice(0, 16));
  });
});
