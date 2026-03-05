import React from "react";
import styled from "styled-components";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 16px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

import { Row } from "@n-apt/components/ui";

const SettingInput = styled.input`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px;
  min-width: 120px;
  cursor: pointer;

  &:hover {
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background-color: rgba(0, 212, 255, 0.05);
  }
`;

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px;
  min-width: 120px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 2px center;
  background-size: 12px;
  padding-right: 20px;

  &:hover {
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background-color: rgba(0, 212, 255, 0.05);
  }

  option {
    background-color: #1a1a1a;
    color: #ccc;
    font-family: "JetBrains Mono", monospace;
  }
`;

const SettingCheckbox = styled.input`
  cursor: pointer;
`;

const Button = styled.button<{ $variant?: "primary" | "danger" | "warning" }>`
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 8px;

  ${(props) => {
    switch (props.$variant) {
      case "primary":
        return `
          background-color: #00d4ff;
          color: #000;
          &:hover {
            background-color: #00b8e6;
          }
        `;
      case "danger":
        return `
          background-color: #ff4444;
          color: #fff;
          &:hover {
            background-color: #ff6666;
          }
        `;
      case "warning":
        return `
          background-color: #ff6b6b;
          color: #fff;
          &:hover {
            background-color: #ff8888;
          }
        `;
      default:
        return `
          background-color: #2a2a2a;
          color: #ccc;
          border: 1px solid #444;
          &:hover {
            background-color: #333;
            border-color: #555;
          }
        `;
    }
  }}
`;

const HotspotList = styled.div`
  max-height: 300px;
  overflow-y: auto;
  margin-top: 16px;
`;

const HotspotItem = styled.div<{ $selected: boolean }>`
  background-color: ${(props) => (props.$selected ? "#2a2a2a" : "#1a1a1a")};
  border: 1px solid ${(props) => (props.$selected ? "#00d4ff" : "#333")};
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: #252525;
    border-color: #444;
  }
`;

const HotspotName = styled.div`
  color: #ccc;
  font-weight: bold;
  font-size: 12px;
  margin-bottom: 4px;
`;

const HotspotPosition = styled.div`
  color: #666;
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
`;

const DeleteButton = styled.button`
  margin-top: 4px;
  padding: 4px 8px;
  background-color: #ff4444;
  border: none;
  color: #fff;
  border-radius: 2px;
  cursor: pointer;
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: #ff6666;
  }
`;

export const HotspotEditorSection: React.FC = () => {
  const {
    hotspots,
    selectedHotspot,
    newHotspotName,
    setNewHotspotName,
    symmetryMode,
    setSymmetryMode,
    showGrid,
    setShowGrid,
    hotspotSize,
    setHotspotSize,
    isMultiSelectMode,
    setIsMultiSelectMode,
    multiSelectedHotspots,
    handleDeleteHotspot,
    handleDeleteSelected,
    handleHotspotClick,
    handleClear,
  } = useHotspotEditor();

  return (
    <>
      <Section>
        <SectionTitle>Hotspot Creator</SectionTitle>

        <Row label="Point Name">
          <SettingInput
            type="text"
            value={newHotspotName}
            onChange={(e) => setNewHotspotName(e.target.value)}
            placeholder="Enter name..."
          />
        </Row>

        <Row label="Hotspot Size">
          <SettingSelect
            value={hotspotSize}
            onChange={(e) =>
              setHotspotSize(e.target.value as "small" | "large")
            }
          >
            <option value="small">Small</option>
            <option value="large">Large</option>
          </SettingSelect>
        </Row>

        <Row label="Symmetry Mode">
          <SettingSelect
            value={symmetryMode}
            onChange={(e) =>
              setSymmetryMode(e.target.value as "none" | "x" | "y")
            }
          >
            <option value="none">None</option>
            <option value="x">Left/Right</option>
            <option value="y">Top/Bottom</option>
          </SettingSelect>
        </Row>

        <Row label="Multi-Select Mode">
          <SettingCheckbox
            type="checkbox"
            checked={isMultiSelectMode}
            onChange={(e) => {
              setIsMultiSelectMode(e.target.checked);
            }}
          />
        </Row>

        {isMultiSelectMode && (
          <div
            style={{
              marginLeft: "12px",
              marginBottom: "16px",
              color: "#666",
              fontSize: "11px",
            }}
          >
            Selected: {multiSelectedHotspots.length} hotspots
          </div>
        )}

        <Row label="Show Grid">
          <SettingCheckbox
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
        </Row>
      </Section>

      <Section>
        <SectionTitle>Actions</SectionTitle>

        {isMultiSelectMode && multiSelectedHotspots.length > 0 && (
          <Button $variant="warning" onClick={handleDeleteSelected}>
            Delete Selected ({multiSelectedHotspots.length})
          </Button>
        )}

        <Button $variant="danger" onClick={handleClear}>
          Clear All
        </Button>
      </Section>

      <Section>
        <SectionTitle>Hotspots ({hotspots.length})</SectionTitle>

        <HotspotList>
          {hotspots.map((hotspot) => (
            <HotspotItem
              key={hotspot.id}
              $selected={selectedHotspot === hotspot.id}
              onClick={() => handleHotspotClick(hotspot.id)}
            >
              <HotspotName>{hotspot.name}</HotspotName>
              <HotspotPosition>
                [{hotspot.position.map((v) => v.toFixed(2)).join(", ")}]
              </HotspotPosition>
              <DeleteButton
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteHotspot(hotspot.id);
                }}
              >
                Delete
              </DeleteButton>
            </HotspotItem>
          ))}
        </HotspotList>
      </Section>
    </>
  );
};
