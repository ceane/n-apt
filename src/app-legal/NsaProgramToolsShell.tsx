import React from "react";
import styled from "styled-components";
import { Link, useLocation } from "react-router";
import "./nsa-program-tools.css";

const Shell = styled.div`
  display: flex;
  min-height: 100vh;
  background: #ffffff;
  color: #374151;
`;

const Sidebar = styled.aside`
  width: min(28vw, 360px);
  min-width: 240px;
  padding: 24px;
  background: #f9fafb;
  border-right: 1px solid #e5e7eb;
`;

const Content = styled.main`
  flex: 1;
  min-width: 0;
  padding: 24px;
  overflow: auto;
`;

const SidebarLink = styled(Link)`
  display: block;
  margin-top: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 12px 14px;
  color: #374151;
  text-decoration: none;
  &.active {
    border-color: #60a5fa;
    background: #eff6ff;
    color: #1f2937;
  }
`;

export function NsaProgramToolsShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <Shell className="program-tools-shell">
      <Sidebar aria-label="Program tools">
        <p className="eyebrow">Dashboard</p>
        <h1 className="sidebar-title">NSA Program Tools</h1>
        <p className="sidebar-copy">Questionnaire and X archive formatting tools.</p>
        <SidebarLink className={location.pathname === "/x-archive-formatter" ? "active" : ""} to="/x-archive-formatter">
          X Archive Formatter
        </SidebarLink>
        <SidebarLink className={location.pathname === "/questionnaire" ? "active" : ""} to="/questionnaire">
          Questionnaire
        </SidebarLink>
      </Sidebar>
      <Content className="program-tools-content">{children}</Content>
    </Shell>
  );
}
