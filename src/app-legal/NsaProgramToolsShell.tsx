import React from "react";
import styled from "styled-components";
import { Link, useLocation } from "react-router";
import "./nsa-program-tools.css";

const Shell = styled.div`
  display: flex;
  min-height: 100vh;
  background: #081120;
  color: #e5eefb;
`;

const Sidebar = styled.aside`
  width: min(28vw, 360px);
  min-width: 240px;
  padding: 24px;
  background: rgba(8, 17, 32, 0.92);
  border-right: 1px solid rgba(148, 163, 184, 0.18);
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
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 14px;
  padding: 12px 14px;
  color: #cbd5e1;
  text-decoration: none;
  &.active {
    border-color: rgba(96, 165, 250, 0.56);
    background: rgba(30, 41, 59, 0.96);
    color: #eff6ff;
  }
`;

export function NsaProgramToolsShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <Shell>
      <Sidebar aria-label="Program tools">
        <p className="eyebrow">Dashboard</p>
        <h1 className="sidebar-title">Program Tools</h1>
        <p className="sidebar-copy">Questionnaire and X archive formatting tools.</p>
        <SidebarLink className={location.pathname === "/x-archive-formatter" ? "active" : ""} to="/x-archive-formatter">
          X Archive Formatter
        </SidebarLink>
        <SidebarLink className={location.pathname === "/questionnaire" ? "active" : ""} to="/questionnaire">
          Questionnaire
        </SidebarLink>
      </Sidebar>
      <Content>{children}</Content>
    </Shell>
  );
}
