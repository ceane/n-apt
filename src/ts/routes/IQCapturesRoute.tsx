import React from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import IQCaptureCanvasGraphic from "@n-apt/components/canvas/IQCaptureCanvasGraphic";

const Page = styled.main`
  min-height: 100dvh;
  box-sizing: border-box;
  padding: 48px 24px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
`;

const Content = styled.div`
  width: min(100%, 820px);
  margin: 0 auto;
`;

const BackLink = styled(Link)`
  display: inline-block;
  margin-bottom: 48px;
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  text-decoration: none;

  &:hover {
    color: ${(props) => props.theme.primary};
  }
`;

const Eyebrow = styled.p`
  margin: 0 0 12px;
  color: ${(props) => props.theme.primary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const Heading = styled.h1`
  margin: 0 0 20px;
  font-size: clamp(32px, 6vw, 52px);
  line-height: 1.05;
`;

const Intro = styled.p`
  margin: 0 0 32px;
  color: ${(props) => props.theme.textSecondary};
  font-size: 18px;
  line-height: 1.6;
`;

const Section = styled.section`
  padding: 24px 0;
  border-top: 1px solid ${(props) => props.theme.border};
`;

const SectionHeading = styled.h2`
  margin: 0 0 12px;
  font-size: 22px;
`;

const Body = styled.p`
  margin: 0;
  color: ${(props) => props.theme.textSecondary};
  font-size: 15px;
  line-height: 1.7;
`;

const List = styled.ul`
  margin: 0;
  padding-left: 20px;
  color: ${(props) => props.theme.textSecondary};
  font-size: 15px;
  line-height: 1.7;

  li + li {
    margin-top: 8px;
  }
`;

export const IQCapturesRoute: React.FC = () => (
  <Page>
    <Content>
      <BackLink to="/">← Back to N-APT</BackLink>
      <Eyebrow>Playback and analysis</Eyebrow>
      <Heading>I/Q captures</Heading>
      <Intro>
        An I/Q capture is like a video recording, but for radio. It saves a
       slice of radio waves in the air so N-APT can play it back later.
      </Intro>

      <IQCaptureCanvasGraphic />

      <Section>
        <SectionHeading>What is an I/Q capture?</SectionHeading>
        <Body>
          Your radio turns what it receives into two streams of numbers. Those
          numbers keep enough detail to look at the signal, tune around, and
          try different kinds of analysis later—even after the radio is
          unplugged.
        </Body>
      </Section>

      <Section>
        <SectionHeading>What an I/Q capture stores</SectionHeading>
        <List>
          <li>The two streams of numbers recorded by the radio.</li>
          <li>What frequency was being listened to and how quickly it was sampled.</li>
          <li>When it was recorded and which device recorded it, when available.</li>
        </List>
      </Section>

      <Section>
        <SectionHeading>What playback outputs</SectionHeading>
        <Body>
          When you press play, N-APT rebuilds the recorded radio signal. You
          can see it in spectrum and waterfall views, inspect it, make
          snapshots, or try to demodulate it—all without the radio connected.
        </Body>
      </Section>
    </Content>
  </Page>
);

export default IQCapturesRoute;
