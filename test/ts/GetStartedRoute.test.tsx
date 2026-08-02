import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom";
import { GetStartedRoute } from "@n-apt/routes/GetStartedRoute";
import { TestWrapper } from "./testUtils";

const renderRoute = (preloadedState?: unknown) =>
  render(
    <MemoryRouter>
      <TestWrapper preloadedState={preloadedState}>
        <GetStartedRoute />
      </TestWrapper>
    </MemoryRouter>,
  );

describe("GetStartedRoute", () => {
  it("shows the centered welcome page with eight starting points", () => {
    renderRoute();

    expect(screen.getByRole("img", { name: "N-APT" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Let's get started." }),
    ).toBeInTheDocument();

    expect(screen.getAllByRole("article")).toHaveLength(8);
    expect(screen.getByText("Take an I/Q Capture")).toBeInTheDocument();
    expect(screen.getByText("Use app")).toBeInTheDocument();
    expect(screen.getByText("View signals via SDRs")).toBeInTheDocument();
    expect(screen.getByText("Lingo and Learn")).toBeInTheDocument();
    expect(screen.getByText("See hardware gallery")).toBeInTheDocument();
    expect(screen.getByText("Learn more about signals")).toBeInTheDocument();
    expect(screen.getByText("Terms and Conditions")).toBeInTheDocument();
    expect(screen.getByText("Privacy Policy")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /Bypass Start Page Next Time/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("No SDRs connected")).toBeInTheDocument();
    expect(screen.queryByText("RTL-SDR")).not.toBeInTheDocument();
    expect(screen.queryByText("HackRF One")).not.toBeInTheDocument();
  });

  it("links each starting point to its destination", () => {
    renderRoute();

    expect(
      screen.getByRole("link", { name: /Take an I\/Q Capture/i }),
    ).toHaveAttribute("href", "/?sidebarSection=iq-capture");
    expect(screen.getByRole("link", { name: /Use app/i })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByRole("link", { name: /View signals via SDRs/i }),
    ).toHaveAttribute("href", "/");
    expect(
      screen.getByRole("link", { name: /Lingo and Learn/i }),
    ).toHaveAttribute("href", "/faq");
    expect(
      screen.getByRole("link", { name: /See hardware gallery/i }),
    ).toHaveAttribute("href", "/3d-model-gallery");
    expect(
      screen.getByRole("link", { name: /Learn more about signals/i }),
    ).toHaveAttribute("href", "/learn-signals");
    expect(
      screen.getByRole("link", { name: /Terms and Conditions/i }),
    ).toHaveAttribute("href", "/terms");
    expect(
      screen.getByRole("link", { name: /Privacy Policy/i }),
    ).toHaveAttribute("href", "/privacy");
  });

  it("persists bypass start page preference from the Use app card", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    renderRoute();

    const toggle = screen.getByRole("switch", {
      name: /Bypass Start Page Next Time/i,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem("n-apt-bypass-start-page")).toBe("true");
  });

  it("renders source names from the Redux websocket inventory", () => {
    renderRoute({
      websocket: {
        isConnected: true,
        sources: [
          { id: "connected-sdr", name: "Connected SDR", kind: "rtl-sdr" },
          { id: "mock-apt", name: "Mock APT", kind: "mock_apt" },
        ],
      },
    });

    expect(screen.getByText("Connected SDR")).toBeInTheDocument();
    expect(screen.queryByText("Mock APT")).not.toBeInTheDocument();
    expect(screen.queryByText("No SDRs connected")).not.toBeInTheDocument();
  });
});
