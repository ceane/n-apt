import {
  integrityPlaceholder,
  stampIntegrity,
  verifyStampedIntegrity,
} from "@n-apt/webusb/iqIntegrity";

describe("NAPT V6 integrity stamping", () => {
  it("stamps and verifies the complete placeholder-form file", async () => {
    const bytes = new TextEncoder().encode(
      `header trailer {"digest":"${integrityPlaceholder()}"}`,
    );
    const stamped = await stampIntegrity(bytes);
    const digest = new TextDecoder().decode(stamped).match(/[0-9a-f]{64}/)?.[0];

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    await expect(verifyStampedIntegrity(stamped, digest!)).resolves.toBe(true);
  });

  it("rejects a file changed after stamping", async () => {
    const stamped = await stampIntegrity(
      new TextEncoder().encode(`x ${integrityPlaceholder()} y`),
    );
    const digest = new TextDecoder().decode(stamped).match(/[0-9a-f]{64}/)?.[0];
    stamped[0] ^= 1;

    await expect(verifyStampedIntegrity(stamped, digest!)).resolves.toBe(false);
  });

  it("does not mutate Buffer-backed capture bytes while verifying", async () => {
    const stamped = await stampIntegrity(
      new TextEncoder().encode(`x ${integrityPlaceholder()} y`),
    );
    const digest = new TextDecoder().decode(stamped).match(/[0-9a-f]{64}/)?.[0];
    const buffered = Buffer.from(stamped);
    const original = Buffer.from(buffered);

    const isValid = await verifyStampedIntegrity(buffered, digest!);
    expect(buffered).toEqual(original);
    expect(isValid).toBe(true);
  });

  it("stamps Buffer-backed files without changing the input buffer", async () => {
    const input = Buffer.from(`header ${integrityPlaceholder()} trailer`);
    const original = Buffer.from(input);

    const stamped = await stampIntegrity(input);
    const digest = new TextDecoder().decode(stamped).match(/[0-9a-f]{64}/)?.[0];

    expect(input).toEqual(original);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    await expect(verifyStampedIntegrity(stamped, digest!)).resolves.toBe(true);
  });
});
