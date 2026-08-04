import {
  readSidebarRoutesExpanded,
  writeSidebarRoutesExpanded,
  SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY,
} from "@n-apt/utils/sidebarRoutesExpanded";

describe("sidebarRoutesExpanded", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to expanded when nothing is stored", () => {
    expect(readSidebarRoutesExpanded()).toBe(true);
    expect(readSidebarRoutesExpanded(false)).toBe(false);
  });

  it("persists expanded state in localStorage", () => {
    writeSidebarRoutesExpanded(false);
    expect(window.localStorage.getItem(SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY)).toBe(
      "false",
    );
    expect(readSidebarRoutesExpanded()).toBe(false);

    writeSidebarRoutesExpanded(true);
    expect(readSidebarRoutesExpanded()).toBe(true);
  });
});
