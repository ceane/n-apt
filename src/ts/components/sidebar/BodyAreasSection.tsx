import React, { useEffect } from "react";
import styled from "styled-components";
import { gsap } from "gsap";
import { useModel3D } from "@n-apt/hooks/useModel3D";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";

type Area = {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  meshName: string;
};

export const PHYSIOLOGY_AREAS: Area[] = [
  {
    name: "Head",
    position: [0.0, 1.92, 0.48],
    target: [0.0, 1.905, 0.0],
    meshName: "o_ADBody",
  },
  {
    name: "Face",
    position: [0.0, 1.84, 0.56],
    target: [0.0, 1.835, 0.12],
    meshName: "o_ADBody",
  },
  {
    name: "Throat",
    position: [0.007886413129995381, 1.5673426681304798, 0.4609346531290654],
    target: [0.007886413129995381, 1.5673426681304798, 0.2109346531290654],
    meshName: "o_ADBody",
  },
  {
    name: "Vocal Cords",
    position: [0.0, 1.79, 0.32],
    target: [0.0, 1.81, 0.06],
    meshName: "o_ADBody",
  },
  {
    name: "Arms (Left)",
    position: [-0.5112283085991381, 1.6509659003411805, 0.49878115381698285],
    target: [-0.5112283085991381, 1.6509659003411805, -0.0012188461830171526],
    meshName: "o_ADBody",
  },
  {
    name: "Arms (Right)",
    position: [0.5112283085991381, 1.6509659003411805, 0.49878115381698285],
    target: [0.5112283085991381, 1.6509659003411805, -0.0012188461830171526],
    meshName: "o_ADBody",
  },
  {
    name: "Hands (Left)",
    position: [-0.8296765632761604, 1.6325936375462096, 0.52485250831670527],
    target: [-0.8296765632761604, 1.6325936375462096, 0.02485250831670527],
    meshName: "o_ADBody",
  },
  {
    name: "Hands (Right)",
    position: [0.8296765632761604, 1.6325936375462096, 0.52485250831670527],
    target: [0.8296765632761604, 1.6325936375462096, 0.02485250831670527],
    meshName: "o_ADBody",
  },
  {
    name: "Legs (Left)",
    position: [-0.10898431768502082, 0.593799380056039, 0.58089139049060412],
    target: [-0.10898431768502082, 0.593799380056039, 0.08089139049060412],
    meshName: "o_ADBody",
  },
  {
    name: "Legs (Right)",
    position: [0.10898431768502082, 0.593799380056039, 0.58089139049060412],
    target: [0.10898431768502082, 0.593799380056039, 0.08089139049060412],
    meshName: "o_ADBody",
  },
  {
    name: "Feet (Left)",
    position: [-0.11249315323047496, 0.050075522352810875, 0.6709768440676025],
    target: [-0.11249315323047496, 0.050075522352810875, 0.1709768440676025],
    meshName: "o_ADBody",
  },
  {
    name: "Feet (Right)",
    position: [0.11249315323047496, 0.050075522352810875, 0.6709768440676025],
    target: [0.11249315323047496, 0.050075522352810875, 0.1709768440676025],
    meshName: "o_ADBody",
  },
  {
    name: "Torso",
    position: [0.0004717362772533665, 1.4813323133415635, 0.6417963311155659],
    target: [0.0004717362772533665, 1.4813323133415635, 0.1417963311155659],
    meshName: "o_ADBody",
  },
  {
    name: "Heart",
    position: [0.11913283600843724, 1.5627545966498622, 0.4164080716320717],
    target: [0.11913283600843724, 1.5627545966498622, 0.1164080716320717],
    meshName: "o_ADBody",
  },
  {
    name: "Stomach",
    position: [-0.00025375320540028945, 1.248053003421258, 0.63601507013990322],
    target: [-0.00025375320540028945, 1.248053003421258, 0.13601507013990322],
    meshName: "o_ADBody",
  },
  {
    name: "Genitals",
    position: [-0.00557629969815341, 1.018571342520556, 0.60842381567021109],
    target: [-0.00557629969815341, 1.018571342520556, 0.10842381567021109],
    meshName: "o_ADBody",
  },
  {
    name: "Buttocks",
    position: [0.0, 1.13, -0.92],
    target: [0.0, 1.13, -0.42],
    meshName: "o_ADBody",
  },
  {
    name: "Ears (Left)",
    position: [-0.17, 1.84, 0.44],
    target: [-0.17, 1.84, -0.01],
    meshName: "o_ADBody",
  },
  {
    name: "Ears (Right)",
    position: [0.17, 1.84, 0.44],
    target: [0.17, 1.84, -0.01],
    meshName: "o_ADBody",
  },
];

