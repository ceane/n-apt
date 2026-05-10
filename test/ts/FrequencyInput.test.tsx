import React, { useState } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { FrequencyInput } from "../../src/ts/components/ui/FrequencyInput";

const theme = {
  colors: {
    surface: "#1a1a1a",
    border: "#333333",
    primary: "#00d4ff",
    textPrimary: "#ffffff",
    textMuted: "#aaaaaa",
  },
  typography: {
    mono: "monospace",
  },
};

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={theme as any}>{children}</ThemeProvider>
);

const ControlledFrequencyInput: React.FC<any> = (props) => {
  const [val, setVal] = useState(props.valueHz);
  return (
    <TestWrapper>
      <FrequencyInput {...props} valueHz={val} onChangeHz={(newVal: number) => {
        setVal(newVal);
        props.onChangeHz?.(newVal);
      }} />
    </TestWrapper>
  );
};

describe("FrequencyInput", () => {
  it("renders with initial value and correct optimal unit", () => {
    render(<ControlledFrequencyInput valueHz={1500000} />);
    expect(screen.getByDisplayValue("1.500")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("MHz");
  });

  it("calls onChangeHz when typing", () => {
    const onChange = jest.fn();
    render(<ControlledFrequencyInput valueHz={1000000} onChangeHz={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(onChange).toHaveBeenCalledWith(2500000);
  });

  it("adjusts value with arrow keys using unit-aware steps", async () => {
    const onChange = jest.fn();
    render(<ControlledFrequencyInput valueHz={1000000} onChangeHz={onChange} />);
    const input = screen.getByRole("textbox");
    
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith(2000000);
    await waitFor(() => {
      expect(screen.getByDisplayValue("2.000")).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith(1000000);
    await waitFor(() => {
      expect(screen.getByDisplayValue("1.000")).toBeInTheDocument();
    });
  });

  it("respects minHz boundary and caps correctly", async () => {
    const onChange = jest.fn();
    render(<ControlledFrequencyInput valueHz={2000000} onChangeHz={onChange} minHz={1600000} />);
    const input = screen.getByRole("textbox");
    
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith(1600000);
    await waitFor(() => {
      expect(screen.getByDisplayValue("1.600")).toBeInTheDocument();
    });
  });

  it("respects maxHz boundary", async () => {
    const onChange = jest.fn();
    render(<ControlledFrequencyInput valueHz={100} onChangeHz={onChange} maxHz={1000} />);
    const input = screen.getByRole("textbox");
    
    // Type 2000 Hz while unit is Hz
    fireEvent.change(input, { target: { value: "2000" } });
    expect(onChange).toHaveBeenCalledWith(1000);
    
    fireEvent.blur(input);
    // 1000 Hz -> 1.000 kHz in getOptimalUnit
    await waitFor(() => {
      expect(screen.getByDisplayValue("1.000")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toHaveValue("kHz");
    });
  });

  it("caps GHz typing at maxHz and updates the input display immediately", async () => {
    const onChange = jest.fn();
    render(
      <ControlledFrequencyInput
        valueHz={29_000_000_000}
        onChangeHz={onChange}
        maxHz={30_000_000_000}
      />,
    );
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "38.000" } });
    expect(onChange).toHaveBeenLastCalledWith(30_000_000_000);
    await waitFor(() => {
      expect(screen.getByDisplayValue("30.000")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toHaveValue("GHz");
    });
  });

  it("does not step above maxHz with arrow keys in GHz", () => {
    const onChange = jest.fn();
    render(
      <ControlledFrequencyInput
        valueHz={30_000_000_000}
        onChangeHz={onChange}
        maxHz={30_000_000_000}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith(30_000_000_000);
    expect(screen.getByDisplayValue("30.000")).toBeInTheDocument();
  });

  it("clamps an out-of-range valueHz from the parent on mount", async () => {
    const onChange = jest.fn();
    render(
      <ControlledFrequencyInput
        valueHz={38_000_000_000}
        onChangeHz={onChange}
        maxHz={30_000_000_000}
        minHz={1_600_000}
      />,
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(30_000_000_000);
      expect(screen.getByDisplayValue("30.000")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toHaveValue("GHz");
    });
  });

  it("uses hzRef so consecutive arrow downs respect minHz before parent re-renders", async () => {
    const onChange = jest.fn();
    render(
      <ControlledFrequencyInput
        valueHz={2_000_000}
        onChangeHz={onChange}
        minHz={1_600_000}
      />,
    );
    const input = screen.getByRole("textbox");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(onChange.mock.calls).toEqual([[1_600_000], [1_600_000]]);
    await waitFor(() => {
      expect(screen.getByDisplayValue("1.600")).toBeInTheDocument();
    });
  });

  it("recalculates display value when unit is changed", () => {
    render(<ControlledFrequencyInput valueHz={1500} />);
    expect(screen.getByDisplayValue("1.500")).toBeInTheDocument();
    
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "Hz" } });
    
    expect(screen.getByDisplayValue("1500.000")).toBeInTheDocument();
  });

  it("does not pad decimals from parent updates while the field is focused", () => {
    render(<ControlledFrequencyInput valueHz={1_000_000} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2" } });
    expect(input.value).toBe("2");

    fireEvent.change(input, { target: { value: "2.5" } });
    expect(input.value).toBe("2.5");

    fireEvent.blur(input);
    expect(input.value).toBe("2.500");
  });
});
