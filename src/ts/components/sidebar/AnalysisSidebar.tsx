import React from "react";
import styled from "styled-components";
import DecryptingText from "@n-apt/components/DecryptingText";

const SidebarContent = styled.div`
  padding: 0 24px;
`;

const InfoBox = styled.div`
  background: ${(props) => props.theme.primaryAnchor};
  border: 1px solid ${(props) => props.theme.primaryAlpha};
  border-radius: 8px;
  padding: 16px;
  margin-top: 24px;
`;

const InfoTitle = styled.div`
  color: ${(props) => props.theme.primary};
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  font-family: "JetBrains Mono", monospace;
`;

const InfoText = styled.div`
  color: #888;
  font-size: 11px;
  line-height: 1.5;
`;

export const AnalysisSidebar: React.FC = () => {
  return (
    <SidebarContent>
      <InfoBox>
        <InfoTitle>Analysis Mode</InfoTitle>
        <InfoText>
          ML-powered signal analysis and feature extraction. Use this mode to
          identify specific modulation types and protocol structures in N-APT
          signals.
        </InfoText>
      </InfoBox>
    </SidebarContent>
  );
};

export default AnalysisSidebar;
