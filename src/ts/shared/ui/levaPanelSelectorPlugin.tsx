import React, { useEffect } from "react";
import { createPlugin, useInputContext, Components } from "leva/plugin";
import { styled } from "styled-components";

const PanelContainer = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px 0;
  margin: 2px 0;
`;

const PanelButton = styled.button<{ $active: boolean }>`
  background: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.surface};
  color: ${({ theme, $active }) =>
    $active ? "#fff" : theme.colors.textSecondary};
  border: 1px solid
    ${({ theme, $active }) =>
      $active ? theme.colors.primary : theme.colors.border};
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
  cursor: pointer;
  font-family: ${({ theme }) => theme.typography?.mono || "monospace"};
  transition: all 0.1s ease;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
  }

  &:active {
    transform: scale(0.96);
  }
`;

const PanelComponent = () => {
  const { label, value, onUpdate, settings } = useInputContext<any>();
  const { Row, Label } = Components;
  const count = settings.count || 1;

  // value is an array of booleans, e.g., [true, true, true]
  const activeState = Array.isArray(value) ? value : Array(count).fill(true);

  // If count changes, ensure activeState matches count length.
  useEffect(() => {
    if (activeState.length !== count) {
      const nextState = settings.initialValue || Array(count).fill(true);
      onUpdate(nextState);
    }
  }, [count, activeState.length, onUpdate, settings.initialValue]);

  const togglePanel = (index: number) => {
    const next = [...activeState];
    next[index] = !next[index];
    onUpdate(next);
  };

  return (
    <Row input>
      <Label>{label}</Label>
      <PanelContainer>
        {Array.from({ length: count }).map((_, i) => {
          const isActive = activeState[i] ?? true;
          const buttonLabel =
            settings.labels && settings.labels[i]
              ? settings.labels[i]
              : `Panel ${i + 1}`;
          return (
            <PanelButton
              key={i}
              $active={isActive}
              onClick={() => togglePanel(i)}
            >
              {buttonLabel}
            </PanelButton>
          );
        })}
      </PanelContainer>
    </Row>
  );
};

const isDev = typeof window !== "undefined";

export const levaPanelSelector: any =
  isDev && (window as any).__LEVA_PANEL_PLUGIN__
    ? (window as any).__LEVA_PANEL_PLUGIN__
    : (() => {
        const plugin = createPlugin({
          component: PanelComponent,
          normalize: (input: any) => {
            const count = input.count || 1;
            const initialValue = input.initialValue || Array(count).fill(true);
            const value = input.value || initialValue;
            return {
              value,
              settings: { count, labels: input.labels, initialValue },
            };
          },
        });
        if (isDev) {
          (window as any).__LEVA_PANEL_PLUGIN__ = plugin;
        }
        return plugin;
      })();
