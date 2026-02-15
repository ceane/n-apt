import React from "react";
import styled from "styled-components";
import DecryptingText from "./DecryptingText";

const DecodeContainer = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #444;
  font-size: 14px;
`;

const DecodeContent = styled.div`
  padding: 20px;
  text-align: center;
  color: #ccc;
  font-size: 14px;
`;

const DecodeTitleWrapper = styled.div`
  margin-bottom: 16px;
`;

const DecodeDescription = styled.p`
  margin-bottom: 12px;
`;

const FeaturesContainer = styled.div`
  background-color: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 16px;
  margin-top: 16px;
`;

const FeaturesLabel = styled.div`
  font-size: 12px;
  color: #888;
  margin-bottom: 8px;
`;

const FeaturesList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 12px;
  color: #aaa;
`;

const FeatureItem = styled.li`
  margin-bottom: 4px;
`;

const IntegrationNote = styled.div`
  margin-top: 20px;
  font-size: 11px;
  color: #666;
`;

const Decode: React.FC = () => {
  return (
    <DecodeContainer>
      <DecodeContent>
        <DecodeTitleWrapper>
          <DecryptingText
            targetText="Decode N-APT with ML"
            speed={7}
            className="text-4xl md:text-6xl lg:text-7xl font-bold text-center"
            style={{ color: "#00d4ff" }}
          />
        </DecodeTitleWrapper>
        <DecodeDescription>
          Advanced signal decoding and feature extraction using machine learning.
        </DecodeDescription>
        <FeaturesContainer>
          <FeaturesLabel>Features:</FeaturesLabel>
          <FeaturesList>
            <FeatureItem>• Real-time signal feature extraction</FeatureItem>
            <FeatureItem>• ML-powered signal classification</FeatureItem>
            <FeatureItem>• Advanced spectral analysis</FeatureItem>
            <FeatureItem>• Confidence scoring and predictions</FeatureItem>
          </FeaturesList>
        </FeaturesContainer>
        <IntegrationNote>
          FFT and waterfall display will be integrated here with ML decoding capabilities.
        </IntegrationNote>
      </DecodeContent>
    </DecodeContainer>
  );
};

export default Decode;
