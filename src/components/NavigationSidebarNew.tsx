import React, { useState } from "react";
import styled from "styled-components";
import { useLocation, useNavigate, Routes, Route } from "react-router-dom";
import { SpectrumRoute } from "@n-apt/components/SpectrumRoute";
import { Model3DProvider } from "@n-apt/hooks/useModel3D";
import { HotspotEditorProvider } from "@n-apt/hooks/useHotspotEditor";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { SidebarForRoute } from "@n-apt/components/sidebar/SidebarForRoute";
import { Model3DRoute } from "@n-apt/components/Model3DRoute";
import { HotspotEditorRoute } from "@n-apt/components/HotspotEditorRoute";

// Types
type MainTab = "Spectrum" | "Model3D" | "HotspotEditor";
type SpectrumTab = "visualizer" | "analysis" | "draw";

// Styled Components
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
  border: 1px solid #00d4ff;
  border-radius: 6px;
  padding: 8px 12px;
  color: #00d4ff;
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

const NavigationTab = styled.button.attrs<{ $isActive: boolean }>(props => ({
  style: {
    backgroundColor: props.$isActive ? "#1a1a1a" : "transparent",
    borderColor: props.$isActive ? "#2a2a2a" : "transparent",
    color: props.$isActive ? "#00d4ff" : "#666",
  },
}))`
  padding: 12px 16px;
  border: 1px solid;
  border-radius: 8px;
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
      return "Spectrum";
    case "/3d-model":
      return "Model3D";
    case "/hotspot-editor":
      return "HotspotEditor";
    default:
      return "Spectrum";
  }
};

const routeToSpectrumTab = (path: string): SpectrumTab => {
  switch (path) {
    case "/analysis":
      return "analysis";
    case "/draw-signal":
      return "draw";
    case "/":
    case "/visualizer":
    default:
      return "visualizer";
  }
};

export const NavigationSidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  // Derive state from URL
  const mainTab = routeToMainTab(location.pathname);
  const activeSpectrumTab = routeToSpectrumTab(location.pathname);

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

  const handleSpectrumTabChange = (tab: SpectrumTab | string) => {
    const spectrumTab = tab as SpectrumTab;
    switch (spectrumTab) {
      case "visualizer":
        navigate("/");
        break;
      case "analysis":
        navigate("/analysis");
        break;
      case "draw":
        navigate("/draw-signal");
        break;
    }
  };

  const renderSidebarShell = (sidebar?: React.ReactNode) => {
    // If no sidebar provided, create one based on the current route
    const sidebarContent = sidebar || (
      <SidebarForRoute
        activeTab={
          mainTab === "Model3D"
            ? "model3d"
            : mainTab === "HotspotEditor"
              ? "hotspoteditor"
              : mainTab.toLowerCase()
        }
      />
    );

    // Only clone props if we have the original SpectrumRoute sidebar
    const finalSidebar = sidebar
      ? React.cloneElement(sidebar as React.ReactElement<any>, {
        activeTab: mainTab === "Model3D" ? "model3d" : activeSpectrumTab,
      })
      : sidebarContent;

    return (
      <NavigationContainer>
        <SidebarToggle onClick={() => setIsSidebarOpen(false)}>◀ Sidebar</SidebarToggle>
        <NavigationTabs>
          <NavigationTab
            $isActive={mainTab === "Spectrum" && activeSpectrumTab === "visualizer"}
            onClick={() => handleSpectrumTabChange("visualizer")}
          >
            See FFT of N-APT (LF/HF freqs)
          </NavigationTab>
          <NavigationTab
            $isActive={mainTab === "Spectrum" && activeSpectrumTab === "analysis"}
            onClick={() => handleSpectrumTabChange("analysis")}
          >
            Decode N-APT with ML
          </NavigationTab>
          <NavigationTab
            $isActive={mainTab === "Spectrum" && activeSpectrumTab === "draw"}
            onClick={() => handleSpectrumTabChange("draw")}
          >
            Draw N-APT with Math/ML
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
        <SidebarContent>{finalSidebar}</SidebarContent>
      </NavigationContainer>
    );
  };

  return (
    <AuthProvider>
      <Model3DProvider>
        <HotspotEditorProvider>
          <>
            {!isSidebarOpen && (
              <CollapsedToggle onClick={() => setIsSidebarOpen(true)}>▶ Sidebar</CollapsedToggle>
            )}
            <ContentArea>
              <Routes>
                {/* Spectrum routes */}
                <Route
                  element={
                    <SpectrumRoute
                      activeTab={activeSpectrumTab}
                      onTabChange={handleSpectrumTabChange}
                      isSidebarOpen={isSidebarOpen}
                      onAuthChange={undefined}
                      sidebarWrapper={isSidebarOpen ? renderSidebarShell : undefined}
                    />
                  }
                >
                  <Route index element={<SpectrumRoute
                    activeTab={activeSpectrumTab}
                    onTabChange={handleSpectrumTabChange}
                    isSidebarOpen={isSidebarOpen}
                    onAuthChange={undefined}
                    sidebarWrapper={isSidebarOpen ? renderSidebarShell : undefined}
                  />} />
                  <Route path="/visualizer" element={<SpectrumRoute
                    activeTab={activeSpectrumTab}
                    onTabChange={handleSpectrumTabChange}
                    isSidebarOpen={isSidebarOpen}
                    onAuthChange={undefined}
                    sidebarWrapper={isSidebarOpen ? renderSidebarShell : undefined}
                  />} />
                  <Route path="/analysis" element={<SpectrumRoute
                    activeTab={activeSpectrumTab}
                    onTabChange={handleSpectrumTabChange}
                    isSidebarOpen={isSidebarOpen}
                    onAuthChange={undefined}
                    sidebarWrapper={isSidebarOpen ? renderSidebarShell : undefined}
                  />} />
                  <Route path="/draw-signal" element={<SpectrumRoute
                    activeTab={activeSpectrumTab}
                    onTabChange={handleSpectrumTabChange}
                    isSidebarOpen={isSidebarOpen}
                    onAuthChange={undefined}
                    sidebarWrapper={isSidebarOpen ? renderSidebarShell : undefined}
                  />} />
                </Route>

                {/* 3D Model route */}
                <Route
                  path="/3d-model"
                  element={
                    <>
                      {isSidebarOpen && renderSidebarShell()}
                      <Model3DRoute />
                    </>
                  }
                />

                {/* Hotspot Editor route */}
                <Route
                  path="/hotspot-editor"
                  element={
                    <>
                      {isSidebarOpen && renderSidebarShell()}
                      <HotspotEditorRoute />
                    </>
                  }
                />
              </Routes>
            </ContentArea>
          </>
        </HotspotEditorProvider>
      </Model3DProvider>
    </AuthProvider>
  );
};
