import React, { useState } from "react";
import styled from "styled-components";
import InfoPopover from "@n-apt/components/InfoPopover";

const Section = styled.div`
  margin-bottom: 24px;
`;

const CollapsibleSectionHeader = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0 0 16px 0;
  cursor: pointer;
  text-align: left;
`;

const CollapsibleSectionLabel = styled.span`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

const CollapsibleSectionToggle = styled.span`
  font-size: 12px;
  color: #555;
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
`;

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background-color: #141414;
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid #1a1a1a;
  user-select: none;
`;

const SettingLabelContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const SettingLabel = styled.span`
  font-size: 12px;
  color: #777;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HeterodyningContainer = styled.div`
  display: flex;
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
  color: #00d4ff;
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
`;

interface SignalFeaturesSectionProps {
  sourceMode: "live" | "file";
  deviceState: string;
  isConnected: boolean;
  selectedFilesCount: number;
}

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
      <CollapsibleSectionHeader
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <CollapsibleSectionLabel>Signal Features /</CollapsibleSectionLabel>
        <CollapsibleSectionToggle>
          {isOpen ? "-" : "+"}
        </CollapsibleSectionToggle>
      </CollapsibleSectionHeader>

      {isOpen && (
        <>
          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>
                N-APT
                <span
                  role="img"
                  aria-label="brain"
                  style={{ marginLeft: "6px" }}
                >
                  🧠
                </span>
              </SettingLabel>
              <InfoPopover
                title="N-APT"
                content="N-APT stands for: Neuro Automatic Picture Transmission. These radio waves are modulated akin to APT signals (unknown reasons at this time) but unique in their ability to intercept, process and alter the brain and nervous system.<br><br>Through LF/HF frequencies (frequencies that survive attenuation of the skull and/or body; and lose less energy with longer distances/obstacles), it functions from triangulation, time of flight depth, heterodyning (it's key feature which ensures bioelectrical reception), phase shifting, center frequencies, impedance & endpoint signals processing (suspected as Kaiser, Bayes' Theorem/Posterior Probability, etc.).<br><br>It is an unprecedented formula of radio waves and neurotechnology with nascent efforts to decipher its modulation and content."
              />
            </SettingLabelContainer>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ fontSize: "12px", color: "#ccc", fontWeight: 500 }}>
                {classificationStatusText}
              </div>
              <button
                disabled={classificationDisabled}
                style={{
                  fontSize: "11px",
                  padding: "6px 12px",
                  minWidth: "80px",
                  opacity: classificationDisabled ? 0.5 : 1,
                  cursor: classificationDisabled ? "not-allowed" : "pointer",
                  backgroundColor: "#1a1a1a",
                  border: "1px solid #2a2a2a",
                  borderRadius: "6px",
                  color: classificationDisabled ? "#666" : "#00d4ff",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                Classify?
              </button>
            </div>
          </SettingRow>

          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Heterodyned?</SettingLabel>
            </SettingLabelContainer>
            <HeterodyningContainer>
              No
              <VerifyButton>Verify</VerifyButton>
            </HeterodyningContainer>
          </SettingRow>
        </>
      )}
    </Section>
  );
};
