import React from "react";
import { Link, useLocation } from "react-router-dom";
import styled from "styled-components";
import { Logo } from "@n-apt/components/ui/Logo";
import { AppBackButton } from "@n-apt/components/ui/AppBackButton";

const Page = styled.main`
  min-height: 100dvh;
  box-sizing: border-box;
  padding: 48px 20px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
`;

const Shell = styled.div`
  width: min(100%, 960px);
  margin: 0 auto;
  padding: 32px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 20px;
  background: ${(props) => props.theme.surface ?? "rgba(16, 16, 16, 0.9)"};
`;

const MainGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
  gap: 48px;
  align-items: start;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const Sidebar = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 24px;
  position: sticky;
  top: 28px;
  align-self: start;
  max-height: calc(100vh - 56px);

  @media (max-width: 900px) {
    position: static;
    max-height: none;
  }
`;

const SidebarTop = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding-right: 4px;
`;

const LogoLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin-bottom: 8px;
  text-decoration: none;
`;

const NavGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const NavGroupTitle = styled.div`
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${(props) => props.theme.textMuted};
  margin-bottom: 4px;
`;

const PageLink = styled(Link)<{ $active?: boolean }>`
  display: block;
  padding: 8px 12px;
  border-radius: 8px;
  color: ${(props) =>
    props.$active ? props.theme.primary : props.theme.textSecondary};
  background: ${(props) =>
    props.$active
      ? props.theme.primaryMuted ?? "rgba(0, 212, 255, 0.1)"
      : "transparent"};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 14px;
  font-weight: ${(props) => (props.$active ? "600" : "400")};
  text-decoration: none;
  transition: all 0.15s ease;

  &:hover {
    color: ${(props) => props.theme.primary};
    background: ${(props) =>
      props.$active
        ? props.theme.primaryMuted ?? "rgba(0, 212, 255, 0.1)"
        : "rgba(255, 255, 255, 0.04)"};
  }
`;

const SectionLinkList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid ${(props) => props.theme.border};
`;

const SectionLink = styled.a`
  display: block;
  color: ${(props) => props.theme.textMuted};
  text-decoration: none;
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 13px;
  line-height: 1.4;
  transition: color 0.15s ease;

  &:hover {
    color: ${(props) => props.theme.primary};
  }
`;

const ContentArea = styled.article`
  width: 100%;
  min-width: 0;
`;

export interface FaqSectionItem {
  href: string;
  label: string;
}

export interface FaqLayoutProps {
  children: React.ReactNode;
  sections?: FaqSectionItem[];
}

export const FaqLayout: React.FC<FaqLayoutProps> = ({
  children,
  sections = [],
}) => {
  const location = useLocation();

  const isIqCaptures =
    location.pathname === "/faq/iq-captures" ||
    location.pathname === "/iq-captures";
  const isFftIfft =
    location.pathname === "/faq/fft-ifft" ||
    location.pathname === "/fft-ifft";
  const isFaqHome = location.pathname === "/faq";

  return (
    <Page>
      <Shell>
        <MainGrid>
          <Sidebar aria-label="FAQ navigation">
            <SidebarTop>
              <LogoLink to="/" aria-label="N-APT home">
                <Logo size={48} alt="N-APT" />
              </LogoLink>

              <NavGroup>
                <NavGroupTitle>FAQ Pages</NavGroupTitle>
                <PageLink to="/faq" $active={isFaqHome}>
                  Lingo and Learn
                </PageLink>
                <PageLink to="/faq/iq-captures" $active={isIqCaptures}>
                  I/Q Capture
                </PageLink>
                <PageLink to="/faq/fft-ifft" $active={isFftIfft}>
                  FFT &amp; IFFT
                </PageLink>
              </NavGroup>

              {sections.length > 0 && (
                <NavGroup>
                  <NavGroupTitle>On This Page</NavGroupTitle>
                  <SectionLinkList>
                    {sections.map((sec) => (
                      <SectionLink key={sec.href} href={sec.href}>
                        {sec.label}
                      </SectionLink>
                    ))}
                  </SectionLinkList>
                </NavGroup>
              )}
            </SidebarTop>

            <AppBackButton variant="sidebar" />
          </Sidebar>

          <ContentArea>{children}</ContentArea>
        </MainGrid>
      </Shell>
    </Page>
  );
};

export default FaqLayout;
