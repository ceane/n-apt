import React from "react";
import styled from "styled-components";
import { SidebarToggleButton } from "./SidebarToggle";
import nAptLogo from "@n-apt/public/images/icon.svg";

const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${(props) => props.theme.spacing.md};
  padding: ${(props) => props.theme.spacing.xxl};
`;

const NAPTIcon = styled.img`
  width: 48px;
  height: 48px;
  mix-blend-mode: multiply;

  @media (prefers-color-scheme: dark) {
    filter: invert(1);
    mix-blend-mode: screen;
  }
`;

interface NAPTSidebarHeaderProps {
  onToggleClick: () => void;
  toggleRef?: React.Ref<HTMLButtonElement>;
}

export const NAPTSidebarHeader: React.FC<NAPTSidebarHeaderProps> = ({ onToggleClick, toggleRef }) => {
  return (
    <HeaderContainer>
      <SidebarToggleButton ref={toggleRef} onClick={onToggleClick} />
      <NAPTIcon src={nAptLogo} alt="N-APT Logo" />
    </HeaderContainer>
  );
};
