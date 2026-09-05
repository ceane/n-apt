import React from "react";
import { Link } from "react-router";
import styled from "styled-components";
import { DoorOpen } from "lucide-react";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";

const SidebarBackLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: ${(props) => props.theme.primary};
  text-decoration: none;
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 13px;

  &:hover {
    text-decoration: underline;
  }
`;

const BarBackLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.border};
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textSecondary};
  text-decoration: none;
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    background 0.18s ease;

  &:hover {
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
    background: ${(props) => props.theme.primaryAnchor};
  }
`;

export interface AppBackButtonProps {
  variant?: "sidebar" | "bar";
  className?: string;
}

export const AppBackButton: React.FC<AppBackButtonProps> = ({
  variant = "sidebar",
  className,
}) => {
  const { isAuthenticated } = useAuthentication();
  const to = isAuthenticated ? "/get-started" : "/auth";
  const label = isAuthenticated ? "Back to Start Page" : "Back to Sign In";
  const LinkComponent = variant === "bar" ? BarBackLink : SidebarBackLink;

  return (
    <LinkComponent to={to} className={className}>
      <DoorOpen size={16} strokeWidth={2} aria-hidden="true" />
      {label}
    </LinkComponent>
  );
};

export default AppBackButton;
