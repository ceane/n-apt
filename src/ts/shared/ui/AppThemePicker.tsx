import React, { useEffect, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import { Radio } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { setAppMode, type AppMode } from "@n-apt/redux/slices/themeSlice";

/** Matches the auth screen theme pill entrance. */
const pillDropIntro = keyframes`
  0% {
    transform: translateY(-18px) scale(0.92);
  }
  18% {
    transform: translateY(0) scale(1.08);
  }
  30% {
    transform: translateY(1px) scale(0.98);
  }
  42% {
    transform: translateY(0) scale(1.01);
  }
  58% {
    transform: translateY(0) scale(1);
  }
  72% {
    transform: translateY(0) scale(1);
  }
  100% {
    transform: translateY(0) scale(1);
  }
`;

const PickerBar = styled.div<{ $floating?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 4px;
  border-radius: 999px;
  background: ${(props) => props.theme.surface ?? "rgba(255, 255, 255, 0.04)"};
  border: 1px solid ${(props) => props.theme.border};
  backdrop-filter: blur(10px);
  overflow: hidden;
  transform-origin: center center;
  perspective: 800px;
  width: fit-content;
  max-width: 100%;
  box-sizing: border-box;

  ${(props) =>
    props.$floating &&
    css`
      position: absolute;
      top: 24px;
      left: 24px;
      z-index: 35;
      animation: ${pillDropIntro} 0.7s ease-in-out 1;
      animation-fill-mode: forwards;
    `}
`;

const ThemeRevealButton = styled.button`
  appearance: none;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  cursor: pointer;
  padding: 6px 12px 6px 6px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  transition: color 0.18s ease;

  &:hover {
    color: ${(props) => props.theme.textPrimary};
  }
`;

const ThemeControls = styled.div<{ $expanded: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: ${(props) => (props.$expanded ? "360px" : "0px")};
  opacity: ${(props) => (props.$expanded ? 1 : 0)};
  transform: ${(props) =>
    props.$expanded ? "translateX(0) scale(1)" : "translateX(-8px) scale(0.96)"};
  overflow: hidden;
  transition:
    max-width 0.32s cubic-bezier(0.34, 1.25, 0.64, 1),
    opacity 0.22s ease,
    transform 0.32s cubic-bezier(0.34, 1.25, 0.64, 1);
  pointer-events: ${(props) => (props.$expanded ? "auto" : "none")};
`;

const ModeButton = styled.button<{ $active?: boolean }>`
  appearance: none;
  border: 0;
  border-radius: 999px;
  padding: 6px 10px;
  white-space: nowrap;
  background: ${(props) =>
    props.$active ? props.theme.primary : "transparent"};
  color: ${(props) =>
    props.$active ? props.theme.background : props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    color: ${(props) => props.theme.textPrimary};
    background: ${(props) =>
      props.$active ? props.theme.primary : props.theme.surfaceHover};
  }
`;

export interface AppThemePickerProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  placement?: "floating" | "inline";
  autoIntroExpand?: boolean;
  className?: string;
}

/**
 * Shared theme mode picker (System / Light / Dark). Use {@link AppThemePicker}
 * when wired to Redux; pass mode/onModeChange for isolated surfaces (e.g. auth).
 */
export const AppThemePickerUI: React.FC<AppThemePickerProps> = ({
  mode,
  onModeChange,
  placement = "inline",
  autoIntroExpand = false,
  className,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [introExpanded, setIntroExpanded] = useState(autoIntroExpand);

  useEffect(() => {
    if (!autoIntroExpand) {
      return;
    }
    const id = window.setTimeout(() => setIntroExpanded(false), 750);
    return () => window.clearTimeout(id);
  }, [autoIntroExpand]);

  const isExpanded = expanded || introExpanded;

  return (
    <PickerBar
      $floating={placement === "floating"}
      className={className}
      aria-label="Theme mode"
    >
      <ThemeRevealButton
        type="button"
        onClick={() => {
          setIntroExpanded(false);
          setExpanded((value) => !value);
        }}
        aria-expanded={isExpanded}
        aria-label={
          isExpanded ? "Collapse theme picker" : "Expand theme picker"
        }
      >
        <Radio size={12} strokeWidth={2} aria-hidden="true" />
        <span>Theme</span>
        <span>{isExpanded ? "x" : ">"}</span>
      </ThemeRevealButton>
      <ThemeControls $expanded={isExpanded}>
        <ModeButton
          type="button"
          $active={mode === "system"}
          onClick={() => onModeChange("system")}
        >
          System
        </ModeButton>
        <ModeButton
          type="button"
          $active={mode === "light"}
          onClick={() => onModeChange("light")}
        >
          Light
        </ModeButton>
        <ModeButton
          type="button"
          $active={mode === "dark"}
          onClick={() => onModeChange("dark")}
        >
          Dark
        </ModeButton>
      </ThemeControls>
    </PickerBar>
  );
};

export type ConnectedAppThemePickerProps = Omit<
  AppThemePickerProps,
  "mode" | "onModeChange"
>;

/** Theme picker bound to Redux `theme.appMode`. */
export const AppThemePicker: React.FC<ConnectedAppThemePickerProps> = (
  props,
) => {
  const dispatch = useAppDispatch();
  const appMode = useAppSelector((state) => state.theme.appMode);

  return (
    <AppThemePickerUI
      {...props}
      mode={appMode}
      onModeChange={(nextMode) => dispatch(setAppMode(nextMode))}
    />
  );
};

/** @deprecated Use {@link AppThemePickerUI} — kept for auth local theme state. */
export const ThemePicker = AppThemePickerUI;

export default AppThemePicker;
