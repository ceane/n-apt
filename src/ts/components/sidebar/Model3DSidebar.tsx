import React from "react";
import styled from "styled-components";
import { gsap } from "gsap";
import { PersonStanding, Blend, Bone, NotebookPen, DraftingCompass } from "lucide-react";
import { BodyAreasSection } from "@n-apt/components/sidebar/BodyAreasSection";
import { HotspotEditorSection } from "@n-apt/components/sidebar/HotspotEditorSection";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";
import { useModel3D } from "@n-apt/hooks/useModel3D";
import { Collapsible } from "@n-apt/components/ui";
import {
  MODEL_CAMERA_POSITION,
  MODEL_CAMERA_TARGET,
} from "@n-apt/consts/components";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
`;

const RouteContent = styled.div`
  padding: 4cqh 3cqw;
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  align-content: start;
  gap: 16px;
`;

const SectionDescription = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  margin-bottom: 16px;
  grid-column: 1 / -1;
`;

const InfoBox = styled.div`
  background: ${(props) => props.theme.primaryAnchor};
  border: 1px solid ${(props) => props.theme.primaryAlpha};
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
  grid-column: 1 / -1;
`;

const InfoTitle = styled.div`
  color: ${(props) => props.theme.primary};
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  font-family: ${(props) => props.theme.typography.mono};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const InfoText = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 11px;
  line-height: 1.5;
`;

const ResetButton = styled.button`
  background: ${(props) => props.theme.primaryAlpha};
  border: 1px solid ${(props) => props.theme.primary};
  border-radius: 6px;
  color: ${(props) => props.theme.primary};
  font-size: 11px;
  font-weight: 500;
  font-family: ${(props) => props.theme.typography.mono};
  padding: 8px 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 12px;
  width: 100%;
  text-transform: uppercase;
  letter-spacing: 0.5px;

  &:hover {
    background: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.background};
    transform: translateY(-1px);
    box-shadow: 0 2px 8px ${(props) => `${props.theme.primary}4d`};
  }

  &:active {
    transform: translateY(0);
  }
`;

export const Model3DSidebar: React.FC = () => {
  const { setSidebarTab } = useHotspotEditor();
  const { controlsRef, setSelectedArea } = useModel3D();

  // Unified accordion state
  const [openSection, setOpenSection] = React.useState<string>("physiology");

  const handleResetCamera = () => {
    if (controlsRef?.current) {
      // Reset camera position and target with smooth animation
      gsap.to(controlsRef.current.object.position, {
        x: MODEL_CAMERA_POSITION[0],
        y: MODEL_CAMERA_POSITION[1],
        z: MODEL_CAMERA_POSITION[2],
        duration: 1,
        ease: "power2.inOut",
      });

      gsap.to(controlsRef.current.target, {
        x: MODEL_CAMERA_TARGET[0],
        y: MODEL_CAMERA_TARGET[1],
        z: MODEL_CAMERA_TARGET[2],
        duration: 1,
        ease: "power2.inOut",
        onUpdate: () => controlsRef.current.update(),
      });

      // Also reset the selected area to null
      setSelectedArea(null);
    }
  };

  return (
    <RouteContent>
      <InfoBox>
        <InfoTitle>3D Model of the Human Body</InfoTitle>
        <InfoText>
          An interactive anatomical visualization designed for neuro-automatic
          signal mapping. Use the sections below to focus on specific
          physiological regions or create bioelectrical hotspots directly on the
          mesh. Coordinate focus and scale are maintained across all system
          views.
        </InfoText>
      </InfoBox>

      <ResetButton onClick={handleResetCamera}>
        Reset Camera
      </ResetButton>

      <Section>
        <Collapsible
          icon={<PersonStanding size={16} />}
          label="Physiology /"
          defaultOpen={openSection === "physiology"}
        >
          <SectionDescription>
            Click an area to focus the camera
          </SectionDescription>
          <div style={{ gridColumn: "1 / -1" }}>
            <BodyAreasSection />
          </div>
        </Collapsible>

        <Collapsible
          icon={<Blend size={16} />}
          label="Psychology /"
          defaultOpen={openSection === "psychology"}
        >
          <SectionDescription>
            Psychology-related data and mappings.
          </SectionDescription>
        </Collapsible>

        <Collapsible
          icon={<Bone size={16} />}
          label="Anatomy /"
          defaultOpen={openSection === "anatomy"}
        >
          <SectionDescription>
            Anatomical structures and bone mapping.
          </SectionDescription>
        </Collapsible>

        <Collapsible
          icon={<NotebookPen size={16} />}
          label="Effects /"
          defaultOpen={openSection === "effects"}
        >
          <SectionDescription>
            Visual effects and overlays.
          </SectionDescription>
        </Collapsible>

        <Collapsible
          icon={<DraftingCompass size={16} />}
          label="Make Hotspots /"
          defaultOpen={openSection === "hotspots"}
        >
          <div style={{ padding: "0 12px", gridColumn: "1 / -1" }}>
            <HotspotEditorSection />
          </div>
        </Collapsible>
      </Section>
    </RouteContent>
  );
};
