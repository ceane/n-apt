import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LogoutRoute } from "@n-apt/app/routes/pages/LogoutRoute";
import { TestWrapper } from "./testUtils";

const mockLogout = jest.fn();

jest.mock("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: () => ({ logout: mockLogout }),
}));

describe("LogoutRoute", () => {
  beforeEach(() => {
    mockLogout.mockClear();
  });

  it("renders a themed full-page status with three wave dots", () => {
    render(
      <TestWrapper>
        <LogoutRoute />
      </TestWrapper>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Logging out...");
    expect(screen.getByTestId("logout-ellipsis")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("logout-ellipsis").children).toHaveLength(3);
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
