import React from "react";
import styled from "styled-components";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";
import { Row } from "@n-apt/components/ui";
import { RowContainer, RowLabel, RowControl } from "@n-apt/components/ui/Row";
import { Pencil, Tag } from "lucide-react";

const StyledRow = styled(Row)`
  &.clean-row {
    background-color: transparent !important;
    border: none !important;
    padding: 4px 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;

    ${RowLabel} {
      padding-left: 0;
      font-weight: 500;
      color: ${(props) => props.theme.textPrimary};
    }

    ${RowControl} {
      padding-right: 0;
    }
  }
`;

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-bottom: 24px;
  grid-column: 1 / -1;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1.5rem;
  margin-bottom: 12px;
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
  grid-column: 1 / -1;
`;

const SettingInput = styled.input`
  background-color: ${(props) => props.theme.surfaceHover};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 500;
  padding: 6px 10px;
  min-width: 140px;
  text-align: right;
  transition: all 0.2s ease;

  &:hover {
    border-color: ${(props) => props.theme.borderHover};
    background-color: ${(props) => props.theme.surface};
  }

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.surface};
    box-shadow: 0 0 0 2px ${(props) => props.theme.primary}33;
  }
`;

const SettingSelect = styled.select`
  background-color: ${(props) => props.theme.surfaceHover};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 500;
  padding: 6px 10px;
  min-width: 140px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 10px;
  padding-right: 28px;
  text-align-last: right;
  transition: all 0.2s ease;

  &:hover {
    border-color: ${(props) => props.theme.borderHover};
    background-color: ${(props) => props.theme.surface};
  }

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.surface};
    box-shadow: 0 0 0 2px ${(props) => props.theme.primary}33;
  }

  option {
    background-color: ${(props) => props.theme.background};
    color: ${(props) => props.theme.textPrimary};
  }
`;

const Button = styled.button<{ $variant?: "primary" | "danger" | "warning" }>`
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  font-family: ${(props) => props.theme.typography.mono};
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
          color: ${props.theme.background};
          &:hover {
            opacity: 0.9;
          }
        `;
      case "danger":
        return `
          background-color: ${props.theme.danger};
          color: ${props.theme.textPrimary};
          &:hover {
            background-color: ${props.theme.danger}cc;
          }
        `;
      case "warning":
        return `
          background-color: ${props.theme.warning};
          color: ${props.theme.background};
          &:hover {
            background-color: ${props.theme.warning}cc;
          }
        `;
      default:
        return `
          background-color: ${props.theme.surfaceHover};
          color: ${props.theme.textPrimary};
          border: 1px solid ${props.theme.borderHover};
          &:hover {
            background-color: ${props.theme.surface};
            border-color: ${props.theme.primary};
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
  background-color: ${(props) => (props.$selected ? props.theme.primaryAnchor : props.theme.surface)};
  border: 1px solid ${(props) => (props.$selected ? props.theme.primary : props.theme.border)};
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: ${(props) => props.theme.surfaceHover};
    border-color: ${(props) => props.theme.borderHover};
  }
`;

const HotspotItemHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
`;

const HotspotName = styled.div`
  color: ${(props) => props.theme.textPrimary};
  font-weight: 600;
  font-size: 12px;
  outline: none;
  padding: 2px 4px;
  border-radius: 4px;
  transition: all 0.2s ease;

  &[contenteditable="true"] {
    background: ${(props) => props.theme.surfaceHover};
    border-bottom: 1px solid ${(props) => props.theme.primary};
    cursor: text;
  }

  &:focus {
    background: ${(props) => props.theme.surfaceHover};
    box-shadow: 0 0 0 2px ${(props) => props.theme.primary}33;
  }
`;

const EditIcon = styled.div<{ $isSelected: boolean }>`
  color: ${(props) => (props.$isSelected ? props.theme.primary : props.theme.textMuted)};
  opacity: ${(props) => (props.$isSelected ? 1 : 0.4)};
  transition: all 0.2s ease;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    color: ${(props) => props.theme.primary};
    opacity: 1;
  }
`;

