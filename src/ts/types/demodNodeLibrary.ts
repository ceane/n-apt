import type { DragEvent, ReactNode } from "react";

export interface DemodNodeLibraryItem {
  id: string;
  type: string;
  label: string;
  description: string;
  icon: ReactNode;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export type DemodNodeLibraryDragStart = (
  event: DragEvent<HTMLDivElement>,
  item: DemodNodeLibraryItem,
) => void;
