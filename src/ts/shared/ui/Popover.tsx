import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";

export type PopoverHorizontalAnchor = "left" | "right";

export interface PopoverPositionInput {
  anchorRect: Pick<DOMRect, "top" | "bottom" | "left" | "right">;
  popoverSize: Pick<DOMRect, "width" | "height">;
  viewportSize: { width: number; height: number };
  horizontalAnchor?: PopoverHorizontalAnchor;
  gutter?: number;
}

export interface PopoverPosition {
  top: number;
  left: number;
}

const clampToViewport = (
  value: number,
  size: number,
  viewportSize: number,
  gutter: number,
) => {
  const maximum = Math.max(gutter, viewportSize - size - gutter);
  return Math.min(Math.max(gutter, value), maximum);
};

export const getPopoverPosition = ({
  anchorRect,
  popoverSize,
  viewportSize,
  horizontalAnchor = "right",
  gutter = 8,
}: PopoverPositionInput): PopoverPosition => {
  const preferredLeft =
    horizontalAnchor === "left"
      ? anchorRect.left
      : anchorRect.right - popoverSize.width;
  const belowTop = anchorRect.bottom + gutter;
  const aboveTop = anchorRect.top - popoverSize.height - gutter;
  const canFitBelow = belowTop + popoverSize.height <= viewportSize.height - gutter;
  const preferredTop = canFitBelow ? belowTop : aboveTop;

  return {
    left: clampToViewport(
      preferredLeft,
      popoverSize.width,
      viewportSize.width,
      gutter,
    ),
    top: clampToViewport(
      preferredTop,
      popoverSize.height,
      viewportSize.height,
      gutter,
    ),
  };
};

const PopoverSurface = styled.div`
  position: fixed;
  z-index: 1100;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid ${({ theme }) => theme.colors?.border || "#475569"};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors?.surface || "#212121"};
  color: ${({ theme }) => theme.colors?.textPrimary || "#e2e8f0"};
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
`;

const PopoverTitle = styled.h2`
  margin: 0 0 8px;
  color: ${({ theme }) => theme.colors?.textPrimary || "#e2e8f0"};
  font: 600 11px ${({ theme }) => theme.typography?.mono || "monospace"};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

export interface PopoverProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose?: () => void;
  horizontalAnchor?: PopoverHorizontalAnchor;
  gutter?: number;
  title?: ReactNode;
  children: ReactNode;
  id?: string;
  role?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
}

export const Popover: React.FC<PopoverProps> = ({
  open,
  anchorRef,
  onClose,
  horizontalAnchor = "right",
  gutter = 8,
  title,
  children,
  style,
  ...surfaceProps
}) => {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PopoverPosition>({
    top: gutter,
    left: gutter,
  });
  const [hasMeasured, setHasMeasured] = useState(false);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const surface = surfaceRef.current;
    if (!anchor || !surface) return;

    const nextPosition = getPopoverPosition({
      anchorRect: anchor.getBoundingClientRect(),
      popoverSize: surface.getBoundingClientRect(),
      viewportSize: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      horizontalAnchor,
      gutter,
    });
    setPosition(nextPosition);
    setHasMeasured(true);
  }, [anchorRef, gutter, horizontalAnchor]);

  useLayoutEffect(() => {
    if (!open) return;
    setHasMeasured(false);
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const anchor = anchorRef.current;
      const surface = surfaceRef.current;
      if (
        target &&
        (!anchor || !anchor.contains(target)) &&
        (!surface || !surface.contains(target))
      ) {
        onClose?.();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updatePosition)
        : null;
    if (resizeObserver) {
      if (anchorRef.current) resizeObserver.observe(anchorRef.current);
      if (surfaceRef.current) resizeObserver.observe(surfaceRef.current);
    }

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      resizeObserver?.disconnect();
    };
  }, [anchorRef, onClose, open, updatePosition]);

  if (!open) return null;

  return createPortal(
    <PopoverSurface
      ref={surfaceRef}
      {...surfaceProps}
      style={{
        ...style,
        top: position.top,
        left: position.left,
        visibility: hasMeasured ? "visible" : "hidden",
      }}
    >
      {title ? <PopoverTitle>{title}</PopoverTitle> : null}
      {children}
    </PopoverSurface>,
    document.body,
  );
};

Popover.displayName = "Popover";

export default Popover;
