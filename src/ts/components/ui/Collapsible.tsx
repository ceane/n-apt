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

const fallbackMono =
  'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace';

export const CollapsibleTitleContent = styled.div<{ $pulseToken?: number }>`
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  ${({ $pulseToken, theme }) =>
    $pulseToken
      ? `
    border-radius: 999px;
    padding: 2px 8px;
    margin: -2px -8px;
    animation: collapsible-title-pulse-${$pulseToken} 900ms ease-out 1;

    @keyframes collapsible-title-pulse-${$pulseToken} {
      0% {
        box-shadow: 0 0 0 0 ${theme.primary || "#00d4ff"}00;
      }
      30% {
        box-shadow: 0 0 0 4px ${theme.primary || "#00d4ff"}44, 0 0 0 8px ${theme.primary || "#00d4ff"}1f;
      }
      100% {
        box-shadow: 0 0 0 0 ${theme.primary || "#00d4ff"}00;
      }
    }
  `
      : ""}
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
    props.theme.typography?.mono ||
    props.theme.typography?.sans ||
    fallbackMono};
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
    props.theme.typography?.mono ||
    props.theme.typography?.sans ||
    fallbackMono};
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
    props.theme.typography?.mono ||
    props.theme.typography?.sans ||
    fallbackMono};
  font-weight: 600;
`;

export const CollapsibleBody = styled.div`
  display: grid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: 8px;
  width: 100%;
  min-width: 0;
`;

export interface CollapsibleProps {
  title?: React.ReactNode;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  sectionId?: string;
  onOpenChange?: (isOpen: boolean) => void;
  titlePulseToken?: number;
  hideHeader?: boolean;
}

export const Collapsible: React.FC<CollapsibleProps> = ({
  title,
  label,
  icon,
  children,
  defaultOpen = false,
  open,
  sectionId,
  onOpenChange,
  titlePulseToken,
  hideHeader = false,
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  React.useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open);
    }
  }, [open]);

  const handleToggle = React.useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange]);

  if (hideHeader) {
    return <>{children}</>;
  }

  return (
    <>
      <CollapsibleTitleContainer
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        data-sidebar-section={sectionId}
      >
        {title ? (
          <CollapsibleTitleContent
            $pulseToken={titlePulseToken}
            data-pulse-token={titlePulseToken}
          >
            {icon && <CollapsibleTitleIcon>{icon}</CollapsibleTitleIcon>}
            <CollapsibleTitleLabel>{title}</CollapsibleTitleLabel>
          </CollapsibleTitleContent>
        ) : (
          <CollapsibleTitleContent
            $pulseToken={titlePulseToken}
            data-pulse-token={titlePulseToken}
          >
            {icon && <CollapsibleTitleIcon>{icon}</CollapsibleTitleIcon>}
            <CollapsibleTitleLabel>{label}</CollapsibleTitleLabel>
          </CollapsibleTitleContent>
        )}
        <CollapsibleTitleToggle>{isOpen ? "-" : "+"}</CollapsibleTitleToggle>
      </CollapsibleTitleContainer>
      {isOpen && <CollapsibleBody>{children}</CollapsibleBody>}
    </>
  );
};

// Keep the old components for backward compatibility but mark as deprecated
export interface CollapsibleTitleProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> {
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
