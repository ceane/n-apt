import React from "react";
import { Link } from "react-router";
import styled from "styled-components";
import type { LucideIcon } from "lucide-react";

export const LinkCardGrid = styled.div<{ $columns?: number }>`
  display: grid;
  width: 100%;
  grid-template-columns: repeat(${(props) => props.$columns ?? 4}, minmax(0, 1fr));
  gap: 16px;

  @media (max-width: 1200px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

export const LinkCard = styled.article<{ $compact?: boolean }>`
  display: flex;
  min-height: ${(props) => (props.$compact ? "150px" : "250px")};
  flex-direction: column;
  gap: ${(props) => (props.$compact ? "16px" : "24px")};
  box-sizing: border-box;
  padding: ${(props) => (props.$compact ? "16px" : "20px")};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 18px;
  background: ${(props) => props.theme.surface};
  transition:
    border-color 0.18s ease,
    transform 0.18s ease;

  &:hover {
    border-color: ${(props) => props.theme.borderHover};
    background: ${(props) => props.theme.surfaceHover};
    transform: translateY(-2px);
  }
`;

export const LinkCardLink = styled(Link)`
  display: block;
  min-width: 0;
  color: inherit;
  text-decoration: none;
`;

export const LinkCardBody = styled(Link)`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
`;

export const LinkCardIconFrame = styled.div`
  display: flex;
  width: 48px;
  height: 48px;
  align-items: center;
  justify-content: center;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  color: ${(props) => props.theme.primary};
  background: ${(props) => props.theme.background};
`;

export const LinkCardBodyInner = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
`;

export const LinkCardTitle = styled.h2`
  margin: 0;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
`;

export const LinkCardDescription = styled.p`
  margin: 0;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 0.9rem;
  line-height: 1.45;
`;

export interface LinkCardItem {
  title: string;
  description: string;
  Icon: LucideIcon;
  href?: string;
  to?: string;
  footer?: React.ReactNode;
  compact?: boolean;
}

export const LinkCardItemView: React.FC<LinkCardItem> = ({
  title,
  description,
  Icon,
  href,
  to,
  footer,
  compact = false,
}) => {
  const content = (
    <>
      <LinkCardIconFrame aria-hidden="true">
        <Icon size={compact ? 20 : 23} strokeWidth={1.7} />
      </LinkCardIconFrame>
      <LinkCardBodyInner>
        <LinkCardTitle>{title}</LinkCardTitle>
        <LinkCardDescription>{description}</LinkCardDescription>
      </LinkCardBodyInner>
      {footer}
    </>
  );

  if (href) {
    return (
      <LinkCard $compact={compact}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: 16,
            minWidth: 0,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          {content}
        </a>
      </LinkCard>
    );
  }

  if (to) {
    return (
      <LinkCard $compact={compact}>
        <LinkCardBody to={to}>{content}</LinkCardBody>
      </LinkCard>
    );
  }

  return <LinkCard $compact={compact}>{content}</LinkCard>;
};
