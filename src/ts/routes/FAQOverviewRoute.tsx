import React from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import FaqLayout from "@n-apt/components/FaqLayout";
import { BookOpen, Waves } from "lucide-react";

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
  font-size: clamp(28px, 5vw, 44px);
  line-height: 1.1;
  color: ${(props) => props.theme.textPrimary};
`;

const Intro = styled.p`
  margin: 0 0 32px;
  color: ${(props) => props.theme.textSecondary};
  font-size: 18px;
  line-height: 1.6;
`;

const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
`;

const Card = styled(Link)`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 14px;
  background: ${(props) => props.theme.surface};
  color: inherit;
  text-decoration: none;
  transition:
    border-color 0.18s ease,
    transform 0.18s ease;

  &:hover {
    border-color: ${(props) => props.theme.borderHover};
    background: ${(props) => props.theme.surfaceHover};
    transform: translateY(-2px);
  }
`;

const CardIcon = styled.div`
  display: flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 10px;
  color: ${(props) => props.theme.primary};
  background: ${(props) => props.theme.background};
`;

const CardTitle = styled.h2`
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: ${(props) => props.theme.textPrimary};
`;

const CardDescription = styled.p`
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: ${(props) => props.theme.textSecondary};
`;

const faqCards = [
  {
    to: "/faq/iq-captures",
    Icon: Waves,
    title: "I/Q Captures",
    description:
      "What an I/Q capture is, what it stores, and what playback outputs.",
  },
  {
    to: "/faq/fft-ifft",
    Icon: BookOpen,
    title: "FFT & IFFT",
    description:
      "How the Fast Fourier Transform and its inverse power the spectrum view.",
  },
];

export const FAQOverviewRoute: React.FC = () => (
  <FaqLayout>
    <div>
      <Eyebrow>Lingo and learn</Eyebrow>
      <Heading>Frequently asked questions</Heading>
      <Intro>
        Browse the N-APT FAQ to learn the language of radio, spectrum analysis,
        and signal processing.
      </Intro>

      <CardGrid>
        {faqCards.map(({ to, Icon, title, description }) => (
          <Card key={to} to={to}>
            <CardIcon aria-hidden="true">
              <Icon size={20} strokeWidth={1.7} />
            </CardIcon>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </Card>
        ))}
      </CardGrid>
    </div>
  </FaqLayout>
);

export default FAQOverviewRoute;
