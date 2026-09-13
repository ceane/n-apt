import React from "react";
import styled from "styled-components";
import { SidebarToggleButton } from "@n-apt/spectrum/sidebar/SidebarToggle";
import { Logo } from "@n-apt/ui/Logo";

const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${(props) => props.theme.spacing.md};
  padding: ${(props) => props.theme.spacing.xxl};
`;

const RightControls = styled.div`
  display: flex;
  align-items: center;
  gap: ${(props) => props.theme.spacing.md};
`;

interface NAPTSidebarHeaderProps {
  onToggleClick: () => void;
  toggleRef?: React.Ref<HTMLButtonElement>;
}

export const NAPTSidebarHeader: React.FC<NAPTSidebarHeaderProps> = ({
  onToggleClick,
  toggleRef,
}) => {
  return (
    <HeaderContainer>
      <SidebarToggleButton ref={toggleRef} onClick={onToggleClick} />
      <RightControls>
        <Logo size={48} alt="N-APT Logo" />
      </RightControls>
    </HeaderContainer>
  );
};
