import React from "react";
import styled from "styled-components";
import { AppThemePicker } from "@n-apt/components/ui/AppThemePicker";
import { SkipIntroButton } from "@n-apt/components/ui/SkipIntroButton";
import { IntroView } from "@n-apt/md-signals/src/app/components/IntroView";

const Stage = styled.div`
  position: relative;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
  background: ${(props) => props.theme.background};
`;

export interface LearnSignalsIntroStageProps {
  onComplete: () => void;
}

export const LearnSignalsIntroStage: React.FC<LearnSignalsIntroStageProps> = ({
  onComplete,
}) => (
  <Stage>
    <AppThemePicker placement="floating" autoIntroExpand />
    <IntroView onComplete={onComplete} />
    <SkipIntroButton onClick={onComplete} />
  </Stage>
);

export default LearnSignalsIntroStage;
