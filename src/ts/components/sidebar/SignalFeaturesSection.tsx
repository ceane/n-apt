import React from "react";
import styled from "styled-components";
import { ClipboardPen } from "lucide-react";
import { Row, Collapsible } from "@n-apt/components/ui";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;




const HeterodyningContainer = styled.div`
  display: grid;
  grid-auto-flow: column;
  justify-content: start;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
`;

const VerifyButton = styled.button`
  font-size: 11px;
  padding: 6px 12px;
  min-width: 80px;
  background-color: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 6px;
  color: ${(props) => props.theme.primary};
  cursor: pointer;
  font-family: ${(props) => props.theme.typography.mono};
`;

interface SignalFeaturesSectionProps {
  sourceMode: "live" | "file";
  deviceState: string;
  isConnected: boolean;
  selectedFilesCount: number;
  heterodyningStatusText: string;
  heterodyningVerifyDisabled: boolean;
  onVerifyHeterodyning: () => void;
}

const ClassifyButton = styled.button<{ $disabled?: boolean }>`
  font-size: 11px;
  padding: 6px 12px;
  min-width: 80px;
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  background-color: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 6px;
  color: ${({ $disabled, theme }) => ($disabled ? theme.textMuted : theme.primary)};
  font-family: ${(props) => props.theme.typography.mono};
`;

const StatusActionRow = styled.div`
  display: grid;
  grid-auto-flow: column;
  justify-items: end;
  align-items: center;
  gap: 12px;
`;

const StatusText = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
`;

export const SignalFeaturesSection: React.FC<SignalFeaturesSectionProps> = ({
  sourceMode,
  deviceState,
  isConnected,
  selectedFilesCount,
  heterodyningStatusText,
  heterodyningVerifyDisabled,
  onVerifyHeterodyning,
}) => {
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
      <Collapsible
        icon={<ClipboardPen size={14} />}
        label="Signal Features /"
        defaultOpen={true}
      >
        <>
          <Row label={<>N-APT<span role="img" aria-label="brain" style={{ marginLeft: "6px" }}>🧠</span></>} tooltipTitle="N-APT" tooltip="N-APT stands for: Neuro Automatic Picture Transmission. These radio waves are modulated akin to APT signals (unknown reasons at this time) but unique in their ability to intercept, process and alter the brain and nervous system.<br><br>Through LF/HF frequencies (frequencies that survive attenuation of the skull and/or body; and lose less energy with longer distances/obstacles), it functions from triangulation, time of flight depth, heterodyning (it's key feature which ensures bioelectrical reception), phase shifting, center frequencies, impedance & endpoint signals processing (suspected as Kaiser, Bayes' Theorem/Posterior Probability, etc.).<br><br>It is an unprecedented formula of radio waves and neurotechnology with nascent efforts to decipher its modulation and content.">
            <StatusActionRow>
              <StatusText>
                {classificationStatusText}
              </StatusText>
              <ClassifyButton
                $disabled={classificationDisabled}
                disabled={classificationDisabled}
              >
                Classify?
              </ClassifyButton>
            </StatusActionRow>
          </Row>

          <Row label="Heterodyned?">
            <HeterodyningContainer>
              {heterodyningStatusText}
              <VerifyButton
                type="button"
                disabled={heterodyningVerifyDisabled}
                onClick={onVerifyHeterodyning}
              >
                Verify
              </VerifyButton>
            </HeterodyningContainer>
          </Row>
        </>
      </Collapsible>
    </Section>
  );
};