const AreaList = styled.div`
  display: grid;
  gap: 6px;
  overflow-y: auto;
  padding-right: 4px;
  box-sizing: border-box;
`;

const BaseButton = styled.button`
  max-width: 100%;
  display: grid;
  grid-template-columns: 1fr max-content;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.border};
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textPrimary};
  font-size: 12px;
  line-height: 1.1;
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    transform 120ms ease,
    box-shadow 120ms ease;

  &:hover {
    background: ${(props) => props.theme.surfaceHover};
    border-color: ${(props) => props.theme.borderHover};
  }

  &:active {
    transform: scale(0.99);
  }

  &:focus {
    box-shadow:
      0 0 0 3px ${(props) => props.theme.primaryAlpha},
      0 0 0 1px ${(props) => props.theme.primaryAlpha} inset;
    outline: none;
  }
`;

const SelectableButton = styled(BaseButton) <{ $isSelected: boolean }>`
  background: ${(props) => (props.$isSelected ? props.theme.primaryAnchor : props.theme.surface)};
  border-color: ${(props) => (props.$isSelected ? props.theme.primary : props.theme.border)};
  box-shadow: ${(props) => (props.$isSelected ? `0 0 0 1px ${props.theme.primaryAlpha}` : "none")};

  &:hover {
    background: ${(props) => (props.$isSelected ? props.theme.primaryAnchor : props.theme.surfaceHover)};
    border-color: ${(props) => (props.$isSelected ? props.theme.primary : props.theme.borderHover)};
  }

  &:focus {
    box-shadow: ${(props) => (props.$isSelected ? `0 0 0 1px ${props.theme.primaryAlpha}` : `0 0 0 3px ${props.theme.primaryAlpha}, 0 0 0 1px ${props.theme.primaryAlpha} inset`)};
  }
`;

const ButtonContent = styled.span`
  display: grid;
  grid-template-columns: max-content 1fr;
  align-items: center;
  gap: 10px;
`;

const SelectionIndicator = styled.span<{ $isSelected: boolean }>`
  width: 4px;
  height: 14px;
  border-radius: 999px;
  background: ${(props) =>
    props.$isSelected
      ? props.theme.primary
      : props.theme.borderHover};
`;

const ChevronIndicator = styled.span<{ $isSelected: boolean }>`
  font-size: 14px;
  color: ${(props) =>
    props.$isSelected
      ? props.theme.textPrimary
      : props.theme.textMuted};
  transform: ${(props) => (props.$isSelected ? "translateX(0)" : "translateX(-2px)")};
  transition: transform 120ms ease, color 120ms ease;
`;

interface BodyAreasSectionProps {
  // No props needed, uses context instead
}

export const BodyAreasSection: React.FC<BodyAreasSectionProps> = () => {
  const { selectedArea, setSelectedArea, controlsRef } = useModel3D();
  const { setSidebarTab } = useHotspotEditor();

  useEffect(() => {
    setSidebarTab("select-areas");
  }, [setSidebarTab]);

  useEffect(() => {
    if (selectedArea && controlsRef?.current) {
      gsap.to(controlsRef.current.object.position, {
        x: selectedArea.position[0],
        y: selectedArea.position[1],
        z: selectedArea.position[2],
        duration: 1,
      });
      gsap.to(controlsRef.current.target, {
        x: selectedArea.target[0],
        y: selectedArea.target[1],
        z: selectedArea.target[2],
        duration: 1,
        onUpdate: () => controlsRef.current.update(),
      });
    }
  }, [selectedArea, controlsRef]);

  return (
    <AreaList>
      {PHYSIOLOGY_AREAS.map((area) => {
        const isSelected = selectedArea?.name === area.name;

        return (
          <SelectableButton
            key={area.name}
            $isSelected={isSelected}
            onClick={() => setSelectedArea(area)}
            aria-pressed={isSelected}
          >
            <ButtonContent>
              <SelectionIndicator aria-hidden $isSelected={isSelected} />
              <span>{area.name}</span>
            </ButtonContent>

            <ChevronIndicator aria-hidden $isSelected={isSelected}>
              ›
            </ChevronIndicator>
          </SelectableButton>
        );
      })}
    </AreaList>
  );
};
