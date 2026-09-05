import { resolveLimitMarkers } from "@n-apt/spectrum/FFTCanvas";

describe("FFTCanvas defaults", () => {
  it("reuses the same empty limit-marker list across renders", () => {
    expect(resolveLimitMarkers(undefined)).toBe(resolveLimitMarkers(undefined));
  });
});
