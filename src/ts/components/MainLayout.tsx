import React, { useState } from "react";
import styled from "styled-components";
import { ContentArea } from "@n-apt/components/Layout";
import { useLocation } from "react-router-dom";
import { useSidebarNavigationScroll } from "@n-apt/hooks/useSidebarNavigationScroll";

const NavigationContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: ${(props) => `${props.theme.layout.sidebarWidth}px`};
  min-width: ${(props) => `${props.theme.layout.sidebarMinWidth}px`};
  max-width: 500px;
  height: 100vh;
  background-color: ${(props) => props.theme.background};
  border-right: 1px solid ${(props) => props.theme.border};
  position: sticky;
  top: 0;
  overflow-y: auto;
  overflow-x: visible;
  box-sizing: border-box;
  resize: horizontal;
`;

const SidebarToggle = styled.button`
  position: sticky;
  top: ${(props) => props.theme.spacing.xxl};
  margin: ${(props) => props.theme.spacing.xxl};
  z-index: 1000;
  background-color: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.primary};
  border-radius: 6px;
  padding: ${(props) => `${props.theme.spacing.sm} ${props.theme.spacing.md}`};
  color: ${(props) => props.theme.primary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  width: max-content;
  display: inline-block;
`;

const CollapsedToggle = styled(SidebarToggle)`
  position: fixed;
  top: ${(props) => props.theme.spacing.xxl};
  left: ${(props) => props.theme.spacing.xxl};
  margin: 0;
`;

const NavigationTabs = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(props) => props.theme.spacing.sm};
  padding: 0 ${(props) => props.theme.spacing.xxl} ${(props) => props.theme.spacing.lg} ${(props) => props.theme.spacing.xxl};
`;

const NavigationTab = styled.button<{ $isActive: boolean }>`
  padding: ${(props) => `${props.theme.spacing.md} ${props.theme.spacing.lg}`};
  border: 1px solid ${(props) => (props.$isActive ? props.theme.borderHover : "transparent")};
  border-radius: 8px;
  background-color: ${(props) => (props.$isActive ? props.theme.surface : "transparent")};
  color: ${(props) => (props.$isActive ? props.theme.primary : props.theme.textMuted)};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
  user-select: none;
  width: 100%;
  justify-content: flex-start;

  &:hover {
    background-color: ${(props) => props.theme.surfaceHover};
    color: ${(props) => props.theme.textSecondary};
  }
`;

const SidebarContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(${(props) => props.theme.spacing.xxl} + env(safe-area-inset-bottom, 0px));
`;

interface MainLayoutProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  isSidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  sidebar,
  isSidebarOpen: controlledIsSidebarOpen,
  onSidebarOpenChange,
}) => {
  const [internalIsSidebarOpen, setInternalIsSidebarOpen] = useState(true);

  const isSidebarOpen = controlledIsSidebarOpen !== undefined ? controlledIsSidebarOpen : internalIsSidebarOpen;
  const setIsSidebarOpen = (open: boolean) => {
    if (onSidebarOpenChange) {
      onSidebarOpenChange(open);
    }
    setInternalIsSidebarOpen(open);
  };

  const location = useLocation();

  const path = location.pathname;
  const { navigationContainerRef, sidebarToggleRef, handleTabClick } =
    useSidebarNavigationScroll({ path });

  return (
    <>
      {!isSidebarOpen && (
        <CollapsedToggle onClick={() => setIsSidebarOpen(true)}>
          ▶ Sidebar
        </CollapsedToggle>
      )}
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100vh",
          overflow: "hidden",
        }}
      >
        {isSidebarOpen && (
          <NavigationContainer ref={navigationContainerRef}>
            <SidebarToggle ref={sidebarToggleRef} onClick={() => setIsSidebarOpen(false)}>
              ◀ Sidebar
            </SidebarToggle>
            <NavigationTabs>
              <NavigationTab
                $isActive={path === "/" || path === "/visualizer"}
                onClick={(event) => handleTabClick("/", event)}
                data-path="/"
              >
                See FFT of N-APT (LF/HF freqs)
              </NavigationTab>
              <NavigationTab
                $isActive={path === "/demodulate"}
                onClick={(event) => handleTabClick("/demodulate", event)}
                data-path="/demodulate"
              >
                Demod N-APT with ML
              </NavigationTab>
              <NavigationTab
                $isActive={path === "/draw-signal"}
                onClick={(event) => handleTabClick("/draw-signal", event)}
                data-path="/draw-signal"
              >
                Draw N-APT with Math
              </NavigationTab>
              <NavigationTab
                $isActive={path === "/3d-model"}
                onClick={(event) => handleTabClick("/3d-model", event)}
                data-path="/3d-model"
              >
                3D Human Model
              </NavigationTab>
              <NavigationTab
                $isActive={path === "/map-endpoints"}
                onClick={(event) => handleTabClick("/map-endpoints", event)}
                data-path="/map-endpoints"
              >
                Map Endpoints
              </NavigationTab>
            </NavigationTabs>
            <SidebarContent>{sidebar}</SidebarContent>
          </NavigationContainer>
        )}
        <ContentArea
          style={{ flex: 1, overflow: "hidden", position: "relative" }}
        >
          {children}
        </ContentArea>
      </div>
    </>
  );
};

export default MainLayout;
