import React from "react";
import { createPlugin, useInputContext, Components } from "leva/plugin";
import { FrequencyInput } from "@n-apt/components/ui/FrequencyInput";

const FrequencyComponent = () => {
  const { label, value, onUpdate, id } = useInputContext<any>();
  const { Row, Label } = Components;
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  return (
    <div style={{ position: "relative", zIndex: isMenuOpen ? 100000 : 1 }}>
      <Row input>
        <Label>{label}</Label>
        <div
          style={{ flex: 1, display: "flex", overflow: "visible" }}
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
        </div>
      </Row>
    </div>
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
