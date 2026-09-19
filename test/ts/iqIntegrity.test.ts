import {
  integrityPlaceholder,
  stampIntegrity,
  verifyStampedIntegrity,
} from "@n-apt/webusb/iqIntegrity";

describe("NAPT v5 integrity stamping", () => {
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
});
