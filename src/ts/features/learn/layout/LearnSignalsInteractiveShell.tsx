import React from "react";
import styled from "styled-components";
import { AppBackButton } from "@n-apt/ui/AppBackButton";
import { AppThemePicker } from "@n-apt/ui/AppThemePicker";

const Shell = styled.div`
  display: flex;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
`;

const Sidebar = styled.aside`
  display: flex;
  width: 280px;
  min-width: 280px;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  padding: 24px 20px 20px;
  border-right: 1px solid ${(props) => props.theme.border};
  background: ${(props) => props.theme.background};
  z-index: 20;
`;

const SidebarHud = styled.div`
  flex-shrink: 0;
  margin-bottom: 20px;
`;

const SidebarTitle = styled.h1`
  margin: 0 0 24px;
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: ${(props) => props.theme.textPrimary};
`;

const SidebarNav = styled.nav`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
`;

const NavGroupTitle = styled.div`
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed ${(props) => props.theme.border};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${(props) => props.theme.textMuted};
`;

const NavButton = styled.button<{ $active?: boolean }>`
  display: block;
  width: 100%;
  padding: 12px 16px;
  border-radius: 8px;
  border: none;
  background: ${(props) =>
    props.$active ? props.theme.primary : "transparent"};
  color: ${(props) =>
    props.$active ? props.theme.background : props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 14px;
  font-weight: ${(props) => (props.$active ? 600 : 500)};
  text-align: left;
  cursor: pointer;
  transition:
    background 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: ${(props) =>
      props.$active ? props.theme.primary : props.theme.surfaceHover};
    color: ${(props) =>
      props.$active ? props.theme.background : props.theme.textPrimary};
  }
`;

const SidebarFooter = styled.div`
  flex-shrink: 0;
  padding-top: 16px;
  margin-top: 8px;
  border-top: 1px solid ${(props) => props.theme.border};
`;

const Main = styled.div`
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

export interface LearnSignalsInteractiveShellProps {
  title?: string;
  nav: React.ReactNode;
  children: React.ReactNode;
}

export const LearnSignalsInteractiveShell: React.FC<
  LearnSignalsInteractiveShellProps
> = ({ title = "Signals", nav, children }) => (
  <Shell>
    <Sidebar aria-label="Signal processing navigation">
      <SidebarHud>
        <AppThemePicker />
      </SidebarHud>
      <SidebarTitle>{title}</SidebarTitle>
      <SidebarNav>{nav}</SidebarNav>
      <SidebarFooter>
        <AppBackButton />
      </SidebarFooter>
    </Sidebar>
    <Main>{children}</Main>
  </Shell>
);

export const LearnSignalsNavButton = NavButton;

export const LearnSignalsNavGroupTitle = NavGroupTitle;

export default LearnSignalsInteractiveShell;
