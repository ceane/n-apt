import {
  integrityPlaceholder,
  stampIntegrity,
  verifyStampedIntegrity,
} from "@n-apt/webusb/iqIntegrity";

const fixture = (): Uint8Array => {
  const json = new TextEncoder().encode(
    JSON.stringify({
      integrity: {
        algorithm: "SHA-256",
        scope: "file-with-integrity-digest-placeholder",
        digest: integrityPlaceholder(),
      },
    }),
  );
  const bytes = new Uint8Array(80 + 24 + json.length);
  // A checksum-looking metadata value must never receive the stamp.
  bytes.set(new TextEncoder().encode("0".repeat(64)));
  bytes.set(new TextEncoder().encode("NAPTTRLR"), 80);
  bytes[88] = 2;
  new DataView(bytes.buffer).setBigUint64(96, BigInt(json.length), true);
  bytes.set(json, 104);
  return bytes;
};
const digestOf = (bytes: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(bytes.subarray(104))).integrity.digest;
describe("capture integrity", () => {
  it("stamps only the trailer and verifies without mutating Buffer inputs", async () => {
    const input = Buffer.from(fixture());
    const original = Buffer.from(input);
    const stamped = await stampIntegrity(input);
    expect(input).toEqual(original);
    expect(stamped.slice(0, 64)).toEqual(new Uint8Array(64).fill(48));
    const buffer = Buffer.from(stamped);
    const copy = Buffer.from(buffer);
    await expect(
      verifyStampedIntegrity(buffer, digestOf(stamped)),
    ).resolves.toBe(true);
    expect(buffer).toEqual(copy);
  });
  it("rejects alterations anywhere in the file", async () => {
    const stamped = await stampIntegrity(fixture());
    const digest = digestOf(stamped);
    stamped[0] ^= 1;
    await expect(verifyStampedIntegrity(stamped, digest)).resolves.toBe(false);
  });
});
