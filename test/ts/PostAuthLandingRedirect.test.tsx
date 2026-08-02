import * as React from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PostAuthLandingRedirect } from "@n-apt/components/PostAuthLandingRedirect";

jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: jest.fn(),
}));

jest.mock("@n-apt/utils/bypassStartPage", () => ({
  getPostAuthLandingPath: jest.fn(),
}));

const { useAuthentication } = jest.requireMock("@n-apt/hooks/useAuthentication");
const { getPostAuthLandingPath } = jest.requireMock(
  "@n-apt/utils/bypassStartPage",
);

const Dummy = ({ label }: { label: string }) => <div>{label}</div>;

const Harness = ({ initialPath }: { initialPath: string }) => (
  <MemoryRouter initialEntries={[initialPath]}>
    <Routes>
      <Route
        path="/"
        element={
          <PostAuthLandingRedirect>
            <Dummy label="app" />
          </PostAuthLandingRedirect>
        }
      />
      <Route
        path="/auth"
        element={
          <PostAuthLandingRedirect>
            <Dummy label="auth" />
          </PostAuthLandingRedirect>
        }
      />
      <Route
        path="/get-started"
        element={
          <PostAuthLandingRedirect>
            <Dummy label="get-started" />
          </PostAuthLandingRedirect>
        }
      />
      <Route path="*" element={<Dummy label="elsewhere" />} />
    </Routes>
  </MemoryRouter>
);

const renderAt = (initialPath: string) =>
  render(<Harness initialPath={initialPath} />);

describe("PostAuthLandingRedirect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPostAuthLandingPath.mockReturnValue("/get-started");
  });

  it("redirects to the start page after authenticating on /", async () => {
    // Login screen shown (auth check done, unauthenticated, protected path).
    useAuthentication.mockReturnValue({
      isAuthenticated: false,
      isInitialAuthCheck: false,
    });
    const { rerender } = renderAt("/");
    expect(screen.getByText("app")).toBeInTheDocument();

    // Login completes.
    useAuthentication.mockReturnValue({
      isAuthenticated: true,
      isInitialAuthCheck: false,
    });
    rerender(<Harness initialPath="/" />);

    expect(await screen.findByText("get-started")).toBeInTheDocument();
  });

  it("redirects to the start page after authenticating on /auth", async () => {
    useAuthentication.mockReturnValue({
      isAuthenticated: false,
      isInitialAuthCheck: false,
    });
    const { rerender } = renderAt("/auth");
    expect(screen.getByText("auth")).toBeInTheDocument();

    useAuthentication.mockReturnValue({
      isAuthenticated: true,
      isInitialAuthCheck: false,
    });
    rerender(<Harness initialPath="/auth" />);

    expect(await screen.findByText("get-started")).toBeInTheDocument();
  });

  it("does not redirect a returning user whose stored session is restored", async () => {
    getPostAuthLandingPath.mockReturnValue("/");
    // Initial auth check in progress...
    useAuthentication.mockReturnValue({
      isAuthenticated: true,
      isInitialAuthCheck: true,
    });
    const { rerender } = renderAt("/");
    expect(screen.getByText("app")).toBeInTheDocument();

    // ...then resolves authenticated directly (no login screen shown).
    useAuthentication.mockReturnValue({
      isAuthenticated: true,
      isInitialAuthCheck: false,
    });
    rerender(<Harness initialPath="/" />);

    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.queryByText("get-started")).not.toBeInTheDocument();
  });

  it("does not redirect after visiting a public route unauthenticated", async () => {
    useAuthentication.mockReturnValue({
      isAuthenticated: false,
      isInitialAuthCheck: false,
    });
    renderAt("/get-started");
    expect(screen.getByText("get-started")).toBeInTheDocument();

    // Auth completes after browsing a public page — no redirect should fire.
    useAuthentication.mockReturnValue({
      isAuthenticated: true,
      isInitialAuthCheck: false,
    });
    expect(screen.getByText("get-started")).toBeInTheDocument();
  });
});
