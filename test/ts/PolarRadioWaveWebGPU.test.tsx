import React from "react";
import { render, screen } from "@testing-library/react";
import { useControls } from "leva";
import { PolarRadioWaveWebGPU } from "@n-apt/three-d/PolarRadioWaveWebGPU";

jest.mock("@n-apt/ui/levaFrequencyPlugin", () => ({
  levaFrequency: (value: number) => value,
}));

const mockUseControls = useControls as jest.Mock;

describe("PolarRadioWaveWebGPU", () => {
  beforeEach(() => {
    mockUseControls.mockReturnValue({
      frequency: 1_500_000_000_000,
      aperture: 60,
      power: 43,
      beamWidth: 25,
      rotation: 0,
    });
  });

  test("uses the shared scene frequency when Leva controls are disabled", () => {
    render(
      React.createElement(
        PolarRadioWaveWebGPU,
        {
          aperture: 40,
          frequency: 1.5,
          gain: 43,
          useLevaControls: false,
        } as never,
      ),
    );

    expect(screen.getByText("1.500MHz")).toBeInTheDocument();
    expect(screen.getByText("199.86 m")).toBeInTheDocument();
  });

  test("does not round a sub-millimeter wavelength down to zero", () => {
    render(<PolarRadioWaveWebGPU />);

    expect(screen.getByText("0.20 mm")).toBeInTheDocument();
    expect(screen.queryByText("0 mm")).not.toBeInTheDocument();
  });
});
