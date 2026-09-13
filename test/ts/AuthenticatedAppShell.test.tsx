import { getAuthenticatedShellKind } from "@n-apt/app/AuthenticatedAppShell";

describe("authenticated route shell selection", () => {
  it("keeps /get-started on the lightweight authenticated shell", () => {
    expect(getAuthenticatedShellKind("/get-started")).toBe("onboarding");
  });

  it("keeps full application routes on the streaming shell", () => {
    expect(getAuthenticatedShellKind("/")).toBe("application");
    expect(getAuthenticatedShellKind("/visualizer")).toBe("application");
    expect(getAuthenticatedShellKind("/demodulate")).toBe("application");
  });
});
