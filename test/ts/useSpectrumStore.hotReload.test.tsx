import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { SpectrumProvider as InitialSpectrumProvider } from "@n-apt/spectrum/hooks/useSpectrumStore";

afterEach(() => {
  cleanup();
  jest.resetModules();
  jest.dontMock("react");
});

describe("SpectrumProvider during Fast Refresh", () => {
  it("keeps a provider usable when the store module is re-evaluated", () => {
    const stableReact = React;
    let reloadedUseSpectrumStore: (() => { state: unknown }) | undefined;

    jest.resetModules();
    jest.doMock("react", () => stableReact);
    jest.isolateModules(() => {
      const reloadedStore =
        require("@n-apt/spectrum/hooks/useSpectrumStore") as {
          useSpectrumStore: () => { state: unknown };
        };
      reloadedUseSpectrumStore = reloadedStore.useSpectrumStore;
    });

    const Probe: React.FC = () => {
      const store = reloadedUseSpectrumStore!();
      return <div data-testid="spectrum-store-probe">{String(!!store)}</div>;
    };

    render(
      <InitialSpectrumProvider mockValue={{} as never}>
        <Probe />
      </InitialSpectrumProvider>,
    );

    expect(screen.getByTestId("spectrum-store-probe")).toHaveTextContent(
      "true",
    );
  });
});
