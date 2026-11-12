import React, { useState } from "react";
import styled from "styled-components";
import { gsap } from "gsap";
import {
  PersonStanding,
  Blend,
  Bone,
  NotebookPen,
  DraftingCompass,
  Search,
  Brain,
  Network,
} from "lucide-react";
import { BodyAreasSection, AnatomyCardsSection, TopicCards } from "@n-apt/learn";
import { HotspotEditorSection } from "@n-apt/draw-signal";
import { useModel3D } from "@n-apt/three-d/hooks/useModel3D";
import { Collapsible, SidebarSubsectionList } from "@n-apt/ui";
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

const SearchWrap = styled.label`
  position: sticky;
  top: 10px;
  z-index: 20;
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin: 2px 0 8px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  color: ${(props) => props.theme.textSecondary};
  background: ${(props) => props.theme.surface};
  box-shadow: 0 4px 12px rgba(12, 18, 28, 0.08);
  &:focus-within { border-color: ${(props) => props.theme.primary}; }
`;

const SearchInput = styled.input`
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: ${(props) => props.theme.textPrimary};
  font: inherit;
  font-size: 12px;
  &::placeholder { color: ${(props) => props.theme.textMuted}; }
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
  background: ${(props) => props.theme.surfaceHover};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 6px;
  color: ${(props) => props.theme.textPrimary};
  font-size: 11px;
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
  padding: 10px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 12px;
  width: 100%;
  text-transform: uppercase;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  &:hover {
    background: ${(props) => props.theme.surface};
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
    box-shadow: 0 4px 12px ${(props) => `${props.theme.primary}26`};
  }

  &:active {
    transform: scale(0.98);
  }
`;

export const Model3DSidebar: React.FC = () => {
  const { controlsRef, setSelectedArea, setModelVariant } = useModel3D();
  const [searchTerm, setSearchTerm] = useState("");

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

      <ResetButton onClick={handleResetCamera}>Reset Camera</ResetButton>

      <SearchWrap>
        <Search size={16} aria-hidden="true" />
        <SearchInput
          type="search"
          aria-label="Search anatomy, physiology, psychology, and effects"
          placeholder="Search anatomy, physiology, psychology, effects…"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </SearchWrap>

      <Section>
        <Collapsible
          icon={<PersonStanding size={16} />}
          label="Physiology /"
          defaultOpen
          onOpenChange={(isOpen) => {
            if (isOpen) setModelVariant("human");
          }}
        >
          <SectionDescription>
            Click an area to focus the camera
          </SectionDescription>
          <div style={{ gridColumn: "1 / -1" }}>
            <BodyAreasSection searchTerm={searchTerm} />
          </div>
        </Collapsible>

        <Collapsible
          icon={<Blend size={16} />}
          label="Psychology /"
          open={searchTerm.trim() ? true : undefined}
        >
          <SectionDescription>
            Emotional experience and related first-person topics are grouped in Effects (First Person).
          </SectionDescription>
        </Collapsible>

        <Collapsible
          icon={<Bone size={16} />}
          label="Anatomy /"
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setModelVariant("human");
              return;
            }
            setModelVariant("anatomy");
            setSelectedArea(null);
          }}
        >
          <SectionDescription>
            Brain regions and the nervous system, with functions and model focus.
          </SectionDescription>
          <SidebarSubsectionList aria-label="Anatomy subsections">
            <Collapsible
              icon={<Brain size={15} />}
              label="Brain"
              open={searchTerm.trim() ? true : undefined}
              onOpenChange={(isOpen) => {
                setModelVariant(isOpen ? "brain" : "anatomy");
                if (!isOpen) setSelectedArea(null);
              }}
            >
              <AnatomyCardsSection kind="brain" searchTerm={searchTerm} />
            </Collapsible>
            <Collapsible
              icon={<Network size={15} />}
              label="Nervous System"
              open={searchTerm.trim() ? true : undefined}
              onOpenChange={(isOpen) => { if (isOpen) setModelVariant("anatomy"); }}
            >
              <AnatomyCardsSection kind="nervous" searchTerm={searchTerm} />
            </Collapsible>
          </SidebarSubsectionList>
        </Collapsible>

        <Collapsible icon={<NotebookPen size={16} />} label="Effects (First Person) /" open={searchTerm.trim() ? true : undefined}>
          <SectionDescription>Health and lived-experience topics. These tiles describe possible effects and do not diagnose an individual or establish a cause.</SectionDescription>
          <TopicCards section="effects" searchTerm={searchTerm} />
          <TopicCards section="psychology" searchTerm={searchTerm} />
          <TopicCards section="behavior" searchTerm={searchTerm} />
          <TopicCards section="physiology" searchTerm={searchTerm} />
        </Collapsible>

        <Collapsible
          icon={<DraftingCompass size={16} />}
          label="Make Hotspots /"
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <HotspotEditorSection />
          </div>
        </Collapsible>
      </Section>
    </RouteContent>
  );
};
