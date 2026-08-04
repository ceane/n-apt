import React from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { Logo } from "@n-apt/components/ui/Logo";
import { AppBackButton } from "@n-apt/components/ui/AppBackButton";
import { AppThemePicker } from "@n-apt/components/ui/AppThemePicker";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";

export const PublicPage = styled.main`
  min-height: 100dvh;
  padding: 48px 20px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
  box-sizing: border-box;
`;

export const PublicShell = styled.div`
  width: min(100%, 920px);
  margin: 0 auto;
  padding: 28px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 20px;
  background: ${(props) => props.theme.surface ?? "rgba(16,16,16,0.9)"};
  box-sizing: border-box;
`;

export const PublicMainGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(0, 3fr);
  gap: 40px;
  align-items: start;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    min-height: auto;
  }
`;

export const PublicSidebar = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 28px;
  align-self: start;
  max-height: calc(100vh - 56px);
  min-height: 0;

  @media (max-width: 900px) {
    position: static;
    max-height: none;
  }
`;

export const PublicSidebarScroll = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding-right: 4px;
  min-height: 0;
  flex: 1;
`;

export const PublicLogoLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-bottom: 8px;
`;

export const PublicSectionLink = styled.a`
  display: block;
  margin: 0 0 12px;
  color: ${(props) => props.theme.textSecondary};
  text-decoration: none;
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 14px;
  line-height: 1.4;

  &:hover {
    color: ${(props) => props.theme.primary};
    text-decoration: underline;
  }
`;

export const PublicNavButton = styled.button<{ $active?: boolean }>`
  display: block;
  width: 100%;
  margin: 0 0 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid
    ${(props) =>
      props.$active ? props.theme.primary : props.theme.border};
  background: ${(props) =>
    props.$active ? props.theme.primary : "transparent"};
  color: ${(props) =>
    props.$active ? props.theme.background : props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 13px;
  font-weight: ${(props) => (props.$active ? 600 : 500)};
  text-align: left;
  cursor: pointer;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease;

  &:hover {
    border-color: ${(props) => props.theme.borderHover};
    background: ${(props) =>
      props.$active ? props.theme.primary : props.theme.surfaceHover};
    color: ${(props) =>
      props.$active ? props.theme.background : props.theme.textPrimary};
  }
`;

export const PublicSidebarTitle = styled.h1`
  margin: 0 0 4px;
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: ${(props) => props.theme.textPrimary};
`;

export const PublicMainColumn = styled.div`
  position: relative;
  min-width: 0;
  min-height: min(70vh, 720px);
`;

export interface AppPublicSidebarProps {
  "aria-label": string;
  title?: string;
  children: React.ReactNode;
}

export const AppPublicSidebar: React.FC<AppPublicSidebarProps> = ({
  "aria-label": ariaLabel,
  title,
  children,
}) => {
  const { isAuthenticated } = useAuthentication();
  const logoHref = isAuthenticated ? "/get-started" : "/auth";

  return (
    <PublicSidebar aria-label={ariaLabel}>
      <PublicSidebarScroll>
        <PublicLogoLink to={logoHref} aria-label="N-APT home">
          <Logo size={72} alt="N-APT" />
        </PublicLogoLink>
        {title ? <PublicSidebarTitle>{title}</PublicSidebarTitle> : null}
        <AppThemePicker />
        {children}
      </PublicSidebarScroll>
      <AppBackButton />
    </PublicSidebar>
  );
};
