import React, { useCallback, useRef, useState } from "react";
import styled from "styled-components";

// The address is split into fragments so it never appears as a literal in the
// bundle. It is reassembled at runtime, and only shown while the user presses
// and holds the control (pointer down). Releasing the hold hides it again and
// the fragments are discarded.
const EMAIL_FRAGMENTS = ["broader", ".monik", "er.97@", "icloud", ".com"];

const assembleEmail = (): string => EMAIL_FRAGMENTS.join("");

const RevealButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    background 0.18s ease;

  &:hover {
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
  }
`;

const RevealText = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.primary};
  word-break: break-all;
`;

export const ContactReveal: React.FC = () => {
  const [revealed, setRevealed] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const clearTimeoutRef = useRef<number | null>(null);

  const handlePointerDown = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Brief delay before revealing to avoid accidental flashes.
    timeoutRef.current = window.setTimeout(() => setRevealed(true), 120);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Keep it visible briefly after release so it can be read/copied.
    if (clearTimeoutRef.current) {
      window.clearTimeout(clearTimeoutRef.current);
    }
    clearTimeoutRef.current = window.setTimeout(() => setRevealed(false), 800);
  }, []);

  const handlePointerLeave = handlePointerUp;

  const email = revealed ? assembleEmail() : null;

  return (
    <RevealButton
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      aria-pressed={revealed}
    >
      {revealed && email ? (
        <a
          href={`mailto:${email}`}
          onClick={(event) => event.stopPropagation()}
          style={{ color: "inherit", textDecoration: "none" }}
        >
          <RevealText>{email}</RevealText>
        </a>
      ) : (
        <span>Press &amp; hold to reveal contact</span>
      )}
    </RevealButton>
  );
};

export default ContactReveal;
