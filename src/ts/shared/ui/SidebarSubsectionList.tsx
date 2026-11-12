import React from "react";
import styled from "styled-components";

const SubsectionListRoot = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-column: 1 / -1;
  gap: 8px;
  min-width: 0;
  margin: 14px 0 4px 10px;
  padding: 0 0 2px 14px;
  border-left: 2px solid ${(props) => props.theme.primaryAlpha};

  > button[aria-expanded] {
    min-width: 0;
    margin: 4px 0 2px;
    padding: 8px 10px;
    border-left: 3px solid ${(props) => props.theme.primaryAlpha};
    border-bottom: 2px solid ${(props) => props.theme.primaryAlpha};
    border-radius: 6px 6px 3px 3px;
    background: ${(props) => props.theme.primaryAnchor};
    transition: background-color 0.15s ease;
  }

  > button[aria-expanded]:hover {
    background: ${(props) => props.theme.activeBackground};
  }

  > button[aria-expanded]:first-child {
    margin-top: 2px;
  }

  > button[aria-expanded] span {
    font-size: 10px;
    letter-spacing: 0.9px;
  }

  > button[aria-expanded] svg {
    width: 14px;
    height: 14px;
  }

  > div {
    min-width: 0;
    margin: 2px 0 6px;
    padding-left: 8px;
  }
`;

export interface SidebarSubsectionListProps {
  "aria-label": string;
  children: React.ReactNode;
  className?: string;
}

export const SidebarSubsectionList: React.FC<SidebarSubsectionListProps> = ({
  "aria-label": ariaLabel,
  children,
  className,
}) => (
  <SubsectionListRoot
    role="group"
    aria-label={ariaLabel}
    data-sidebar-subsection-list
    className={className}
  >
    {children}
  </SubsectionListRoot>
);
