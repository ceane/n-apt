import React, { useCallback, useState } from "react";
import styled from "styled-components";
import {
  readSidebarRoutesExpanded,
  writeSidebarRoutesExpanded,
} from "@n-apt/utils/sidebarRoutesExpanded";
import {
  getActiveSidebarNavRoute,
  SIDEBAR_NAV_ROUTES,
} from "@n-apt/components/sidebar/sidebarNavRoutes";

const ROUTE_TREE_BRANCH_WIDTH = "12px";

const RoutesNav = styled.div`
  display: flex;
  flex-direction: column;
  gap: calc(${(props) => props.theme.spacing.xs} * 1.25);
  padding: 0 calc(${(props) => props.theme.spacing.lg} * 1.25)
    calc(${(props) => props.theme.spacing.sm} * 1.25)
    calc(${(props) => props.theme.spacing.lg} * 1.25);
`;

const RoutesTreeHeader = styled.button`
  display: flex;
  align-items: center;
  gap: calc(${(props) => props.theme.spacing.xs} * 1.25);
  width: 100%;
  margin: 0 0 calc(${(props) => props.theme.spacing.xs} * 1.25);
  padding: calc(${(props) => props.theme.spacing.xs} * 1.25) 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: ${(props) => props.theme.metadataLabel || props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;

  &:hover {
    color: ${(props) => props.theme.textSecondary};
  }
`;

const RoutesTreeChevron = styled.span<{ $expanded: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  font-size: 12px;
  line-height: 1;
  transform: rotate(${(props) => (props.$expanded ? "90deg" : "0deg")});
  transition: transform 0.15s ease;
`;

const RoutesTreeBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: calc(${(props) => props.theme.spacing.xs} * 1.25);
  margin-left: 6px;
  padding-left: calc(${(props) => props.theme.spacing.md} * 1.25);
  border-left: 1px solid ${(props) => props.theme.border};
`;

const RouteLinkButton = styled.button<{ $isActive: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: calc(${(props) => props.theme.spacing.xs} * 1.25)
    calc(${(props) => props.theme.spacing.sm} * 1.25);
  border: 1px solid
    ${(props) => (props.$isActive ? props.theme.borderHover : "transparent")};
  border-radius: 6px;
  background-color: ${(props) =>
    props.$isActive ? props.theme.surface : "transparent"};
  color: ${(props) =>
    props.$isActive ? props.theme.primary : props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: ${(props) => (props.$isActive ? 500 : 400)};
  line-height: 1.35;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
  user-select: none;
  width: 100%;

  svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    color: ${(props) => (props.$isActive ? props.theme.primary : "inherit")};
    opacity: ${(props) => (props.$isActive ? 0.9 : 0.6)};
  }

  ${(props) =>
    props.$isActive
      ? `
    &::before {
      content: "";
      position: absolute;
      left: calc(-1 * (${ROUTE_TREE_BRANCH_WIDTH} + 1px));
      top: 50%;
      width: ${ROUTE_TREE_BRANCH_WIDTH};
      height: 1px;
      background-color: ${props.theme.border};
      pointer-events: none;
    }
  `
      : ""}

  &:hover {
    background-color: ${(props) => props.theme.surfaceHover};
    color: ${(props) => props.theme.textSecondary};
  }
`;

export interface SidebarRoutesNavProps {
  pathname: string;
  onRouteClick: (
    tabPath: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
}

export const SidebarRoutesNav: React.FC<SidebarRoutesNavProps> = ({
  pathname,
  onRouteClick,
}) => {
  const [routesExpanded, setRoutesExpanded] = useState(() =>
    readSidebarRoutesExpanded(),
  );

  const toggleRoutesExpanded = useCallback(() => {
    setRoutesExpanded((previous) => {
      const next = !previous;
      writeSidebarRoutesExpanded(next);
      return next;
    });
  }, []);

  const activeRoute = getActiveSidebarNavRoute(pathname);
  const visibleRoutes = routesExpanded
    ? SIDEBAR_NAV_ROUTES
    : activeRoute
      ? [activeRoute]
      : SIDEBAR_NAV_ROUTES;

  return (
    <RoutesNav data-sidebar-section="routes">
      <RoutesTreeHeader
        type="button"
        onClick={toggleRoutesExpanded}
        aria-expanded={routesExpanded}
        aria-controls="sidebar-route-links"
      >
        <RoutesTreeChevron $expanded={routesExpanded} aria-hidden>
          ›
        </RoutesTreeChevron>
        Routes
      </RoutesTreeHeader>
      <RoutesTreeBody id="sidebar-route-links" role="group" aria-label="Routes">
        {visibleRoutes.map((route) => {
          const isActive = route.isActive(pathname);
          const RouteIcon = route.icon;
          return (
            <RouteLinkButton
              key={route.dataPath}
              $isActive={isActive}
              onClick={(event) => onRouteClick(route.path, event)}
              data-path={route.dataPath}
            >
              {isActive && RouteIcon ? (
                <RouteIcon size={13} strokeWidth={1.75} aria-hidden="true" />
              ) : null}
              {route.label}
            </RouteLinkButton>
          );
        })}
      </RoutesTreeBody>
    </RoutesNav>
  );
};
