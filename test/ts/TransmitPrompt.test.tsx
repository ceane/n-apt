/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { TestWrapper } from "./testUtils";
import { TransmitPrompt } from "@n-apt/transmit/prompts/TransmitPrompt";

describe("TransmitPrompt", () => {
  it("renders the transmit warning copy and seal assets", () => {
    render(
      <TestWrapper>
        <TransmitPrompt />
      </TestWrapper>,
    );

    expect(
      screen.getByText(/Some frequencies require an FCC license to transmit/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Unauthorized transmission on licensed spectrum may violate FCC regulations/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /fcc seal/i })).toHaveAttribute(
      "src",
      expect.stringContaining("/images/USFCC_seal.svg"),
    );
    expect(screen.getByRole("img", { name: /doj seal/i })).toHaveAttribute(
      "src",
      expect.stringContaining("/images/USDOJ_seal.svg"),
    );
  });
});
