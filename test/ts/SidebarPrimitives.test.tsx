import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import styled, { ServerStyleSheet, ThemeProvider } from "styled-components";
import { Clock } from "lucide-react";
import {
  CheckboxSwitch,
  CheckboxSwitchInput,
  CheckboxSwitchSlider,
  SectionGrid,
  CompactSelect,
  compactSelectInteractionStyles,
  IconLabel,
} from "@n-apt/ui/SidebarPrimitives";

import { buildAppTheme } from "@n-apt/ui/Theme";

const theme = {
  ...buildAppTheme({
    accentColor: "#123456",
    fftColor: "#123456",
    appMode: "dark",
    resolvedMode: "dark",
    waterfallTheme: "classic",
  }),
  primary: "#123456",
  borderHover: "#654321",
};

function renderStyles(children: React.ReactNode) {
  const sheet = new ServerStyleSheet();
  try {
    renderToStaticMarkup(
      sheet.collectStyles(<ThemeProvider theme={theme}>{children}</ThemeProvider>),
    );
    return sheet.getStyleTags();
  } finally {
    sheet.seal();
  }
}

describe("sidebar primitives", () => {
  it("keeps compact selects native, controlled, and ref-accessible", () => {
    const ref = React.createRef<HTMLSelectElement>();
    const onChange = jest.fn();
    render(
      <ThemeProvider theme={theme}>
        <CompactSelect
          ref={ref}
          aria-label="Mode"
          name="mode"
          value="live"
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="live">Live</option>
          <option value="file">File</option>
        </CompactSelect>
      </ThemeProvider>,
    );
    const select = screen.getByRole("combobox", { name: "Mode" });
    expect(ref.current).toBe(select);
    expect(select).toHaveAttribute("name", "mode");
    expect(select).toHaveValue("live");
    fireEvent.change(select, { target: { value: "file" } });
    expect(onChange).toHaveBeenCalledWith("file");
    expect(select).toHaveValue("live");
    const style = getComputedStyle(select);
    expect(style.fontSize).toBe("12px");
    expect(style.fontWeight).toBe("500");
    expect(style.paddingRight).toBe("20px");
    expect(style.minWidth).toBe("0");
    expect(style.cursor).toBe("pointer");
    expect(style.appearance).toBe("none");
  });

  it("leaves draw-select interaction and sizing rules opt-in", () => {
    const css = renderStyles(<CompactSelect defaultValue="live"><option>live</option></CompactSelect>);
    expect(css).toContain("background-position:right 2px center;");
    expect(css).toContain("background-size:12px;");
    expect(css).toContain("stroke='%23ccc'");
    expect(css).not.toContain(":hover");
    expect(css).not.toContain(":focus");
    expect(css).not.toContain(" option{");
    expect(css).not.toContain("box-sizing:");
    expect(css).not.toContain("max-width:");
  });

  it("shares opt-in hover, focus and option styles without imposing sizing", () => {
    const Select = styled(CompactSelect)`${compactSelectInteractionStyles}`;
    const css = renderStyles(<Select />);
    expect(css).toContain(":hover{border-color:#654321;}");
    expect(css).toContain(":focus{outline:none;border-color:#123456;background-color:#1234560d;}");
    expect(css).toContain(`option{background-color:${theme.colors.surface};color:${theme.colors.textPrimary};font-family:${theme.typography.mono.replace(/,\s+/g, ",")};}`);
    expect(css).not.toContain("max-width:");
  });

  it("renders a decorative icon and text with the existing label styles", () => {
    render(<ThemeProvider theme={theme}><IconLabel icon={Clock} text="Duration" /></ThemeProvider>);
    const label = screen.getByText("Duration");
    expect(label.tagName).toBe("SPAN");
    const style = getComputedStyle(label);
    expect(style.display).toBe("inline-flex");
    expect(style.alignItems).toBe("center");
    expect(style.gap).toBe("10px");
    expect(style.lineHeight).toBe("1.2");
    const icon = label.querySelector("svg")!;
    expect(icon).toHaveAttribute("width", "14");
    expect(icon).toHaveAttribute("height", "14");
    expect(icon).toHaveAttribute("stroke-width", "1.75");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(getComputedStyle(icon).opacity).toBe("0.5");
    expect(renderStyles(<IconLabel icon={Clock} text="Duration" />)).toContain(`color:${theme.colors.textSecondary};opacity:0.5;`);
  });

  it("preserves source label inherited line-height and supports styled extensions", () => {
    const StyledLabel = styled(IconLabel)`margin-left: 4px;`;
    render(<ThemeProvider theme={theme}><StyledLabel icon={Clock} text="Duration" /><IconLabel icon={Clock} text="Gain" $inheritLineHeight /></ThemeProvider>);
    expect(getComputedStyle(screen.getByText("Duration")).marginLeft).toBe("4px");
    expect(screen.getByText("Gain")).not.toHaveAttribute("$inheritLineHeight");
    expect(renderStyles(<IconLabel icon={Clock} text="Gain" $inheritLineHeight />)).not.toContain("line-height:");
  });

  it("retains a native checkbox, label activation, and adjacent slider", () => {
    const onChange = jest.fn();
    render(
      <ThemeProvider theme={theme}>
        <CheckboxSwitch data-testid="switch">
          <CheckboxSwitchInput
            type="checkbox"
            aria-label="Capture location"
            defaultChecked
            onChange={(event) => onChange(event.target.checked)}
          />
          <CheckboxSwitchSlider />
        </CheckboxSwitch>
      </ThemeProvider>,
    );

    const input = screen.getByRole("checkbox", { name: "Capture location" });
    expect(input).toBeChecked();
    expect(input.parentElement?.tagName).toBe("LABEL");
    expect(input.nextElementSibling?.tagName).toBe("SPAN");
    expect(getComputedStyle(input).width).toBe("44px");
    expect(getComputedStyle(input).height).toBe("24px");
    fireEvent.click(screen.getByTestId("switch"));
    expect(onChange).toHaveBeenCalledWith(false);
    expect(input).not.toBeChecked();
  });

  it("preserves source and IQ disabled dimming and blocked cursors", () => {
    const onChange = jest.fn();
    render(
      <ThemeProvider theme={theme}>
        <CheckboxSwitch $disabled data-testid="switch">
          <CheckboxSwitchInput
            type="checkbox"
            aria-label="Capture location"
            disabled
            onChange={onChange}
          />
          <CheckboxSwitchSlider data-testid="slider" $disabled />
        </CheckboxSwitch>
      </ThemeProvider>,
    );

    const input = screen.getByRole("checkbox");
    expect(input).toBeDisabled();
    expect(getComputedStyle(screen.getByTestId("switch")).opacity).toBe("0.4");
    for (const element of [
      input,
      screen.getByTestId("switch"),
      screen.getByTestId("slider"),
    ]) {
      expect(getComputedStyle(element).cursor).toBe("not-allowed");
    }
    fireEvent.click(screen.getByTestId("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps snapshot disabled inputs native-disabled without dimming or cursor changes", () => {
    const onChange = jest.fn();
    render(
      <ThemeProvider theme={theme}>
        <CheckboxSwitch data-testid="switch">
          <CheckboxSwitchInput
            type="checkbox"
            disabled
            $plainDisabled
            onChange={onChange}
          />
          <CheckboxSwitchSlider data-testid="slider" />
        </CheckboxSwitch>
      </ThemeProvider>,
    );

    const input = screen.getByRole("checkbox");
    expect(input).toBeDisabled();
    expect(input).not.toHaveAttribute("$plainDisabled");
    expect(screen.getByTestId("switch")).not.toHaveAttribute("$disabled");
    expect(getComputedStyle(screen.getByTestId("switch")).opacity).toBe("1");
    for (const element of [
      input,
      screen.getByTestId("switch"),
      screen.getByTestId("slider"),
    ]) {
      expect(getComputedStyle(element).cursor).toBe("pointer");
    }
    fireEvent.click(screen.getByTestId("switch"));
    expect(onChange).not.toHaveBeenCalled();
    expect(renderStyles(<CheckboxSwitchInput type="checkbox" disabled $plainDisabled />))
      .not.toContain(":disabled+span");
  });

  it("preserves checked, slider, and thumb CSS", () => {
    const css = renderStyles(
      <CheckboxSwitch>
        <CheckboxSwitchInput type="checkbox" defaultChecked />
        <CheckboxSwitchSlider />
      </CheckboxSwitch>,
    );
    expect(css).toContain(":checked+span{background-color:#123456;}");
    expect(css).toContain("transform:translateX(20px)");
    expect(css).toContain(":disabled+span{cursor:not-allowed;}");
    expect(css).toContain("background-color:#654321;");
    expect(css).toContain("border-radius:24px;");
    expect(css).toContain("height:18px;width:18px;left:3px;bottom:3px;background-color:white;");
    expect(css).toContain("transition:0.2s;");
  });

  it("preserves the full-width subgrid and forwards native attributes", () => {
    render(<SectionGrid data-testid="section" style={{ opacity: 0.5 }}>Content</SectionGrid>);
    const section = screen.getByTestId("section");
    const style = getComputedStyle(section);
    expect(section.tagName).toBe("DIV");
    expect(section).toHaveTextContent("Content");
    expect(style.display).toBe("grid");
    expect(style.gridTemplateColumns).toBe("subgrid");
    expect(style.gridColumn.replace(/\s/g, "")).toBe("1/-1");
    expect(style.gap).toBe("inherit");
    expect(style.boxSizing).toBe("border-box");
    expect(style.width).toBe("100%");
    expect(style.opacity).toBe("0.5");
  });
});
