import {
  getBypassStartPage,
  getPostAuthLandingPath,
  setBypassStartPage,
} from "@n-apt/app/auth/bypassStartPage";

describe("bypassStartPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults bypass to off", () => {
    expect(getBypassStartPage()).toBe(false);
    expect(getPostAuthLandingPath()).toBe("/get-started");
  });

  it("persists bypass preference", () => {
    setBypassStartPage(true);
    expect(getBypassStartPage()).toBe(true);
    expect(getPostAuthLandingPath()).toBe("/");
  });
});
