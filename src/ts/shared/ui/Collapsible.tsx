import React from "react";
import styled from "styled-components";

export const CollapsibleTitleContainer = styled.button<{
  $sticky?: boolean;
  $isOpen?: boolean;
  $stickyTop?: number;
  $stickyZIndex?: number;
}>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  grid-column: 1 / -1;
  position: ${(props) => (props.$sticky && props.$isOpen ? "sticky" : "relative")};
  top: ${(props) => (props.$sticky && props.$isOpen ? `${props.$stickyTop ?? 0}px` : "auto")};
  z-index: ${(props) =>
    props.$sticky && props.$isOpen ? props.$stickyZIndex ?? 1 : "auto"};
  background: ${(props) => (props.$sticky ? props.theme.surface : "transparent")};
  border: ${(props) =>
    props.$sticky ? `1px solid ${props.theme.border}` : "0"};
  padding: ${(props) => (props.$sticky ? "8px 10px" : "0")};
  margin: ${(props) => (props.$sticky ? "0.35rem 0" : "1.5rem 0 0.5rem 0")};
  border-radius: ${(props) => (props.$sticky ? "7px" : "0")};
  box-shadow: none;
  transition: background-color 0.15s ease, border-color 0.15s ease;
  &::after {
    content: ${(props) =>
      props.$sticky && props.$isOpen ? '""' : "none"};
    position: absolute;
    inset: 100% -1px auto;
    height: 12px;
    background: ${(props) => props.theme.surface};
    pointer-events: none;
  }
  cursor: pointer;
  text-align: left;
`;

const StickyCollapsibleRoot = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-column: 1 / -1;
  gap: inherit;
  min-width: 0;
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

const CollapsibleTitleEndAdornment = styled.span`
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  margin-left: 8px;
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
  endAdornment?: React.ReactNode;
  hideHeader?: boolean;
  sticky?: boolean;
  stickyTop?: number;
  stickyZIndex?: number;
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
  endAdornment,
  hideHeader = false,
  sticky = false,
  stickyTop = 0,
  stickyZIndex = 1,
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

  const collapsibleContent = (
    <>
      <CollapsibleTitleContainer
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        data-sidebar-section={sectionId}
        $sticky={sticky}
        $isOpen={isOpen}
        $stickyTop={stickyTop}
        $stickyZIndex={stickyZIndex}
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
        {endAdornment && (
          <CollapsibleTitleEndAdornment>{endAdornment}</CollapsibleTitleEndAdornment>
        )}
      </CollapsibleTitleContainer>
      {isOpen && <CollapsibleBody>{children}</CollapsibleBody>}
    </>
  );

  return sticky ? (
    <StickyCollapsibleRoot data-collapsible-sticky-root>
      {collapsibleContent}
    </StickyCollapsibleRoot>
  ) : collapsibleContent;
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
