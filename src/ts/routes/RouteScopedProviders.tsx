import React, { lazy, Suspense } from "react";
import { useLocation } from "react-router";

export type RouteProviderGroup =
  | "none"
  | "demod"
  | "model"
  | "map"
  | "draw-signal";

export const getRouteProviderGroup = (pathname: string): RouteProviderGroup => {
  if (pathname === "/demod" || pathname === "/demodulate") return "demod";
  if (pathname === "/3d-model" || pathname === "/3d-model-gallery") {
    return "model";
  }
  if (pathname === "/map-endpoints") return "map";
  if (pathname === "/draw-signal") return "draw-signal";
  return "none";
};

const LazyDemodRouteProviders = lazy(() =>
  import("@n-apt/routes/route-providers/DemodRouteProviders").then(
    (module) => ({
      default: module.DemodRouteProviders,
    }),
  ),
);
const LazyModelRouteProviders = lazy(() =>
  import("@n-apt/routes/route-providers/ModelRouteProviders").then(
    (module) => ({
      default: module.ModelRouteProviders,
    }),
  ),
);
const LazyMapRouteProviders = lazy(() =>
  import("@n-apt/routes/route-providers/MapRouteProviders").then((module) => ({
    default: module.MapRouteProviders,
  })),
);
const LazyDrawSignalRouteProviders = lazy(() =>
  import("@n-apt/routes/route-providers/DrawSignalRouteProviders").then(
    (module) => ({ default: module.DrawSignalRouteProviders }),
  ),
);

export const LazyDemodSidebarAdapter = lazy(() =>
  import("@n-apt/routes/route-providers/DemodRouteProviders").then(
    (module) => ({
      default: module.DemodSidebarAdapter,
    }),
  ),
);

const RouteProviderLoading: React.FC = () => <div aria-hidden="true" />;

export const RouteScopedProviders: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { pathname } = useLocation();
  const group = getRouteProviderGroup(pathname);

  if (group === "none") return <>{children}</>;

  const Provider =
    group === "demod"
      ? LazyDemodRouteProviders
      : group === "model"
        ? LazyModelRouteProviders
        : group === "map"
          ? LazyMapRouteProviders
          : LazyDrawSignalRouteProviders;

  return (
    <Suspense fallback={<RouteProviderLoading />}>
      <Provider>{children}</Provider>
    </Suspense>
  );
};
