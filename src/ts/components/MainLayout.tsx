import React, { useState } from "react";
import { memo } from "react";
import styled from "styled-components";
import { NAPTSidebarHeader } from "@n-apt/components/sidebar/NAPTSidebarHeader";
import { SidebarRoutesNav } from "@n-apt/components/sidebar/SidebarRoutesNav";
import { CollapsedToggleButton } from "@n-apt/components/sidebar/SidebarToggle";
import { ContentArea } from "@n-apt/components/Layout";
import { useLocation } from "react-router";
import { useSidebarNavigationScroll } from "@n-apt/hooks/useSidebarNavigationScroll";

const NavigationContainer = memo(styled.nav`
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
`);

const SidebarContent = memo(styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(
    ${(props) => props.theme.spacing.xxl} + env(safe-area-inset-bottom, 0px)
  );
`);

const MainLayoutContainer = memo(styled.div`
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  transition: all 0.3s ease;
`);

const StyledContentArea = memo(styled(ContentArea)`
  position: relative;
`);

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

  const isSidebarOpen =
    controlledIsSidebarOpen !== undefined
      ? controlledIsSidebarOpen
      : internalIsSidebarOpen;
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
        <CollapsedToggleButton onClick={() => setIsSidebarOpen(true)} />
      )}
      <MainLayoutContainer>
        {isSidebarOpen && (
          <NavigationContainer ref={navigationContainerRef}>
            <NAPTSidebarHeader
              onToggleClick={() => setIsSidebarOpen(false)}
              toggleRef={sidebarToggleRef}
            />
            <SidebarRoutesNav pathname={path} onRouteClick={handleTabClick} />
            <SidebarContent>{sidebar}</SidebarContent>
          </NavigationContainer>
        )}
        <StyledContentArea>{children}</StyledContentArea>
      </MainLayoutContainer>
    </>
  );
};

export default MainLayout;
