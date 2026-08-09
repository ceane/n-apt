import React from "react";
import styled from "styled-components";

const SettingsSidebarRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: calc(${(props) => props.theme.spacing.xs} * 1.25);
  padding: 0 calc(${(props) => props.theme.spacing.lg} * 1.25)
    calc(${(props) => props.theme.spacing.sm} * 1.25)
    calc(${(props) => props.theme.spacing.lg} * 1.25);
`;

const SectionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: calc(${(props) => props.theme.spacing.xs} * 1.25);
  margin-left: 6px;
  padding-left: calc(${(props) => props.theme.spacing.md} * 1.25 * 2);
  border-left: 1px solid ${(props) => props.theme.border};
`;

const SectionLinkButton = styled.button<{ $isActive: boolean }>`
  position: relative;
  padding: calc(${(props) => props.theme.spacing.xs} * 1.25)
    calc(${(props) => props.theme.spacing.sm} * 1.25);
  border: 1px solid
    ${(props) => (props.$isActive ? props.theme.borderHover : "transparent")};
  border-radius: 6px;
  background-color: ${(props) =>
    props.$isActive ? props.theme.surface : "transparent"};
  color: ${(props) =>
    props.$isActive ? props.theme.primary : props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: ${(props) => (props.$isActive ? 500 : 400)};
  line-height: 1.35;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
  user-select: none;
  width: 100%;

  &:hover {
    background-color: ${(props) => props.theme.surfaceHover};
    color: ${(props) => props.theme.textSecondary};
  }
`;

export interface SettingsSidebarSection {
  id: string;
  label: string;
}

export interface SettingsSidebarProps {
  sections: SettingsSidebarSection[];
  activeSectionId: string | null;
  onSectionClick: (sectionId: string) => void;
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  sections,
  activeSectionId,
  onSectionClick,
}) => {
  return (
    <SettingsSidebarRoot data-sidebar-section="settings">
      <SectionList role="group" aria-label="Settings sections">
        {sections.map((section) => (
          <SectionLinkButton
            key={section.id}
            type="button"
            $isActive={activeSectionId === section.id}
            onClick={() => onSectionClick(section.id)}
            data-section-id={section.id}
          >
            {section.label}
          </SectionLinkButton>
        ))}
      </SectionList>
    </SettingsSidebarRoot>
  );
};

export default SettingsSidebar;
