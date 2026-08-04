import React, { useRef, useState } from "react";
import styled from "styled-components";
import { Link, useNavigate } from "react-router-dom";
import {
  Box,
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
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { setSourceMode, setSelectedFiles } from "@n-apt/redux";
import { fileRegistry } from "@n-apt/utils/fileRegistry";
import { selectWebSocketSources } from "@n-apt/redux/selectors/performanceSelectors";
import { isMockDevice } from "@n-apt/utils/deviceCapabilities";
import {
  getBypassStartPage,
  setBypassStartPage,
} from "@n-apt/utils/bypassStartPage";

const FILE_ACCEPT_TYPES = ".napt,.iq,.wav";

interface StartingPoint {
  title: string;
  description: string;
  Icon: LucideIcon;
  href: string;
  showConnectedSources?: boolean;
  showFileTypes?: boolean;
  showBypassToggle?: boolean;
  opensFileDialog?: boolean;
}

const startingPoints: StartingPoint[] = [
  {
    title: "Take an I/Q Capture",
    description: "Record a slice of the visible radio spectrum in real-time for later analysis (SDR required).",
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
    title: "Playback I/Q Captures",
    description: "Upload files to replay or analyze I/Q captures.",
    Icon: FileSignal,
    href: "/?source=fileSelection",
    showFileTypes: true,
    opensFileDialog: true,
  },
  {
    title: "See hardware gallery",
    description:
      "Browse 3D models and gallery views of related hardware like SDRs and antennas.",
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
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  padding: clamp(20px, 3vmin, 44px) clamp(20px, 5vmin, 64px);
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};

  /* Regular landscape aspect ratios: guarantee a comfortable fit. */
  @media (min-aspect-ratio: 4/3) and (max-aspect-ratio: 21/9) {
    padding-top: clamp(18px, 2.5vmin, 32px);
    padding-bottom: clamp(18px, 2.5vmin, 32px);
  }
`;

const Content = styled.div`
  display: flex;
  width: min(100%, 1160px);
  flex-direction: column;
  align-items: center;
  gap: clamp(16px, 2.5vmin, 28px);
  margin: auto;

  /* Distinct rhythm around the title: room above it (after the logo) and
     extra room below it, before the cards. */
  > *:first-child {
    margin-bottom: clamp(8px, 1.5vmin, 16px);
  }

  > h1 {
    margin-top: clamp(4px, 1vmin, 12px);
    margin-bottom: clamp(14px, 3vmin, 32px);
  }
`;

const Title = styled.h1`
  margin: 0;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: clamp(1.75rem, 5.5vmin, 3.25rem);
  font-weight: 500;
  letter-spacing: -0.06em;
  line-height: 0.95;
  text-align: center;
`;

const CardGrid = styled.section`
  display: grid;
  width: 100%;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: clamp(14px, 2vmin, 20px);

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.article`
  display: flex;
  flex: 1;
  min-height: clamp(180px, 26vmin, 240px);
  flex-direction: column;
  gap: clamp(12px, 2vmin, 18px);
  box-sizing: border-box;
  padding: clamp(16px, 2.2vmin, 22px);
  border: 1px solid ${(props) => props.theme.border};
  border-radius: clamp(12px, 1.8vmin, 18px);
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
  display: flex;
  flex-direction: column;
  min-width: 0;
  color: inherit;
  text-decoration: none;
`;

const CardLinkBody = styled(Link)`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: clamp(12px, 2vmin, 18px);
  min-width: 0;
  color: inherit;
  text-decoration: none;
`;

const CardFooter = styled.div`
  margin-top: auto;
  padding-top: clamp(8px, 1.5vmin, 12px);
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

const CardMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding-top: clamp(8px, 1.5vmin, 12px);
  border-top: 1px solid ${(props) => props.theme.border};
`;

const IconFrame = styled.div`
  display: flex;
  width: clamp(36px, 6vmin, 48px);
  height: clamp(36px, 6vmin, 48px);
  align-items: center;
  justify-content: center;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: clamp(8px, 1.5vmin, 12px);
  color: ${(props) => props.theme.primary};
  background: ${(props) => props.theme.background};
`;

const CardBody = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: clamp(6px, 1.5vmin, 10px);
`;

const CardTitle = styled.h2`
  margin: 0;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: clamp(0.95rem, 2.2vmin, 1.15rem);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
`;

const CardDescription = styled.p`
  margin: 0;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: clamp(0.78rem, 1.8vmin, 0.9rem);
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

const HiddenFileInput = styled.input`
  position: fixed;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
`;

export const GetStartedRoute: React.FC = () => {
  const [bypassStartPage, setBypassStartPageEnabled] = useState(() =>
    getBypassStartPage(),
  );
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const playbackFileInputRef = useRef<HTMLInputElement | null>(null);
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

  const handlePlaybackCardClick = (
    event: React.MouseEvent | React.KeyboardEvent,
    href: string,
  ) => {
    event.preventDefault();
    playbackFileInputRef.current?.click();
    navigate(href);
  };

  return (
    <Page>
      <Content>
        <Logo size="clamp(64px, 11vmin, 112px)" alt="N-APT" />
        <Title>Let&apos;s get started.</Title>
        <HiddenFileInput
          ref={playbackFileInputRef}
          type="file"
          accept={FILE_ACCEPT_TYPES}
          multiple
          onChange={(event) => {
            const files = event.target.files
              ? Array.from(event.target.files)
              : [];
            if (files.length === 0) return;
            const registeredFiles = files.map((file) => ({
              id: fileRegistry.register(file),
              name: file.name,
            }));
            dispatch(setSourceMode("file"));
            dispatch(setSelectedFiles(registeredFiles));
            event.target.value = "";
          }}
        />
        <CardGrid aria-label="Ways to get started">
          {startingPoints.map(
            ({
              title,
              description,
              Icon,
              href,
              showConnectedSources,
              showFileTypes,
              showBypassToggle,
              opensFileDialog,
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
              ) : opensFileDialog ? (
                <Card
                  key={title}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => handlePlaybackCardClick(event, href)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handlePlaybackCardClick(event, href);
                    }
                  }}
                >
                  <IconFrame aria-hidden="true">
                    <Icon size={23} strokeWidth={1.7} />
                  </IconFrame>
                  <CardBody>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardBody>
                  {showFileTypes && (
                    <CardMeta>
                      <SourceLabel>Accepts</SourceLabel>
                      <SourcePills aria-label="Accepted capture file types">
                        {[".napt", ".iq", ".wav"].map((fileType) => (
                          <SourcePill key={fileType}>{fileType}</SourcePill>
                        ))}
                      </SourcePills>
                    </CardMeta>
                  )}
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
                    </CardBody>
                    {showConnectedSources && (
                      <CardMeta>
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
                      </CardMeta>
                    )}
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
