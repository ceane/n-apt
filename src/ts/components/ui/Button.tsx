import styled from "styled-components";

export const Button = styled.button<{ $variant?: "primary" | "secondary" | "danger" }>`
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 600;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  white-space: nowrap;

  ${({ $variant = "secondary" }) => {
    switch ($variant) {
      case "primary":
        return `
          background-color: ${(props: any) => props.theme.primary};
          border: 1px solid rgba(0,0,0,0.2);
          color: white;
          &:hover {
            filter: brightness(1.1);
          }
        `;
      case "danger":
        return `
          background-color: #ff4444;
          border: 1px solid transparent;
          color: white;
          &:hover {
            background-color: #ff6666;
          }
        `;
      case "secondary":
      default:
        return `
          background-color: #212121;
          border: 1px solid #333;
          color: #ccc;
          &:hover {
            border-color: ${(props: any) => props.theme.primary};
            color: #fff;
          }
        `;
    }
  }}

  &:active {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
`;

export default Button;
