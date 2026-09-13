import { buildSafeDownloadUrl } from "@n-apt/ui/downloadUrl";

describe("buildSafeDownloadUrl", () => {
  it("rejects cross-origin and non-capture URLs", () => {
    expect(
      buildSafeDownloadUrl("https://evil.example/capture.napt", "secret"),
    ).toBeUndefined();
    expect(buildSafeDownloadUrl("javascript:alert(1)", "secret")).toBeUndefined();
    expect(
      buildSafeDownloadUrl("/api/admin/delete", "secret"),
    ).toBeUndefined();
  });

  it("adds the token as a URL parameter to a same-origin capture URL", () => {
    const href = buildSafeDownloadUrl(
      "/api/capture/download?jobId=job-123",
      "secret&value",
    );

    expect(href).toBeDefined();
    const url = new URL(href!);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/api/capture/download");
    expect(url.searchParams.get("jobId")).toBe("job-123");
    expect(url.searchParams.get("token")).toBe("secret&value");
  });
});
