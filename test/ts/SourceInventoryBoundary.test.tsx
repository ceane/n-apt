import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SourceInventoryBoundary } from "@n-apt/app/SourceInventoryBoundary";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { TestWrapper } from "./testUtils";
import {
  connectWebSocket,
  disconnectWebSocket,
} from "@n-apt/redux/thunks/websocketThunks";

jest.mock("@n-apt/redux/thunks/websocketThunks", () => ({
  connectWebSocket: jest.fn((payload) => ({
    type: "test/connect-websocket",
    payload,
  })),
  disconnectWebSocket: jest.fn(() => ({
    type: "test/disconnect-websocket",
  })),
}));

jest.mock("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: jest.fn(),
}));

describe("SourceInventoryBoundary", () => {
  beforeEach(() => {
    jest.mocked(useAuthentication).mockReturnValue({
      isAuthenticated: true,
      sessionToken: "boundary-session",
      aesKey: null,
    } as ReturnType<typeof useAuthentication>);
  });

  it("owns the authenticated control-plane connection without the spectrum store", () => {
    render(
      <TestWrapper>
        <SourceInventoryBoundary>
          <span>onboarding content</span>
        </SourceInventoryBoundary>
      </TestWrapper>,
    );

    expect(screen.getByText("onboarding content")).toBeInTheDocument();
    expect(connectWebSocket).toHaveBeenCalledWith({
      url: expect.stringContaining("boundary-session"),
      aesKey: null,
      enabled: true,
    });
    expect(disconnectWebSocket).not.toHaveBeenCalled();
  });
});
