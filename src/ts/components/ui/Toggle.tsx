import styled from "styled-components";

export const Toggle = styled.button<{ $active: boolean }>`
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  white-space: nowrap;
  padding: 6px 4px;
  border-radius: 8px;
  border: 1px solid ${({ $active }) => ($active ? "rgba(0,0,0,0.2)" : "#333")};
  background: ${({ $active, theme }) =>
    $active ? theme.primary : "#212121"};
  color: ${({ $active }) => ($active ? "#fff" : "#888")};
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
  text-align: center;

  &:hover {
    background: ${({ $active, theme }) =>
    $active ? theme.primary : "#2a2a2a"};
    filter: brightness(1.1);
    color: ${({ $active }) => ($active ? "#fff" : "#aaa")};
  }

  &:active {
    transform: scale(0.96);
  }
`;

export default Toggle;
