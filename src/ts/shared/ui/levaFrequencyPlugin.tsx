import React from "react";
import styled from "styled-components";
import { createPlugin, useInputContext, Components } from "leva/plugin";
import { FrequencyInput } from "./FrequencyInput";

const PluginWrapper = styled.div<{ $isMenuOpen: boolean }>`
  position: relative;
  z-index: ${(props) => (props.$isMenuOpen ? 100000 : 1)};
`;

const InputWrapper = styled.div`
  flex: 1;
  display: flex;
  overflow: visible;
`;

const FrequencyComponent = () => {
  const { label, value, onUpdate, id } = useInputContext<any>();
  const { Row, Label } = Components;
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  return (
    <PluginWrapper $isMenuOpen={isMenuOpen}>
      <Row input>
        <Label>{label}</Label>
        <InputWrapper
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <FrequencyInput
            valueHz={value}
            onChangeHz={onUpdate}
            id={id}
            stepHz={1_000_000} // Set step to 1 MHz instead of auto 1 GHz jumps
            onMenuOpenChange={setIsMenuOpen}
          />
        </InputWrapper>
      </Row>
    </PluginWrapper>
  );
};

const isDev = typeof window !== "undefined";

export const levaFrequency: any =
  isDev && (window as any).__LEVA_FREQUENCY_PLUGIN__
    ? (window as any).__LEVA_FREQUENCY_PLUGIN__
    : (() => {
        const plugin = createPlugin({
          component: FrequencyComponent,
          normalize: (input: any) => {
            return { value: Number(input) };
          },
        });
        if (isDev) {
          (window as any).__LEVA_FREQUENCY_PLUGIN__ = plugin;
        }
        return plugin;
      })();
