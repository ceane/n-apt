import React from "react";
import styled from "styled-components";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";
import { Row } from "@n-apt/components/ui";

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: 2px;
  margin-bottom: 24px;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1.5rem;
  margin-bottom: 12px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: 1 / -1;
`;

const SettingInput = styled.input`
  background-color: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 8px;
  min-width: 140px;
  text-align: right;
  transition: all 0.2s ease;

  &:hover {
    border-color: rgba(255, 255, 255, 0.15);
  }

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.primary}0d;
  }
`;

const SettingSelect = styled.select`
  background-color: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 8px;
  min-width: 140px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 10px;
  padding-right: 28px;
  text-align-last: right;
  transition: all 0.2s ease;

  &:hover {
    border-color: rgba(255, 255, 255, 0.15);
  }

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.primary}0d;
  }

  option {
    background-color: #1a1a1a;
    color: #ccc;
  }
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
  grid-column: 1 / -1;

  ${(props) => {
    switch (props.$variant) {
      case "primary":
        return `
          background-color: ${props.theme.primary};
          color: #000;
          &:hover {
            opacity: 0.9;
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
  grid-column: 1 / -1;
  display: grid;
  gap: 8px;
`;

const HotspotItem = styled.div<{ $selected: boolean }>`
  background-color: ${(props) => (props.$selected ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.03)")};
  border: 1px solid ${(props) => (props.$selected ? props.theme.primary : "rgba(255, 255, 255, 0.08)")};
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.15);
  }
`;

const HotspotName = styled.div`
  color: #ccc;
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 4px;
`;

const HotspotPosition = styled.div`
  color: #666;
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
`;

const DeleteButton = styled.button`
  margin-top: 8px;
  padding: 4px 8px;
  background-color: rgba(255, 68, 68, 0.1);
  border: 1px solid rgba(255, 68, 68, 0.2);
  color: #ff4444;
  border-radius: 4px;
  cursor: pointer;
  font-size: 10px;
  font-family: "JetBrains Mono", monospace;
  transition: all 0.2s ease;

  &:hover {
    background-color: rgba(255, 68, 68, 0.2);
    border-color: rgba(255, 68, 68, 0.3);
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
      <FormGrid>
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

        <Row label="Multi-Select">
          <input
            type="checkbox"
            style={{ accentColor: "var(--primary-color, #00d4ff)" }}
            checked={isMultiSelectMode}
            onChange={(e) => setIsMultiSelectMode(e.target.checked)}
          />
        </Row>

        {isMultiSelectMode && (
          <div
            style={{
              marginLeft: "12px",
              marginBottom: "8px",
              color: "#666",
              fontFamily: "JetBrains Mono",
              fontSize: "10px",
              gridColumn: "1 / -1",
            }}
          >
            Selected: {multiSelectedHotspots.length}
          </div>
        )}

        <Row label="Show Grid">
          <input
            type="checkbox"
            style={{ accentColor: "var(--primary-color, #00d4ff)" }}
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
        </Row>
      </FormGrid>

      <FormGrid>
        <SectionTitle>Actions</SectionTitle>
        {isMultiSelectMode && multiSelectedHotspots.length > 0 && (
          <Button $variant="warning" onClick={handleDeleteSelected}>
            Delete Selected ({multiSelectedHotspots.length})
          </Button>
        )}
        <Button $variant="danger" onClick={handleClear}>
          Clear All
        </Button>
      </FormGrid>

      <FormGrid>
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
      </FormGrid>
    </>
  );
};
