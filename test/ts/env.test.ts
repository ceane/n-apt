describe("env constants", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("expands process env references", async () => {
    process.env.NAPT_PBKDF2_SALT = "shared-salt";
    process.env.VITE_PBKDF2_SALT = "$NAPT_PBKDF2_SALT";

    const { PBKDF2_SALT_VAL } = await import("../../src/ts/consts/env");

    expect(PBKDF2_SALT_VAL).toBe("shared-salt");
  });

  it("ignores unresolved references so defaults can apply", async () => {
    process.env.VITE_PBKDF2_SALT = "$NAPT_PBKDF2_SALT";
    delete process.env.NAPT_PBKDF2_SALT;

    const { PBKDF2_SALT_VAL } = await import("../../src/ts/consts/env");

    expect(PBKDF2_SALT_VAL).toBe("n-apt-aes-salt-v1");
  });
});
