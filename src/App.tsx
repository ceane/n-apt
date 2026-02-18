import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom"
import styled from "styled-components"
import { NavigationSidebar } from "@n-apt/components/NavigationSidebarNew"
import { SpectrumRoute } from "@n-apt/components/SpectrumRoute"
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
      <NavigationSidebar />
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
