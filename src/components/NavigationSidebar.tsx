import React from "react";
import styled from "styled-components";
import {
  useLocation,
  useNavigate,
} from "react-router-dom";
import Sidebar from "@n-apt/components/sidebar/Sidebar";

// Types
type MainTab = "Spectrum" | "Model3D" | "HotspotEditor";

// Styled Components
const NavigationContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 360px;
  min-width: 360px;
  height: 100vh;
  background-color: #0d0d0d;
  border-right: 1px solid #1a1a1a;
  position: sticky;
  top: 0;
  overflow-y: auto;
  overflow-x: visible;
  box-sizing: border-box;
`;

const NavigationTabs = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 24px 16px 24px;
  border-bottom: 1px solid #1a1a1a;
`;

const NavigationTab = styled.button<{ $isActive: boolean }>`
  padding: 12px 16px;
  background-color: ${props => props.$isActive ? "#1a1a1a" : "transparent"};
  border: 1px solid ${props => props.$isActive ? "#2a2a2a" : "transparent"};
  border-radius: 8px;
  color: ${props => props.$isActive ? "#00d4ff" : "#666"};
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background-color: #1a1a1a;
    color: #888;
  }
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

const routeToMainTab = (path: string): MainTab => {
  switch (path) {
    case "/":
    case "/visualizer":
    case "/analysis":
    case "/draw-signal":
      return "Spectrum"
    case "/3d-model":
      return "Model3D"
    case "/hotspot-editor":
      return "HotspotEditor"
    default:
      return "Spectrum"
  }
};

interface NavigationSidebarProps {
  children: React.ReactNode;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  // Derive state from URL
  const mainTab = routeToMainTab(location.pathname);

  // Navigation handlers
  const handleMainTabChange = (tab: MainTab) => {
    switch (tab) {
      case "Spectrum":
        navigate("/");
        break;
      case "Model3D":
        navigate("/3d-model");
        break;
      case "HotspotEditor":
        navigate("/hotspot-editor");
        break;
    }
  };

  // If not Spectrum tab, just render children without sidebar
  if (mainTab !== "Spectrum") {
    return <ContentArea>{children}</ContentArea>;
  }

  // For Spectrum tab, render the full sidebar
  return (
    <>
      <NavigationContainer>
        <NavigationTabs>
          <NavigationTab
            $isActive={mainTab === "Spectrum"}
            onClick={() => handleMainTabChange("Spectrum")}
          >
            Spectrum Analyzer
          </NavigationTab>
          <NavigationTab
            $isActive={mainTab === "Model3D"}
            onClick={() => handleMainTabChange("Model3D")}
          >
            3D Human Model
          </NavigationTab>
          <NavigationTab
            $isActive={mainTab === "HotspotEditor"}
            onClick={() => handleMainTabChange("HotspotEditor")}
          >
            Hotspot Editor
          </NavigationTab>
        </NavigationTabs>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Sidebar />
        </div>
      </NavigationContainer>
      <ContentArea>{children}</ContentArea>
    </>
  );
};
