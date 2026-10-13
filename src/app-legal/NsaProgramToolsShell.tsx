import React from "react";
import styled from "styled-components";
import { Link, useLocation } from "react-router";
import "./nsa-program-tools.css";

const Shell = styled.div`
  display: flex;
  min-height: 100vh;
  background: #ffffff;
  color: #374151;

  @media (max-width: 640px) {
    flex-direction: column;
  }
`;

const Sidebar = styled.aside`
  width: min(28vw, 360px);
  min-width: 240px;
  padding: 24px;
  background: #f9fafb;
  border-right: 1px solid #e5e7eb;
  transition: width 180ms ease, min-width 180ms ease, padding 180ms ease;
  &.collapsed {
    width: 76px;
    min-width: 76px;
    padding: 20px 10px;
  }

  @media (max-width: 640px) {
    width: 100%;
    min-width: 0;
    padding: 16px;
    border-right: 0;
    border-bottom: 1px solid #e5e7eb;

    &.collapsed {
      width: 100%;
      min-width: 0;
      padding: 12px 16px;
    }
  }
`;

const SidebarHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;

  p {
    margin-bottom: 8px;
  }

  h1 {
    margin: 0;
  }

  .collapsed & {
    justify-content: center;
  }
`;

const SidebarToggle = styled.button`
  flex: 0 0 36px;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid #d1d5db;
  border-radius: 9px;
  background: #ffffff;
  color: #374151;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;

  &:hover {
    background: #f3f4f6;
  }
`;

const Content = styled.main`
  flex: 1;
  min-width: 0;
  padding: 24px;
  overflow: auto;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

const SidebarLink = styled(Link)`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 12px 14px;
  color: #374151;
  text-decoration: none;
  .nav-icon {
    flex: 0 0 24px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    background: #f3f4f6;
    color: #4b5563;
    font-size: 0.8rem;
    font-weight: 700;
  }
  &.active {
    border-color: #60a5fa;
    background: #eff6ff;
    color: #1f2937;
  }
  &.active .nav-icon {
    background: #dbeafe;
    color: #1d4ed8;
  }
  .collapsed & {
    justify-content: center;
    padding: 12px 8px;
  }
`;

export function NsaProgramToolsShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  return (
    <Shell className="program-tools-shell">
      <Sidebar className={sidebarCollapsed ? "collapsed" : undefined} aria-label="Program tools">
        <SidebarHeader>
          {!sidebarCollapsed && (
            <div>
              <p className="eyebrow">Dashboard</p>
              <h1 className="sidebar-title">NSA Program Tools</h1>
            </div>
          )}
          <SidebarToggle
            type="button"
            aria-label={sidebarCollapsed ? "Expand dashboard sidebar" : "Collapse dashboard sidebar"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="program-tools-navigation"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
          </SidebarToggle>
        </SidebarHeader>
        {!sidebarCollapsed && <p className="sidebar-copy">Questionnaire and X archive formatting tools.</p>}
        <nav id="program-tools-navigation" aria-label="Program tools">
          <SidebarLink
            aria-label="X Archive Formatter"
            title={sidebarCollapsed ? "X Archive Formatter" : undefined}
            className={location.pathname === "/x-archive-formatter" ? "active" : ""}
            to="/x-archive-formatter"
          >
            <span className="nav-icon" aria-hidden="true">X</span>
            {!sidebarCollapsed && <span>X Archive Formatter</span>}
          </SidebarLink>
          <SidebarLink
            aria-label="Questionnaire"
            title={sidebarCollapsed ? "Questionnaire" : undefined}
            className={location.pathname === "/questionnaire" ? "active" : ""}
            to="/questionnaire"
          >
            <span className="nav-icon" aria-hidden="true">Q</span>
            {!sidebarCollapsed && <span>Questionnaire</span>}
          </SidebarLink>
        </nav>
      </Sidebar>
      <Content className="program-tools-content">{children}</Content>
    </Shell>
  );
}
