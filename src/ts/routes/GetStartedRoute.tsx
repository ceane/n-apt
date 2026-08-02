import React, { useState } from "react";
import styled from "styled-components";
import { Link } from "react-router-dom";
import {
  Box,
  BookOpen,
  FileSignal,
  FileText,
  LayoutGrid,
  Radio,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@n-apt/components/ui/Logo";
import { Toggle } from "@n-apt/components/ui/Toggle";
import { useAppSelector } from "@n-apt/redux";
import { selectWebSocketSources } from "@n-apt/redux/selectors/performanceSelectors";
import { isMockDevice } from "@n-apt/utils/deviceCapabilities";
import {
  getBypassStartPage,
  setBypassStartPage,
} from "@n-apt/utils/bypassStartPage";

interface StartingPoint {
  title: string;
  description: string;
  Icon: LucideIcon;
  href: string;
  showConnectedSources?: boolean;
  showBypassToggle?: boolean;
}

const startingPoints: StartingPoint[] = [
  {
    title: "Take an I/Q Capture",
    description: "Record a slice of the radio spectrum for later analysis.",
    Icon: FileSignal,
    href: "/?sidebarSection=iq-capture",
  },
  {
    title: "Use app",
    description: "Explore spectrum, demodulate signals and more.",
    Icon: LayoutGrid,
    href: "/",
    showBypassToggle: true,
  },
  {
    title: "View signals via SDRs",
    description: "See the signals coming from your connected radios.",
    Icon: Radio,
    href: "/",
    showConnectedSources: true,
  },
  {
    title: "Lingo and Learn",
    description: "Browse the FAQ to learn radio and signal-processing terms.",
    Icon: BookOpen,
    href: "/faq",
  },
  {
    title: "See hardware gallery",
    description: "Browse 3D models and gallery views of related hardware like SDRs and antennas.",
    Icon: Box,
    href: "/3d-model-gallery",
  },
  {
    title: "Learn more about signals",
    description: "Interactive lessons on how N-APT and related signals work.",
    Icon: Sparkles,
    href: "/learn-signals",
  },
  {
    title: "Terms and Conditions",
    description: "Read the Terms of Use and license summary for N-APT.",
    Icon: FileText,
    href: "/terms",
  },
  {
    title: "Privacy Policy",
    description: "See how the app handles authentication, sessions, and data.",
    Icon: Shield,
    href: "/privacy",
  },
];

const Page = styled.main`
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 100dvh;
  overflow-x: hidden;
  overflow-y: auto;
  padding: clamp(32px, 6vw, 80px) clamp(20px, 5vw, 72px);
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
`;

const Content = styled.div`
  display: flex;
  width: min(100%, 1160px);
  min-height: calc(100dvh - 2 * clamp(32px, 6vw, 80px));
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(28px, 4vw, 52px);
  margin: 0 auto;
`;

const Title = styled.h1`
  margin: 0;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: clamp(2.5rem, 6vw, 5.25rem);
  font-weight: 500;
  letter-spacing: -0.06em;
  line-height: 0.95;
  text-align: center;
`;

const CardGrid = styled.section`
  display: grid;
  width: 100%;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.article`
  display: flex;
  min-height: 250px;
  flex-direction: column;
  gap: 24px;
  box-sizing: border-box;
  padding: 20px;
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

const CardLink = styled(Link)`
  display: block;
  min-width: 0;
  color: inherit;
  text-decoration: none;
`;

const CardLinkBody = styled(Link)`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
`;

const CardFooter = styled.div`
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid ${(props) => props.theme.border};

  [role="switch"] {
    align-items: center;
    gap: 8px;
    max-width: 100%;
  }

  [role="switch"] span {
    font-family: ${(props) => props.theme.typography.sans};
    font-size: 0.78rem;
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1.15;
    white-space: nowrap;
    color: ${(props) => props.theme.textSecondary};
  }
`;

const IconFrame = styled.div`
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

const CardBody = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
`;

const CardTitle = styled.h2`
  margin: 0;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
`;

const CardDescription = styled.p`
  margin: 0;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 0.9rem;
  line-height: 1.45;
`;

const SourceLabel = styled.span`
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const SourcePills = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
`;

const SourcePill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 999px;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 0.68rem;
  line-height: 1;
`;

const EmptySourceState = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 5px 8px;
  border: 1px dashed ${(props) => props.theme.border};
  border-radius: 999px;
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 0.68rem;
  line-height: 1;
`;

const SourceDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${(props) => props.theme.success};
  box-shadow: 0 0 8px ${(props) => props.theme.success};
`;

export const GetStartedRoute: React.FC = () => {
  const [bypassStartPage, setBypassStartPageEnabled] = useState(() =>
    getBypassStartPage(),
  );
  const isConnected = useAppSelector((state) => state.websocket.isConnected);
  const sources = useAppSelector(selectWebSocketSources);
  const sourceNames = isConnected
    ? Array.from(
        new Set(
          sources
            .filter((source) => !isMockDevice(source))
            .map((source) => source.name.trim())
            .filter((name) => name.length > 0),
        ),
      )
    : [];

  return (
    <Page>
      <Content>
        <Logo size="clamp(88px, 11vw, 144px)" alt="N-APT" />
        <Title>Let&apos;s get started.</Title>
        <CardGrid aria-label="Ways to get started">
          {startingPoints.map(
            ({
              title,
              description,
              Icon,
              href,
              showConnectedSources,
              showBypassToggle,
            }) =>
              showBypassToggle ? (
                <Card key={title}>
                  <CardLinkBody to={href}>
                    <IconFrame aria-hidden="true">
                      <Icon size={23} strokeWidth={1.7} />
                    </IconFrame>
                    <CardBody>
                      <CardTitle>{title}</CardTitle>
                      <CardDescription>{description}</CardDescription>
                    </CardBody>
                  </CardLinkBody>
                  <CardFooter
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <Toggle
                      $active={bypassStartPage}
                      labelPosition="left"
                      onClick={() => {
                        const next = !bypassStartPage;
                        setBypassStartPageEnabled(next);
                        setBypassStartPage(next);
                      }}
                    >
                      Bypass Start Page Next Time
                    </Toggle>
                  </CardFooter>
                </Card>
              ) : (
                <CardLink key={title} to={href}>
                  <Card>
                    <IconFrame aria-hidden="true">
                      <Icon size={23} strokeWidth={1.7} />
                    </IconFrame>
                    <CardBody>
                      <CardTitle>{title}</CardTitle>
                      <CardDescription>{description}</CardDescription>
                      {showConnectedSources && (
                        <div>
                          <SourceLabel>Connected sources</SourceLabel>
                          <SourcePills aria-label="Connected SDR sources">
                            {sourceNames.length > 0 ? (
                              sourceNames.map((sourceName) => (
                                <SourcePill key={sourceName}>
                                  <SourceDot aria-hidden="true" />
                                  {sourceName}
                                </SourcePill>
                              ))
                            ) : (
                              <EmptySourceState>
                                No SDRs connected
                              </EmptySourceState>
                            )}
                          </SourcePills>
                        </div>
                      )}
                    </CardBody>
                  </Card>
                </CardLink>
              ),
          )}
        </CardGrid>
      </Content>
    </Page>
  );
};

export default GetStartedRoute;
