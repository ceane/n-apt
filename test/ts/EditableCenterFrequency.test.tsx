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
