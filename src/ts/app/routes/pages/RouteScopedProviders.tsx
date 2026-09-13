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
  import("@n-apt/app/routes/pages/route-providers/DemodRouteProviders").then(
    (module) => ({
      default: module.DemodRouteProviders,
    }),
  ),
);

let demodRoutePreload: Promise<
  typeof import("@n-apt/app/routes/pages/DemodRoute")
> | null = null;

/** Start the demod route chunk while the scoped provider is loading. */
export const preloadDemodRoute = () => {
  demodRoutePreload ??= import("@n-apt/app/routes/pages/DemodRoute");
  return demodRoutePreload;
};

let demodProviderPreload: Promise<
  typeof import("@n-apt/app/routes/pages/route-providers/DemodRouteProviders")
> | null = null;

/** Start the demod provider/sidebar chunk ahead of navigation. */
export const preloadDemodProvider = () => {
  demodProviderPreload ??=
    import("@n-apt/app/routes/pages/route-providers/DemodRouteProviders");
  return demodProviderPreload;
};

/**
 * Start every demod chunk (provider, sidebar, and route) before the user
 * clicks the nav entry, so Settings → Demod navigates without a provider
 * waterfall or a shell-wide "Loading route…" flash.
 */
export const preloadDemodChunk = () => {
  void preloadDemodProvider();
  void preloadDemodRoute();
};
const LazyModelRouteProviders = lazy(() =>
  import("@n-apt/app/routes/pages/route-providers/ModelRouteProviders").then(
    (module) => ({
      default: module.ModelRouteProviders,
    }),
  ),
);
const LazyMapRouteProviders = lazy(() =>
  import("@n-apt/app/routes/pages/route-providers/MapRouteProviders").then((module) => ({
    default: module.MapRouteProviders,
  })),
);
const LazyDrawSignalRouteProviders = lazy(() =>
  import("@n-apt/app/routes/pages/route-providers/DrawSignalRouteProviders").then(
    (module) => ({ default: module.DrawSignalRouteProviders }),
  ),
);

export const LazyDemodSidebarAdapter = lazy(() =>
  import("@n-apt/app/routes/pages/route-providers/DemodRouteProviders").then(
    (module) => ({
      default: module.DemodSidebarAdapter,
    }),
  ),
);

export const RouteProviderLoading: React.FC = () => (
  <div
    data-testid="route-provider-loading"
    role="status"
    style={{
      display: "grid",
      minHeight: "100vh",
      placeItems: "center",
      color: "var(--color-text-secondary, #888888)",
      fontFamily: "var(--font-mono, monospace)",
      fontSize: 12,
    }}
  >
    Loading route…
  </div>
);

export const RouteScopedProviders: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { pathname } = useLocation();
  const group = getRouteProviderGroup(pathname);

  if (group === "demod") {
    // The provider and route are independent chunks. Starting both imports in
    // the same render removes the provider -> route waterfall on first entry.
    void preloadDemodRoute();
  }

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
