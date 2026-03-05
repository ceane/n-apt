import React, { useState } from "react";
import styled from "styled-components";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;

import { Row, CollapsibleTitle } from "@n-apt/components/ui";



const HeterodyningContainer = styled.div`
  display: grid;
  grid-auto-flow: column;
  justify-content: start;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
`;

const VerifyButton = styled.button`
  font-size: 11px;
  padding: 6px 12px;
  min-width: 80px;
  background-color: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  color: ${(props) => props.theme.primary};
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
`;

interface SignalFeaturesSectionProps {
  sourceMode: "live" | "file";
  deviceState: string;
  isConnected: boolean;
  selectedFilesCount: number;
}

const ClassifyButton = styled.button<{ $disabled?: boolean }>`
  font-size: 11px;
  padding: 6px 12px;
  min-width: 80px;
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  background-color: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  color: ${({ $disabled, theme }) => ($disabled ? "#666" : theme.primary)};
  font-family: "JetBrains Mono", monospace;
`;

export const SignalFeaturesSection: React.FC<SignalFeaturesSectionProps> = ({
  sourceMode,
  deviceState,
  isConnected,
  selectedFilesCount,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const isFileSource = sourceMode === "file";

  const classificationStatusText = isFileSource
    ? selectedFilesCount > 0
      ? "Yes"
      : "No"
    : deviceState === "connected"
      ? "Yes"
      : "No";

  const classificationDisabled = isFileSource
    ? selectedFilesCount === 0
    : !isConnected || deviceState !== "connected";

  return (
    <Section>
      <CollapsibleTitle
        label="Signal Features /"
        isOpen={isOpen}
        onToggle={() => setIsOpen((prev) => !prev)}
      />

      {isOpen && (
        <>
          <Row label={<>N-APT<span role="img" aria-label="brain" style={{ marginLeft: "6px" }}>🧠</span></>} tooltipTitle="N-APT" tooltip="N-APT stands for: Neuro Automatic Picture Transmission. These radio waves are modulated akin to APT signals (unknown reasons at this time) but unique in their ability to intercept, process and alter the brain and nervous system.<br><br>Through LF/HF frequencies (frequencies that survive attenuation of the skull and/or body; and lose less energy with longer distances/obstacles), it functions from triangulation, time of flight depth, heterodyning (it's key feature which ensures bioelectrical reception), phase shifting, center frequencies, impedance & endpoint signals processing (suspected as Kaiser, Bayes' Theorem/Posterior Probability, etc.).<br><br>It is an unprecedented formula of radio waves and neurotechnology with nascent efforts to decipher its modulation and content.">
            <div style={{ display: "grid", gridAutoFlow: "column", justifyItems: "end", alignItems: "center", gap: "12px" }}>
              <div style={{ fontSize: "12px", color: "#ccc", fontWeight: 500 }}>
                {classificationStatusText}
              </div>
              <ClassifyButton
                $disabled={classificationDisabled}
                disabled={classificationDisabled}
              >
                Classify?
              </ClassifyButton>
            </div>
          </Row>

          <Row label="Heterodyned?">
            <HeterodyningContainer>
              No
              <VerifyButton>Verify</VerifyButton>
            </HeterodyningContainer>
          </Row>
        </>
      )}
    </Section>
  );
};
