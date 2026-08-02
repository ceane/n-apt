import type { LucideIcon } from "lucide-react";
import { Settings } from "lucide-react";

export interface SidebarNavRoute {
  path: string;
  dataPath: string;
  label: string;
  icon?: LucideIcon;
  isActive: (pathname: string) => boolean;
}

export const SIDEBAR_NAV_ROUTES: SidebarNavRoute[] = [
  {
    path: "/",
    dataPath: "/",
    label: "See FFT of N-APT (LF/HF freqs)",
    isActive: (pathname) => pathname === "/" || pathname === "/visualizer",
  },
  {
    path: "/demodulate",
    dataPath: "/demodulate",
    label: "Demod N-APT with ML",
    isActive: (pathname) =>
      pathname === "/demodulate" || pathname === "/demod",
  },
  {
    path: "/draw-signal",
    dataPath: "/draw-signal",
    label: "Draw N-APT with Math",
    isActive: (pathname) => pathname === "/draw-signal",
  },
  {
    path: "/3d-model",
    dataPath: "/3d-model",
    label: "3D Human Model",
    isActive: (pathname) => pathname === "/3d-model",
  },
  {
    path: "/map-endpoints",
    dataPath: "/map-endpoints",
    label: "Map Endpoints",
    isActive: (pathname) => pathname === "/map-endpoints",
  },
  {
    path: "/settings",
    dataPath: "/settings",
    label: "Settings",
    icon: Settings,
    isActive: (pathname) => pathname === "/settings",
  },
];

export const getActiveSidebarNavRoute = (
  pathname: string,
): SidebarNavRoute | undefined =>
  SIDEBAR_NAV_ROUTES.find((route) => route.isActive(pathname));
