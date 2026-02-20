import React from "react";
import { BrowserRouter as Router } from "react-router-dom";
import styled from "styled-components";
import { NavigationSidebar } from "@n-apt/components/NavigationSidebarNew";

// Styled Components
const AppContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100vh;
  background-color: #0a0a0a;
`;

// Inner App component that uses router hooks
export const AppContent: React.FC = () => {
  return (
    <AppContainer>
      <NavigationSidebar />
    </AppContainer>
  );
};

// Main App component with BrowserRouter wrapper
const App: React.FC = () => {
  return (
    <Router>
      <AppContent />
    </Router>
  );
};

export default App;
