import React, { useMemo, useState } from "react";
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
import {
  BRAIN_ANATOMY_CARDS,
  NERVOUS_SYSTEM_CARDS,
  getAnatomyGroupId,
  normalizeAnatomySearchText,
} from "@n-apt/learn/sidebar/AnatomyCardsSection";
import { HotspotEditorSection } from "@n-apt/draw-signal";
import { useModel3D } from "@n-apt/three-d/hooks/useModel3D";
import { Collapsible, SidebarSubsectionList } from "@n-apt/ui";
import {
  MODEL_CAMERA_POSITION,
  MODEL_CAMERA_TARGET,
} from "@n-apt/consts/components";

const SECTION_STICKY_TOP = 50;
const SUBSECTION_STICKY_TOP = 92;

type AnatomySubsectionJump = {
  id: string;
  label: string;
  kind: "brain" | "nervous";
  parent?: string;
};

const ANATOMY_SUBSECTION_JUMPS: AnatomySubsectionJump[] = (() => {
  const targets: AnatomySubsectionJump[] = [
    { id: "anatomy-brain", label: "Brain", kind: "brain" },
    { id: "anatomy-nervous-system", label: "Nervous System", kind: "nervous" },
  ];
  const groupTargets = new Set<string>();
  const groupedCards = [
    { kind: "brain" as const, parent: "Brain", cards: BRAIN_ANATOMY_CARDS },
    { kind: "nervous" as const, parent: "Nervous System", cards: NERVOUS_SYSTEM_CARDS },
  ];

  groupedCards.forEach(({ kind, parent, cards }) => {
    cards.forEach((card) => {
      const key = `${kind}:${card.group}`;
      if (groupTargets.has(key)) return;
      groupTargets.add(key);
      targets.push({
        id: getAnatomyGroupId(kind, card.group),
        label: card.group,
        kind,
        parent,
      });
    });
  });

  return targets;
})();

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

const SubsectionJumpResults = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  grid-column: 1 / -1;
  margin: -4px 0 8px;
  padding: 8px 10px;
  border: 1px solid ${(props) => props.theme.primaryAlpha};
  border-radius: 8px;
  background: ${(props) => props.theme.primaryAnchor};
`;

const SubsectionJumpLabel = styled.span`
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const SubsectionJumpButton = styled.button`
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 6px;
  padding: 5px 8px;
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textPrimary};
  cursor: pointer;
  font: inherit;
  font-size: 10px;

  &:hover, &:focus-visible {
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
    outline: none;
  }
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
  const normalizedSearchTerm = normalizeAnatomySearchText(searchTerm);
  const matchingSubsections = useMemo(() => {
    if (normalizedSearchTerm.length < 3) return [];

    return ANATOMY_SUBSECTION_JUMPS
      .filter((target) => {
        const label = normalizeAnatomySearchText(target.label);
        return label.includes(normalizedSearchTerm) || normalizedSearchTerm.includes(label);
      })
      .sort((a, b) => {
        const aLabel = normalizeAnatomySearchText(a.label);
        const bLabel = normalizeAnatomySearchText(b.label);
        const rank = (label: string) => label === normalizedSearchTerm ? 0 : label.startsWith(normalizedSearchTerm) ? 1 : 2;
        return rank(aLabel) - rank(bLabel) || a.label.localeCompare(b.label);
      })
      .slice(0, 6);
  }, [normalizedSearchTerm]);

  const jumpToSubsection = (target: AnatomySubsectionJump) => {
    setModelVariant(target.kind === "brain" ? "brain" : "anatomy");
    const element = target.parent
      ? document.getElementById(target.id)
      : document.querySelector(`[data-sidebar-section="${target.id}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleResetCamera = () => {
    if (controlsRef?.current) {
      const controls = controlsRef.current;
      gsap.killTweensOf(controls.object.position);
      gsap.killTweensOf(controls.target);
      gsap.to(controls.object.position, {
        x: MODEL_CAMERA_POSITION[0],
        y: MODEL_CAMERA_POSITION[1],
        z: MODEL_CAMERA_POSITION[2],
        duration: .42,
        ease: "power2.inOut",
      });

      gsap.to(controls.target, {
        x: MODEL_CAMERA_TARGET[0],
        y: MODEL_CAMERA_TARGET[1],
        z: MODEL_CAMERA_TARGET[2],
        duration: .42,
        ease: "power2.inOut",
        onUpdate: () => controls.update(),
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
      {matchingSubsections.length > 0 && (
        <SubsectionJumpResults role="group" aria-label="Matching subsections">
          <SubsectionJumpLabel>Jump to</SubsectionJumpLabel>
          {matchingSubsections.map((target) => (
            <SubsectionJumpButton
              key={target.id}
              type="button"
              aria-label={`Jump to ${target.label}${target.parent ? ` in ${target.parent}` : ""}`}
              onClick={() => jumpToSubsection(target)}
            >
              {target.label}{target.parent ? ` · ${target.parent}` : ""}
            </SubsectionJumpButton>
          ))}
        </SubsectionJumpResults>
      )}

      <Section>
        <Collapsible
          icon={<PersonStanding size={16} />}
          label="Physiology /"
          defaultOpen
          sticky
          stickyTop={SECTION_STICKY_TOP}
          stickyZIndex={18}
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
          sticky
          stickyTop={SECTION_STICKY_TOP}
          stickyZIndex={18}
        >
          <SectionDescription>
            Emotional experience and related first-person topics are grouped in Effects (First Person).
          </SectionDescription>
        </Collapsible>

        <Collapsible
          icon={<Bone size={16} />}
          label="Anatomy /"
          open={searchTerm.trim() ? true : undefined}
          sticky
          stickyTop={SECTION_STICKY_TOP}
          stickyZIndex={18}
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
              sectionId="anatomy-brain"
              open={searchTerm.trim() ? true : undefined}
              sticky
              stickyTop={SUBSECTION_STICKY_TOP}
              stickyZIndex={19}
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
              sectionId="anatomy-nervous-system"
              open={searchTerm.trim() ? true : undefined}
              sticky
              stickyTop={SUBSECTION_STICKY_TOP}
              stickyZIndex={19}
              onOpenChange={(isOpen) => { if (isOpen) setModelVariant("anatomy"); }}
            >
              <AnatomyCardsSection kind="nervous" searchTerm={searchTerm} />
            </Collapsible>
          </SidebarSubsectionList>
        </Collapsible>

        <Collapsible icon={<NotebookPen size={16} />} label="Effects (First Person) /" open={searchTerm.trim() ? true : undefined} sticky stickyTop={SECTION_STICKY_TOP} stickyZIndex={18}>
          <SectionDescription>Health and lived-experience topics. These tiles describe possible effects and do not diagnose an individual or establish a cause.</SectionDescription>
          <TopicCards section="effects" searchTerm={searchTerm} />
          <TopicCards section="psychology" searchTerm={searchTerm} />
          <TopicCards section="behavior" searchTerm={searchTerm} />
          <TopicCards section="physiology" searchTerm={searchTerm} />
        </Collapsible>

        <Collapsible
          icon={<DraftingCompass size={16} />}
          label="Make Hotspots /"
          sticky
          stickyTop={SECTION_STICKY_TOP}
          stickyZIndex={18}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <HotspotEditorSection />
          </div>
        </Collapsible>
      </Section>
    </RouteContent>
  );
};