const CategoryBadge = styled.div<{ $category: string }>`
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 999px;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.5px;
  background: ${(props) => {
    switch (props.$category) {
      case "physiology": return `${props.theme.primary}1a`;
      case "psychology": return `${props.theme.warning}1a`;
      case "effects": return `${props.theme.danger}1a`;
      default: return props.theme.surfaceHover;
    }
  }};
  color: ${(props) => {
    switch (props.$category) {
      case "physiology": return props.theme.primary;
      case "psychology": return props.theme.warning;
      case "effects": return props.theme.danger;
      default: return props.theme.textMuted;
    }
  }};
  border: 1px solid ${(props) => {
    switch (props.$category) {
      case "physiology": return `${props.theme.primary}33`;
      case "psychology": return `${props.theme.warning}33`;
      case "effects": return `${props.theme.danger}33`;
      default: return props.theme.border;
    }
  }};
`;

const HotspotPosition = styled.div`
  color: ${(props) => props.theme.textMuted};
  font-size: 11px;
  font-family: ${(props) => props.theme.typography.mono};
`;

const DeleteButton = styled.button`
  margin-top: 8px;
  padding: 4px 8px;
  background-color: ${(props) => `${props.theme.danger}1a`};
  border: 1px solid ${(props) => `${props.theme.danger}33`};
  color: ${(props) => props.theme.danger};
  border-radius: 4px;
  cursor: pointer;
  font-size: 10px;
  font-family: ${(props) => props.theme.typography.mono};
  transition: all 0.2s ease;

  &:hover {
    background-color: ${(props) => `${props.theme.danger}33`};
    border-color: ${(props) => `${props.theme.danger}4d`};
  }
`;

const InlineHint = styled.div`
  margin-left: 12px;
  margin-bottom: 8px;
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  grid-column: 1 / -1;
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
    handleRename,
    handleClear,
    setSidebarTab,
    currentCategory,
    setCurrentCategory,
  } = useHotspotEditor();

  React.useEffect(() => {
    setSidebarTab("make-hotspots");
  }, [setSidebarTab]);

  return (
    <>
      <FormGrid>
        <StyledRow className="clean-row" label="Point Name">
          <SettingInput
            type="text"
            value={newHotspotName}
            onChange={(e) => setNewHotspotName(e.target.value)}
            placeholder="Enter name..."
          />
        </StyledRow>

        <StyledRow className="clean-row" label="Hotspot Size">
          <SettingSelect
            value={hotspotSize}
            onChange={(e) =>
              setHotspotSize(e.target.value as "small" | "large")
            }
          >
            <option value="small">Small</option>
            <option value="large">Large</option>
          </SettingSelect>
        </StyledRow>

        <StyledRow className="clean-row" label="Symmetry Mode">
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
        </StyledRow>

        <StyledRow className="clean-row" label="Multi-Select">
          <input
            type="checkbox"
            style={{ accentColor: "var(--color-primary)" }}
            checked={isMultiSelectMode}
            onChange={(e) => setIsMultiSelectMode(e.target.checked)}
          />
        </StyledRow>

        {isMultiSelectMode && (
          <InlineHint>
            Selected: {multiSelectedHotspots.length}
          </InlineHint>
        )}

        <StyledRow className="clean-row" label="Show Grid">
          <input
            type="checkbox"
            style={{ accentColor: "var(--color-primary)" }}
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
        </StyledRow>

        <StyledRow className="clean-row" label="Category">
          <SettingSelect
            value={currentCategory}
            onChange={(e) =>
              setCurrentCategory(e.target.value as any)
            }
          >
            <option value="physiology">Physiology</option>
            <option value="psychology">Psychology</option>
            <option value="effects">Effects</option>
          </SettingSelect>
        </StyledRow>
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
          {hotspots.map((hotspot) => {
            const isSelected = selectedHotspot === hotspot.id;
            
            return (
              <HotspotItem
                key={hotspot.id}
                $selected={isSelected}
                onClick={() => handleHotspotClick(hotspot.id)}
              >
                <HotspotItemHeader>
                  <HotspotName
                    contentEditable={isSelected}
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const newName = e.currentTarget.textContent || "";
                      if (newName && newName !== hotspot.name) {
                        handleRename(hotspot.id, newName);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    onClick={(e) => {
                      if (isSelected) {
                        e.stopPropagation();
                      }
                    }}
                  >
                    {hotspot.name}
                  </HotspotName>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <CategoryBadge $category={hotspot.category}>
                      {hotspot.category}
                    </CategoryBadge>
                    <EditIcon $isSelected={isSelected}>
                      <Pencil size={12} />
                    </EditIcon>
                  </div>
                </HotspotItemHeader>
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
            );
          })}
        </HotspotList>
      </FormGrid>
    </>
  );
};
