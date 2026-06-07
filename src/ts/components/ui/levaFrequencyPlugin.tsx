import React from "react";
import { createPlugin, useInputContext, Components } from "leva/plugin";
import { FrequencyInput } from "@n-apt/components/ui/FrequencyInput";

const FrequencyComponent = () => {
  const { label, value, onUpdate, id } = useInputContext<any>();
  const { Row, Label } = Components;

  return (
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
        />
      </div>
    </Row>
  );
};

export const levaFrequency = createPlugin({
  component: FrequencyComponent,
  normalize: (input: any) => {
    return { value: Number(input) };
  },
});
