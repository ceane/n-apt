import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
} from "react-router-dom"
import styled from "styled-components"
import { NavigationSidebar } from "@n-apt/components/NavigationSidebarNew"
import { Model3DRoute } from "@n-apt/components/Model3DRoute"
import { HotspotEditorRoute } from "@n-apt/components/HotspotEditorRoute"

// Styled Components
const AppContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100vh;
  background-color: #0a0a0a;
`

// Inner App component that uses router hooks
export const AppContent: React.FC = () => {
  return (
    <AppContainer>
      <NavigationSidebar>
        <Routes>
          <Route path="/3d-model" element={<Model3DRoute />} />
          <Route path="/hotspot-editor" element={<HotspotEditorRoute />} />
        </Routes>
      </NavigationSidebar>
    </AppContainer>
  )
}

// Main App component with BrowserRouter wrapper
const App: React.FC = () => {
  return (
    <Router>
      <AppContent />
    </Router>
  )
}

export default App
