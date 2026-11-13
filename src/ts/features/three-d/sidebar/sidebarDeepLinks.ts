const BASE = "/3d-model";

export const sidebarSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const SIDEBAR_ROUTES = {
  physiology: `${BASE}/physiology`,
  psychology: `${BASE}/psychology`,
  anatomy: `${BASE}/anatomy`,
  brain: `${BASE}/anatomy/brain`,
  nervous: `${BASE}/anatomy/nervous-system`,
  effects: `${BASE}/effects`,
  hotspots: `${BASE}/hotspots`,
};

export const physiologyCardRoute = (name: string) => `${SIDEBAR_ROUTES.physiology}/${sidebarSlug(name)}`;
export const anatomyGroupRoute = (kind: "brain" | "nervous", group: string) => `${kind === "brain" ? SIDEBAR_ROUTES.brain : SIDEBAR_ROUTES.nervous}/group/${sidebarSlug(group)}`;
export const anatomyCardRoute = (kind: "brain" | "nervous", name: string) => `${kind === "brain" ? SIDEBAR_ROUTES.brain : SIDEBAR_ROUTES.nervous}/${sidebarSlug(name)}`;
export const topicCardRoute = (section: string, title: string) => `${SIDEBAR_ROUTES.effects}/${sidebarSlug(section)}/${sidebarSlug(title)}`;

export const sidebarRouteTargetId = (route: string) => `sidebar-route-${route.slice(BASE.length).split("/").filter(Boolean).join("-") || "home"}`;

export function normalizeSidebarRoute(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || BASE;
  return path.startsWith(BASE) ? path : BASE;
}
