import { shouldCompactSidebarSourceList } from "../../src/ts/utils/sidebarStickyState";

describe("sidebar source compaction during navigation scrolling", () => {
  it("compacts when an auto-scrolled source header reaches the container edge", () => {
    expect(
      shouldCompactSidebarSourceList({
        headerTop: 0,
        scrollContainerTop: 0,
        wasCompact: false,
      }),
    ).toBe(true);
  });

  it("keeps the source list compact through the sticky exit buffer", () => {
    expect(
      shouldCompactSidebarSourceList({
        headerTop: 12,
        scrollContainerTop: 0,
        wasCompact: true,
      }),
    ).toBe(true);
  });

  it("expands only after the header clears the exit buffer", () => {
    expect(
      shouldCompactSidebarSourceList({
        headerTop: 17,
        scrollContainerTop: 0,
        wasCompact: true,
      }),
    ).toBe(false);
  });
});
