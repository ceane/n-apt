import React from "react";
import styled from "styled-components";
import { SidebarToggleButton } from "./SidebarToggle";

const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  gap: ${(props) => props.theme.spacing.md};
  padding: ${(props) => props.theme.spacing.xxl};
`;

const NAPTTitle = styled.h1`
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  font-family: ${(props) => props.theme.typography.mono};
`;

interface NAPTSidebarHeaderProps {
  onToggleClick: () => void;
  toggleRef?: React.Ref<HTMLButtonElement>;
}

export const NAPTSidebarHeader: React.FC<NAPTSidebarHeaderProps> = ({ onToggleClick, toggleRef }) => {
  return (
    <HeaderContainer>
      <SidebarToggleButton ref={toggleRef} onClick={onToggleClick} />
      <NAPTTitle>N-APT</NAPTTitle>
    </HeaderContainer>
  );
};
