import React, { useState } from "react";
import styled from "styled-components";
import { ContentArea } from "@n-apt/components/Layout";
import { useLocation, useNavigate } from "react-router-dom";

const NavigationContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 360px;
  min-width: 280px;
  max-width: 500px;
  height: 100vh;
  background-color: #0d0d0d;
  border-right: 1px solid #1a1a1a;
  position: sticky;
  top: 0;
  overflow-y: auto;
  overflow-x: visible;
  box-sizing: border-box;
  resize: horizontal;
`;

const SidebarToggle = styled.button`
  position: sticky;
  top: 24px;
  margin: 24px;
  z-index: 1000;
  background-color: #1a1a1a;
  border: 1px solid ${(props) => props.theme.primary};
  border-radius: 6px;
  padding: 8px 12px;
  color: ${(props) => props.theme.primary};
  font-family: "JetBrains Mono", monospace;
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
  top: 24px;
  left: 24px;
  margin: 0;
`;

const NavigationTabs = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 24px 16px 24px;
`;

const NavigationTab = styled.button<{ $isActive: boolean }>`
  padding: 12px 16px;
  border: 1px solid ${(props) => (props.$isActive ? "#2a2a2a" : "transparent")};
  border-radius: 8px;
  background-color: ${(props) => (props.$isActive ? "#1a1a1a" : "transparent")};
  color: ${(props) => (props.$isActive ? props.theme.primary : "#666")};
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
  user-select: none;
  width: 100%;
  justify-content: flex-start;

  &:hover {
    background-color: #1a1a1a;
    color: #888;
  }
`;

const SidebarContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
`;

interface MainLayoutProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  sidebar,
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  const path = location.pathname;

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
          <NavigationContainer>
            <SidebarToggle onClick={() => setIsSidebarOpen(false)}>
              ◀ Sidebar
            </SidebarToggle>
            <NavigationTabs>
              <NavigationTab
                $isActive={path === "/" || path === "/visualizer"}
                onClick={() => navigate("/")}
              >
                See FFT of N-APT (LF/HF freqs)
              </NavigationTab>
              <NavigationTab
                $isActive={path === "/analysis"}
                onClick={() => navigate("/analysis")}
              >
                Decode N-APT with ML
              </NavigationTab>
              <NavigationTab
                $isActive={path === "/draw-signal"}
                onClick={() => navigate("/draw-signal")}
              >
                Draw N-APT with Math/ML
              </NavigationTab>
              <NavigationTab
                $isActive={path === "/3d-model"}
                onClick={() => navigate("/3d-model")}
              >
                3D Human Model
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
