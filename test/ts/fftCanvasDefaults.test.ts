import { resolveLimitMarkers } from "../../src/ts/components/FFTCanvas";

describe("FFTCanvas defaults", () => {
  it("reuses the same empty limit-marker list across renders", () => {
    expect(resolveLimitMarkers(undefined)).toBe(resolveLimitMarkers(undefined));
  });
});
