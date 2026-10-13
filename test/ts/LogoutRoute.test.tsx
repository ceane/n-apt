import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LogoutRoute } from "@n-apt/app/routes/pages/LogoutRoute";
import { ThemeProvider } from "styled-components";
import { buildAppTheme } from "@n-apt/ui/Theme";
const theme = buildAppTheme({
  accentColor: "#ffffff",
  fftColor: "#ffffff",
  appMode: "dark",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
);

const mockLogout = jest.fn();

jest.mock("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: () => ({ logout: mockLogout }),
}));

describe("LogoutRoute", () => {
  beforeEach(() => {
    mockLogout.mockReset();
    mockLogout.mockResolvedValue(undefined);
  });

  it("shows revocation failure and allows retry", async () => {
    mockLogout.mockRejectedValueOnce(new Error("logout failed: 503"));
    render(
      <TestWrapper>
        <LogoutRoute />
      </TestWrapper>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "logout failed: 503",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry logout" }));
    expect(mockLogout).toHaveBeenCalledTimes(2);
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
