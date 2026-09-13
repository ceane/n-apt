import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ResponsiveKatex } from "@n-apt/math/ResponsiveKatex";

describe("ResponsiveKatex security", () => {
  it("does not turn untrusted HTML into executable DOM nodes", () => {
    render(
      <ResponsiveKatex
        html={'<span class="katex">safe</span><img data-testid="xss" src="x" onerror="alert(1)">'}
      />,
    );

    expect(screen.getByText("safe")).toBeInTheDocument();
    expect(screen.queryByTestId("xss")).not.toBeInTheDocument();
  });
});
