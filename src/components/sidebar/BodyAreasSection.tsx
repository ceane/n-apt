import React, { useEffect } from "react";
import styled from "styled-components";
import { gsap } from "gsap";
import { useModel3D } from "@n-apt/hooks/useModel3D";

type Area = {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  meshName: string;
};

const areas: Area[] = [
  {
    name: "Head",
    position: [-0.005256929115666855, 1.888884291818077, 0.6546510577135781],
    target: [-0.0001, 1.91, 0.0196510577135781],
    meshName: "o_ADBody",
  },
  {
    name: "Face",
    position: [-0.005256929115666855, 1.888884291818077, 0.6546510577135781],
    target: [-0.005256929115666855, 1.888884291818077, 0.1546510577135781],
    meshName: "o_ADBody",
  },
  {
    name: "Throat",
    position: [0.007886413129995381, 1.7673426681304798, 0.3609346531290654],
    target: [0.007886413129995381, 1.7673426681304798, 0.0609346531290654],
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
    position: [-0.0058183104165016875, 1.047481566553317, -0.61793005855546879],
    target: [-0.0058183104165016875, 1.047481566553317, -0.11793005855546879],
    meshName: "o_ADBody",
  },
  {
    name: "Ears (Left)",
    position: [-0.08594598979516654, 1.8953312879510087, 0.521125019930469335],
    target: [-0.08594598979516654, 1.8953312879510087, 0.021125019930469335],
    meshName: "o_ADBody",
  },
  {
    name: "Ears (Right)",
    position: [0.08594598979516654, 1.8953312879510087, 0.521125019930469335],
    target: [0.08594598979516654, 1.8953312879510087, 0.021125019930469335],
    meshName: "o_ADBody",
  },
];

const AreaList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 4px;
  box-sizing: border-box;
`;

const BaseButton = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
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
    background: rgba(255,255,255,0.10);
    border-color: rgba(255,255,255,0.18);
  }

  &:active {
    transform: scale(0.99);
  }

  &:focus {
    box-shadow: 0 0 0 3px rgba(123, 97, 255, 0.35), 0 0 0 1px rgba(123, 97, 255, 0.35) inset;
    outline: none;
  }
`;

const SelectableButton = styled(BaseButton) <{ $isSelected: boolean }>`
  background: ${(props) => (props.$isSelected ? "rgba(123, 97, 255, 0.22)" : "rgba(255,255,255,0.06)")};
  border-color: ${(props) => (props.$isSelected ? "rgba(123, 97, 255, 0.55)" : "rgba(255,255,255,0.10)")};
  box-shadow: ${(props) => (props.$isSelected ? "0 0 0 1px rgba(123, 97, 255, 0.25)" : "none")};

  &:hover {
    background: ${(props) => (props.$isSelected ? "rgba(123, 97, 255, 0.28)" : "rgba(255,255,255,0.10)")};
    border-color: ${(props) => (props.$isSelected ? "rgba(123, 97, 255, 0.65)" : "rgba(255,255,255,0.18)")};
  }

  &:focus {
    box-shadow: ${(props) => (props.$isSelected ? "0 0 0 1px rgba(123, 97, 255, 0.25)" : "0 0 0 3px rgba(123, 97, 255, 0.35), 0 0 0 1px rgba(123, 97, 255, 0.35) inset")};
  }
`;

interface BodyAreasSectionProps {
  // No props needed, uses context instead
}

export const BodyAreasSection: React.FC<BodyAreasSectionProps> = () => {
  const { selectedArea, setSelectedArea, controlsRef } = useModel3D();

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
      {areas.map((area) => {
        const isSelected = selectedArea?.name === area.name;

        return (
          <SelectableButton
            key={area.name}
            $isSelected={isSelected}
            onClick={() => setSelectedArea(area)}
            aria-pressed={isSelected}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                aria-hidden
                style={{
                  width: "4px",
                  height: "14px",
                  borderRadius: "999px",
                  background: isSelected
                    ? "rgba(123, 97, 255, 0.95)"
                    : "rgba(255,255,255,0.18)",
                }}
              />
              <span>{area.name}</span>
            </span>

            <span
              aria-hidden
              style={{
                fontSize: "14px",
                color: isSelected ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
                transform: isSelected ? "translateX(0)" : "translateX(-2px)",
                transition: "transform 120ms ease, color 120ms ease",
              }}
            >
              ›
            </span>
          </SelectableButton>
        );
      })}
    </AreaList>
  );
};
