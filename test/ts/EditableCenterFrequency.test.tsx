import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { EditableCenterFrequency } from "@n-apt/ui/EditableCenterFrequency";

const theme = {
  colors: {
    surface: "#1a1a1a",
    border: "#333333",
    primary: "#00d4ff",
    textPrimary: "#ffffff",
    textSecondary: "#aaaaaa",
    textMuted: "#888888",
  },
  typography: {
    mono: "monospace",
  },
};

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={theme as any}>{children}</ThemeProvider>
);

describe("EditableCenterFrequency", () => {
  it("corrects the center so the window edge sits at the spectrum ceiling", () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={844_036_300}
          onCenterFrequencyChange={onChange}
          onClose={onClose}
          windowSpanHz={20_000_000}
        />
      </Wrapper>,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "30000" } });
    fireEvent.blur(input);

    // Entering the 30 GHz cap must land the upper *edge* on the cap.
    expect(onChange).toHaveBeenCalledWith(29_990_000_000);
    expect(onClose).toHaveBeenCalled();
  });

  it("corrects a mirrored negative ceiling entry symmetrically", () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={-100_000_000}
          onCenterFrequencyChange={onChange}
          onClose={onClose}
          allowNegativeFrequencies
          windowSpanHz={20_000_000}
        />
      </Wrapper>,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "-30000" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(-29_990_000_000);
    expect(onClose).toHaveBeenCalled();
  });

  it("commits on blur", () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={844_036_300}
          onCenterFrequencyChange={onChange}
          onClose={onClose}
        />
      </Wrapper>,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "845.000" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(845_000_000);
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the selected unit for the base when an arithmetic offset has a suffix", () => {
    const onChange = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={1_600_000}
          onCenterFrequencyChange={onChange}
          onClose={jest.fn()}
        />
      </Wrapper>,
    );

    const input = screen.getByRole("textbox");
    const unitButton = screen.getByRole("button", { name: "Frequency unit" });
    fireEvent.change(input, { target: { value: "1.6+300k" } });

    expect(unitButton).toHaveTextContent("MHz");
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(1_900_000);
  });

  it("uses a typed unit suffix for a standalone frequency value", () => {
    const onChange = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={1_600_000}
          onCenterFrequencyChange={onChange}
          onClose={jest.fn()}
        />
      </Wrapper>,
    );

    const input = screen.getByRole("textbox");
    const unitButton = screen.getByRole("button", { name: "Frequency unit" });
    fireEvent.change(input, { target: { value: "300k" } });

    expect(unitButton).toHaveTextContent("kHz");
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(300_000);
  });

  it("treats a separated standalone number as an absolute Hz value", () => {
    const onChange = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={2_000_000_000}
          onCenterFrequencyChange={onChange}
          onClose={jest.fn()}
        />
      </Wrapper>,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "300_000" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(300_000);
  });

  it("treats a leading plus suffix as an offset from the current frequency", () => {
    const onChange = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={1_600_000}
          onCenterFrequencyChange={onChange}
          onClose={jest.fn()}
        />
      </Wrapper>,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "+300k" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(1_900_000);
  });

  it.each([
    ["1.9-1", 900_000],
    ["1.9+1", 2_900_000],
    ["30+1.6", 31_600_000],
  ])("evaluates %s in the selected MHz unit", (expression, expectedHz) => {
    const onChange = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={1_900_000}
          onCenterFrequencyChange={onChange}
          onClose={jest.fn()}
        />
      </Wrapper>,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: expression } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(expectedHz);
  });

  it("closes without committing when clicking outside", () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={844_036_300}
          onCenterFrequencyChange={onChange}
          onClose={onClose}
        />
      </Wrapper>,
    );

    fireEvent.pointerDown(document.body);

    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the overlay open when focus moves to the unit selector", () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={844_036_300}
          onCenterFrequencyChange={onChange}
          onClose={onClose}
        />
      </Wrapper>,
    );

    const input = screen.getByRole("textbox");
    const unitButton = screen.getByRole("button", { name: "Frequency unit" });
    fireEvent.blur(input, { relatedTarget: unitButton });

    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens the unit menu and changes units without closing", () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    render(
      <Wrapper>
        <EditableCenterFrequency
          centerFrequencyHz={844_036_300}
          onCenterFrequencyChange={onChange}
          onClose={onClose}
        />
      </Wrapper>,
    );

    const unitButton = screen.getByRole("button", { name: "Frequency unit" });
    fireEvent.pointerDown(unitButton);
    fireEvent.pointerDown(screen.getByRole("option", { name: "kHz" }));

    expect(
      screen.getByRole("button", { name: "Frequency unit" }),
    ).toHaveTextContent("kHz");
    expect(onClose).not.toHaveBeenCalled();
  });
});
