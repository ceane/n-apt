export interface SidebarStickyGeometry {
  headerTop: number;
  scrollContainerTop: number;
  wasCompact: boolean;
}

const STICKY_COMPACT_ENTER_OFFSET_PX = 0;
const STICKY_COMPACT_EXIT_OFFSET_PX = 16;

/**
 * Uses the rendered sticky header position so programmatic navigation scrolls
 * and user scrolling follow the same compaction rule.
 */
export const shouldCompactSidebarSourceList = ({
  headerTop,
  scrollContainerTop,
  wasCompact,
}: SidebarStickyGeometry): boolean => {
  const offset = wasCompact
    ? STICKY_COMPACT_EXIT_OFFSET_PX
    : STICKY_COMPACT_ENTER_OFFSET_PX;

  return headerTop <= scrollContainerTop + offset;
};
