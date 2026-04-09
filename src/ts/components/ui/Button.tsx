import styled from "styled-components";

const spin = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

export const Button = styled.button<{ $variant?: "primary" | "secondary" | "danger" }>`
  ${spin}
  font-family: ${(props) => props.theme?.typography?.mono ?? "monospace"};
  font-size: 12px;
  font-weight: 500;
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  white-space: nowrap;
  position: relative;
  overflow: hidden;

  .animate-spin {
    animation: spin 1s linear infinite;
  }

  ${(props) => {
    const { $variant = "secondary", theme } = props;
    const primary = theme?.primary || "#00d4ff";
    const danger = theme?.danger || "#ff4444";
    const surface = theme?.surface || "#1a1a1a";
    const border = theme?.border || "#2a2a2a";
    const textPrimary = theme?.textPrimary || "#ffffff";

    switch ($variant) {
      case "primary":
        return `
          background-color: ${surface};
          border: 1px solid ${primary};
          color: ${textPrimary};
          
          &:hover {
            background-color: ${primary}1a;
            box-shadow: 0 0 15px ${primary}22;
          }
        `;
      case "danger":
        return `
          background-color: ${surface};
          border: 1px solid ${danger};
          color: ${danger};
          
          &:hover {
            background-color: ${danger}1a;
            color: ${textPrimary};
            box-shadow: 0 0 15px ${danger}22;
          }
        `;
      case "secondary":
      default:
        return `
          background-color: ${surface};
          border: 1px solid ${border};
          color: ${textPrimary};
          
          &:hover {
            border-color: ${primary};
            color: ${primary};
            background-color: ${primary}0d;
          }
        `;
    }
  }}

  &:active {
    transform: scale(0.97);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    filter: grayscale(0.5);
    pointer-events: none;
  }
`;

export default Button;
