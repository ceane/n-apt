import React from "react";
import styled from "styled-components";

export const CollapsibleTitleContainer = styled.button`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  grid-column: 1 / -1;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 1.5rem 0 0.5rem 0;
  cursor: pointer;
  text-align: left;
`;

const fallbackMono = "SFMono-Regular, Consolas, \"Liberation Mono\", Menlo, monospace";

export const CollapsibleTitleContent = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const CollapsibleTitleIcon = styled.span`
  display: flex;
  align-items: center;
  font-size: 14px;
  color: ${(props) => props.theme.metadataLabel || "#555"};
  
  svg {
    color: ${(props) => props.theme.metadataLabel || "#555"};
  }
`;

export const CollapsibleTitleLabel = styled.span`
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel || "#555"};
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  font-family: ${(props) =>
    props.theme.typography?.mono || props.theme.typography?.sans || fallbackMono};
`;

export const SidebarSectionTitleContainer = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel || "#555"};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1rem;
  margin-bottom: 0;
  font-weight: 600;
  font-family: ${(props) =>
    props.theme.typography?.mono || props.theme.typography?.sans || fallbackMono};
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  
  svg {
    color: ${(props) => props.theme.metadataLabel || "#555"};
  }
`;

export interface SidebarSectionTitleProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
}

export const SidebarSectionTitle: React.FC<SidebarSectionTitleProps> = ({
  icon,
  title,
}) => (
  <SidebarSectionTitleContainer>
    {icon && <CollapsibleTitleIcon>{icon}</CollapsibleTitleIcon>}
    <CollapsibleTitleLabel>{title}</CollapsibleTitleLabel>
  </SidebarSectionTitleContainer>
);

export const CollapsibleTitleToggle = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.primary || "#555"};
  font-family: ${(props) =>
    props.theme.typography?.mono || props.theme.typography?.sans || fallbackMono};
  font-weight: 600;
`;

export const CollapsibleBody = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: 8px;
  min-width: 0;
`;

export interface CollapsibleProps {
  title?: React.ReactNode;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export const Collapsible: React.FC<CollapsibleProps> = ({
  title,
  label,
  icon,
  children,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  const handleToggle = React.useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  return (
    <>
      <CollapsibleTitleContainer type="button" onClick={handleToggle}>
        {title ? (
          <CollapsibleTitleContent>
            {icon && <CollapsibleTitleIcon>{icon}</CollapsibleTitleIcon>}
            <CollapsibleTitleLabel>{title}</CollapsibleTitleLabel>
          </CollapsibleTitleContent>
        ) : (
          <CollapsibleTitleContent>
            {icon && <CollapsibleTitleIcon>{icon}</CollapsibleTitleIcon>}
            <CollapsibleTitleLabel>{label}</CollapsibleTitleLabel>
          </CollapsibleTitleContent>
        )}
        <CollapsibleTitleToggle>{isOpen ? "-" : "+"}</CollapsibleTitleToggle>
      </CollapsibleTitleContainer>
      {isOpen && (
        <CollapsibleBody>
          {children}
        </CollapsibleBody>
      )}
    </>
  );
};

// Keep the old components for backward compatibility but mark as deprecated
export interface CollapsibleTitleProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  label?: React.ReactNode;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}

/** @deprecated Use Collapsible component instead */
export const CollapsibleTitle: React.FC<CollapsibleTitleProps> = ({
  label,
  title,
  icon,
  isOpen,
  onToggle,
  ...props
}) => (
  <CollapsibleTitleContainer type="button" onClick={onToggle} {...props}>
    {title ? (
      <CollapsibleTitleContent>
        {icon && <CollapsibleTitleIcon>{icon}</CollapsibleTitleIcon>}
        <CollapsibleTitleLabel>{title}</CollapsibleTitleLabel>
      </CollapsibleTitleContent>
    ) : (
      <CollapsibleTitleContent>
        {icon && <CollapsibleTitleIcon>{icon}</CollapsibleTitleIcon>}
        <CollapsibleTitleLabel>{label}</CollapsibleTitleLabel>
      </CollapsibleTitleContent>
    )}
    <CollapsibleTitleToggle>{isOpen ? "-" : "+"}</CollapsibleTitleToggle>
  </CollapsibleTitleContainer>
);
