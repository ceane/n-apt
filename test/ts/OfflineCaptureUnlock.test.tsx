import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OfflineCaptureUnlock } from "@n-apt/capture/sidebar/OfflineCaptureUnlock";

describe("OfflineCaptureUnlock", () => {
  it("disables unlock controls until a file is selected", () => {
    render(<OfflineCaptureUnlock selectedFiles={[]} />);

    expect(screen.getByLabelText("Capture password")).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: /Has increased protection\?/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrypt with password" }))
      .toBeDisabled();
    expect(screen.getByRole("button", { name: "Unlock with FIDO" }))
      .toBeDisabled();
  });

  it("leaves increased protection unchecked for a regular capture", () => {
    render(
      <OfflineCaptureUnlock
        selectedFiles={[{ id: "capture", name: "capture.napt" }]}
      />,
    );

    const protectionCheckbox = screen.getByRole("checkbox", {
      name: /Has increased protection\?/i,
    });
    expect(protectionCheckbox).not.toBeChecked();
    expect(protectionCheckbox).toBeDisabled();
    expect(screen.queryByLabelText("Capture protection salt")).toBeNull();
    expect(screen.getByLabelText("Capture password")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Decrypt with password" }))
      .toBeEnabled();
  });

  it("checks increased protection and requests a salt for an .enc envelope", () => {
    render(
      <OfflineCaptureUnlock
        selectedFiles={[{ id: "capture", name: "capture.enc" }]}
      />,
    );

    const protectionCheckbox = screen.getByRole("checkbox", {
      name: /Has increased protection\?/i,
    });
    expect(protectionCheckbox).toBeChecked();
    expect(protectionCheckbox).toBeDisabled();
    expect(screen.getByLabelText("Capture protection salt")).toBeEnabled();
    expect(screen.getByLabelText("Capture password")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Unlock with FIDO" }))
      .toBeDisabled();
  });
});
